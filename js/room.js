import { supabase, isConfigured } from "./supabaseClient.js";
import { showError, hideError } from "./util.js";

const params = new URLSearchParams(window.location.search);
const code = (params.get("code") || "").toUpperCase();

const roomCodeEl = document.getElementById("roomCode");
const copyBtn = document.getElementById("copyBtn");
const errorBox = document.getElementById("errorBox");
const stage = document.getElementById("stage");
const videoEl = document.getElementById("videoEl");
const audioStage = document.getElementById("audioStage");
const audioEl = document.getElementById("audioEl");
const vinyl = document.getElementById("vinyl");
const audioName = document.getElementById("audioName");
const guestLock = document.getElementById("guestLock");
const tally = document.getElementById("tally");
const tallyText = document.getElementById("tallyText");
const dotsEl = document.getElementById("dots");
const presenceCountEl = document.getElementById("presenceCount");
const hostNote = document.getElementById("hostNote");

roomCodeEl.textContent = code || "——————";

if (!code) {
  showError(errorBox, "No room code in the link.");
  throw new Error("missing code");
}

if (!isConfigured) {
  showError(errorBox, "Nightcast isn't connected to Supabase yet — open js/supabaseClient.js and paste in your Project URL and anon key (see README).");
  throw new Error("supabase not configured");
}

const isHost = localStorage.getItem(`nightcast_host_${code}`) === "1";
const guestName = "Guest " + Math.floor(100 + Math.random() * 900);

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(window.location.href);
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
});

let mediaEl = null; // whichever element is active

function setLive(isPlaying) {
  tally.classList.toggle("live", isPlaying);
  tallyText.textContent = isPlaying ? "playing" : "paused";
  vinyl.classList.toggle("spin", isPlaying);
}

async function init() {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error || !room) {
    showError(errorBox, "This room doesn't exist — check the code or ask your friend for a fresh link.");
    return;
  }

  stage.style.display = "block";

  if (room.media_type === "video") {
    videoEl.style.display = "block";
    videoEl.src = room.media_url;
    if (isHost) videoEl.controls = true;
    mediaEl = videoEl;
  } else {
    audioStage.style.display = "flex";
    audioEl.src = room.media_url;
    audioName.textContent = room.media_name || "Now playing";
    if (isHost) audioEl.controls = true;
    mediaEl = audioEl;
  }

  if (isHost) {
    hostNote.style.display = "block";
    setupHost();
  } else {
    guestLock.style.display = "flex";
    setupGuest();
  }
}

// ── Realtime channel (shared) ──
const channel = supabase.channel(`room:${code}`, {
  config: { broadcast: { self: false }, presence: { key: crypto.randomUUID() } },
});

channel.on("presence", { event: "sync" }, () => {
  const state = channel.presenceState();
  const people = Object.values(state).flat();
  presenceCountEl.textContent = `${people.length} watching`;
  dotsEl.innerHTML = people
    .slice(0, 6)
    .map((p) => `<div class="dot" title="${p.name}">${(p.name || "?")[0]}</div>`)
    .join("");
});

// ── HOST ──
function setupHost() {
  const send = (action, extra = {}) =>
    channel.send({
      type: "broadcast",
      event: "state",
      payload: { action, time: mediaEl.currentTime, playing: !mediaEl.paused, ...extra },
    });

  mediaEl.addEventListener("play", () => {
    setLive(true);
    send("play");
  });
  mediaEl.addEventListener("pause", () => {
    setLive(false);
    send("pause");
  });
  mediaEl.addEventListener("seeked", () => send("seek"));

  setInterval(() => {
    if (mediaEl.src) send("sync");
  }, 4000);

  channel.on("broadcast", { event: "request-sync" }, () => send("sync"));

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ name: guestName, host: true });
    }
  });
}

// ── GUEST ──
function setupGuest() {
  let unlocked = false;

  guestLock.addEventListener("click", async () => {
    try {
      await mediaEl.play();
      mediaEl.pause();
    } catch (e) {
      /* ignore — some browsers still allow this after the click */
    }
    unlocked = true;
    guestLock.style.display = "none";
    channel.send({ type: "broadcast", event: "request-sync", payload: {} });
  });

  channel.on("broadcast", { event: "state" }, ({ payload }) => {
    if (!unlocked) return;
    const drift = Math.abs(mediaEl.currentTime - payload.time);

    if (payload.action === "play") {
      if (drift > 1) mediaEl.currentTime = payload.time;
      mediaEl.play().catch(() => {});
      setLive(true);
    } else if (payload.action === "pause") {
      mediaEl.currentTime = payload.time;
      mediaEl.pause();
      setLive(false);
    } else if (payload.action === "seek") {
      mediaEl.currentTime = payload.time;
    } else if (payload.action === "sync") {
      if (drift > 1.5) mediaEl.currentTime = payload.time;
      if (payload.playing && mediaEl.paused) mediaEl.play().catch(() => {});
      if (!payload.playing && !mediaEl.paused) mediaEl.pause();
      setLive(payload.playing);
    }
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ name: guestName, host: false });
    }
  });
}

init();
