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

if (!code || !/^[A-Z0-9]{6}$/.test(code)) {
  showError(errorBox, "Invalid room code. Open the room link again or enter a valid 6-character code.");
  throw new Error("invalid room code");
}

if (!isConfigured) {
  showError(errorBox, "Nightcast isn't connected to Supabase yet — open js/supabaseClient.js and paste in your Project URL and anon key (see README).");
  throw new Error("supabase not configured");
}

const isHost = localStorage.getItem(`nightcast_host_${code}`) === "1";
const guestName = "Guest " + Math.floor(100 + Math.random() * 900);

copyBtn.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(window.location.href);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
  } catch (err) {
    console.error(err);
    showError(errorBox, "Couldn't copy the link automatically. Copy the URL from your browser's address bar instead.");
  }
});

let mediaEl = null;
let channelStarted = false;
let syncTimer = null;

function setLive(isPlaying) {
  tally.classList.toggle("live", isPlaying);
  tallyText.textContent = isPlaying ? "playing" : "paused";
  vinyl.classList.toggle("spin", isPlaying);
}

function startChannel() {
  if (channelStarted) return;
  channelStarted = true;

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ name: guestName, host: isHost });
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      showError(errorBox, "Realtime connection failed. Refresh the page and try again.");
    }
  });
}

async function init() {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error(error);
    showError(errorBox, `Couldn't load this room: ${error.message || "Supabase request failed."}`);
    return;
  }

  if (!room) {
    showError(errorBox, "This room doesn't exist — check the code or ask your friend for a fresh link.");
    return;
  }

  if (room.media_type !== "video" && room.media_type !== "audio") {
    showError(errorBox, "This room contains an unsupported media type.");
    return;
  }

  stage.style.display = "block";

  if (room.media_type === "video") {
    videoEl.style.display = "block";
    videoEl.src = room.media_url;
    videoEl.load();
    videoEl.controls = isHost;
    mediaEl = videoEl;
  } else {
    audioStage.style.display = "flex";
    audioEl.src = room.media_url;
    audioEl.load();
    audioName.textContent = room.media_name || "Now playing";
    audioEl.controls = isHost;
    mediaEl = audioEl;
  }

  if (isHost) {
    hostNote.style.display = "block";
    setupHost();
  } else {
    guestLock.style.display = "flex";
    setupGuest();
  }

  startChannel();
}

const channel = supabase.channel(`room:${code}`, {
  config: {
    broadcast: { self: false },
    presence: { key: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` },
  },
});

channel.on("presence", { event: "sync" }, () => {
  const state = channel.presenceState();
  const people = Object.values(state).flat();
  presenceCountEl.textContent = `${people.length} watching`;
  dotsEl.innerHTML = people
    .slice(0, 6)
    .map((p) => {
      const name = String(p.name || "?").replace(/[&<>\"]/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[char]));
      return `<div class="dot" title="${name}">${name[0]}</div>`;
    })
    .join("");
});

function setupHost() {
  const send = (action, extra = {}) => {
    if (!mediaEl) return;
    channel.send({
      type: "broadcast",
      event: "state",
      payload: {
        action,
        time: Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0,
        playing: !mediaEl.paused,
        ...extra,
      },
    });
  };

  mediaEl.addEventListener("play", () => {
    setLive(true);
    send("play");
  });
  mediaEl.addEventListener("pause", () => {
    setLive(false);
    send("pause");
  });
  mediaEl.addEventListener("seeked", () => send("seek"));

  syncTimer = setInterval(() => send("sync"), 4000);

  channel.on("broadcast", { event: "request-sync" }, () => send("sync"));
}

function setupGuest() {
  let unlocked = false;

  guestLock.addEventListener("click", async () => {
    try {
      await mediaEl.play();
      mediaEl.pause();
    } catch (err) {
      console.debug("Media unlock attempt failed; continuing after user gesture.", err);
    }
    unlocked = true;
    guestLock.style.display = "none";
    channel.send({ type: "broadcast", event: "request-sync", payload: {} });
  });

  channel.on("broadcast", { event: "state" }, ({ payload }) => {
    if (!unlocked || !payload || !Number.isFinite(payload.time)) return;

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
      setLive(Boolean(payload.playing));
    }
  });
}

window.addEventListener("pagehide", () => {
  if (syncTimer) clearInterval(syncTimer);
  channel.untrack().catch(() => {});
  supabase.removeChannel(channel).catch(() => {});
});

init();
