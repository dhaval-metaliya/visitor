import {
  createAdminToken,
  getAuthCookie,
  getLogoutCookie,
  isAdmin
} from "./_auth.js";

export async function onRequestPost({ request, env }) {

  try {

    const body = await request.json();

    const password = String(body?.password || "");

    if (!env.ADMIN_PASS) {

      return new Response(
        JSON.stringify({
          ok: false,
          error: "ADMIN_PASS is not configured"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    if (password !== env.ADMIN_PASS) {

      return new Response(
        JSON.stringify({
          ok: false,
          error: "Invalid password"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    const token = await createAdminToken(env.ADMIN_PASS);

    return new Response(
      JSON.stringify({
        ok: true
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Set-Cookie": getAuthCookie(token)
        }
      }
    );

  } catch (error) {

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid request"
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );
  }
}


// ============================================================
// LOGOUT
// ============================================================

export async function onRequestDelete({ request, env }) {

  return new Response(
    JSON.stringify({
      ok: true
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie": getLogoutCookie()
      }
    }
  );
}


// ============================================================
// CHECK LOGIN
// ============================================================

export async function onRequestGet({ request, env }) {

  const authenticated = await isAdmin(request, env);

  return new Response(
    JSON.stringify({
      authenticated
    }),
    {
      status: authenticated ? 200 : 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
