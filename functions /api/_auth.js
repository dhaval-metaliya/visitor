// ============================================================
// ADMIN AUTH HELPER
// ============================================================

const COOKIE_NAME = "__Host-visitor_auth";
const SESSION_TTL = 24 * 60 * 60;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function sign(secret, message) {

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return bytesToBase64Url(new Uint8Array(signature));
}

function safeEqual(a, b) {

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function getCookies(request) {

  const header = request.headers.get("Cookie") || "";

  const cookies = {};

  for (const item of header.split(";")) {

    const index = item.indexOf("=");

    if (index === -1) continue;

    const name = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    cookies[name] = value;
  }

  return cookies;
}

export async function createAdminToken(secret) {

  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;

  const payload = `admin:${expires}`;

  const signature = await sign(secret, payload);

  return `${expires}.${signature}`;
}

export async function isAdmin(request, env) {

  if (!env.ADMIN_PASS) {
    return false;
  }

  const cookies = getCookies(request);

  const token = cookies[COOKIE_NAME];

  if (!token) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return false;
  }

  const expires = Number(parts[0]);
  const signature = parts[1];

  if (!Number.isFinite(expires)) {
    return false;
  }

  if (Math.floor(Date.now() / 1000) > expires) {
    return false;
  }

  const payload = `admin:${expires}`;

  const expected = await sign(env.ADMIN_PASS, payload);

  return safeEqual(signature, expected);
}

export function getAuthCookie(token) {

  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_TTL}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}

export function getLogoutCookie() {

  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}
