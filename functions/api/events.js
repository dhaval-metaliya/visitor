export async function onRequestGet({ request, env }) {

  const cookie = request.headers.get("cookie") || "";

  if (!cookie.includes("auth=1")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const list = await env.VISITOR_KV.list({ limit: 100 });

  const data = await Promise.all(
    list.keys.map(k => env.VISITOR_KV.get(k.name))
  );

  return new Response(JSON.stringify(data.map(JSON.parse)), {
    headers: { "Content-Type": "application/json" }
  });
}