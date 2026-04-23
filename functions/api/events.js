export async function onRequestGet({ env }) {

  const list = await env.VISITOR_KV.list({ limit: 100 });

  const data = [];

  for (const key of list.keys) {
    if (key.name.startsWith("sent_")) continue;

    const val = await env.VISITOR_KV.get(key.name);
    if (val) data.push(JSON.parse(val));
  }

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" }
  });
}
