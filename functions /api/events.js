import { isAdmin } from "./_auth.js";

export async function onRequestGet({ request, env }) {

  // ==========================================================
  // ADMIN AUTHENTICATION
  // ==========================================================

  const authenticated = await isAdmin(request, env);

  if (!authenticated) {

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Unauthorized"
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

  // ==========================================================
  // LOAD VISITOR RECORDS
  // ==========================================================

  try {

    const list = await env.VISITOR_KV.list({
      limit: 500
    });

    const data = [];

    for (const key of list.keys) {

      const name = key.name;

      // Ignore internal keys
      if (
        name.startsWith("telegram:") ||
        name.startsWith("telegram_lock:") ||
        name.startsWith("msg_") ||
        name.startsWith("sent_") ||
        name.startsWith("image:")
      ) {
        continue;
      }

      try {

        const value = await env.VISITOR_KV.get(name);

        if (!value) continue;

        const parsed = JSON.parse(value);

        if (!parsed || typeof parsed !== "object") {
          continue;
        }

        // Keep both new records and old records
        if (
          name.startsWith("visitor:") ||
          parsed.session_id ||
          parsed.user_id
        ) {
          data.push(parsed);
        }

      } catch (error) {

        console.log(
          "Skipping invalid KV record:",
          name,
          error
        );
      }
    }

    // ========================================================
    // SORT NEWEST FIRST
    // ========================================================

    data.sort((a, b) => {

      const aTime = new Date(
        a.updated || a.time || a.created || 0
      ).getTime();

      const bTime = new Date(
        b.updated || b.time || b.created || 0
      ).getTime();

      return bTime - aTime;
    });

    return new Response(
      JSON.stringify({
        ok: true,
        data,
        count: data.length
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {

    console.log("Events error:", error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Unable to load visitor data"
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
}
