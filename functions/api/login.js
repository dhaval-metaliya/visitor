export async function onRequestPost({ request, env }) {
  const { password } = await request.json();

  if (password === env.ADMIN_PASS) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Set-Cookie": "auth=1; Path=/; Max-Age=86400"
      }
    });
  }

  return new Response(JSON.stringify({ ok: false }));
}