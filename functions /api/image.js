import { isAdmin } from "./_auth.js";

export async function onRequestGet({ request, env }) {

  // ==========================================================
  // ADMIN AUTH
  // ==========================================================

  const authenticated = await isAdmin(request, env);

  if (!authenticated) {

    return new Response("Unauthorized", {
      status: 401
    });
  }

  // ==========================================================
  // GET IMAGE KEY
  // ==========================================================

  const url = new URL(request.url);

  const key = url.searchParams.get("key");

  if (!key) {

    return new Response("Missing image key", {
      status: 400
    });
  }

  // Security: only allow our visitor image path

  if (!key.startsWith("visitor/")) {

    return new Response("Invalid image key", {
      status: 400
    });
  }

  // ==========================================================
  // R2 REQUIRED
  // ==========================================================

  if (!env.VISITOR_R2) {

    return new Response(
      "R2 image storage is not configured",
      {
        status: 404
      }
    );
  }

  try {

    const object = await env.VISITOR_R2.get(key);

    if (!object) {

      return new Response("Image not found", {
        status: 404
      });
    }

    const headers = new Headers();

    object.writeHttpMetadata(headers);

    headers.set(
      "Cache-Control",
      "private, max-age=300"
    );

    return new Response(object.body, {
      headers
    });

  } catch (error) {

    console.log("Image error:", error);

    return new Response("Unable to load image", {
      status: 500
    });
  }
}
