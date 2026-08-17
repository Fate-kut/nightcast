import { supabase, isConfigured, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabaseClient.js";
import { showError } from "./util.js";

const params = new URLSearchParams(location.search);
const code = (params.get("code") || "").toUpperCase();
const $ = (id) => document.getElementById(id);

const errorBox = $("errorBox");
const roomCodeEl = $("roomCode");
const roomNameEl = $("roomName");
const videoEl = $("videoEl");
const audioStage = $("audioStage");
const audioEl = $("audioEl");
const vinyl = $("vinyl");
const audioName = $("audioName");
const guestLock = $("guestLock");
const tally = $("tally");
const tallyText = $("tallyText");
const dots = $("dots");
const presenceCount = $("presenceCount");
const hostNote = $("hostNote");
const messageList = $("messageList");
const messageInput = $("messageInput");
const sendBtn = $("sendBtn");
const recordBtn = $("recordBtn");
const voiceStatus = $("voiceStatus");
const inviteBtn = $("inviteBtn");
const editRoomBtn = $("editRoomBtn");
const deleteRoomBtn = $("deleteRoomBtn");
const roomActions = document.querySelector(".header-actions");
const voiceBtn = $("voiceBtn");
const videoCallBtn = $("videoCallBtn");
const hangupBtn = $("hangupBtn");
const callStatus = $("callStatus");
const callGrid = $("callGrid");

roomCodeEl.textContent = code || "——————";

if (!code) {
  showError(errorBox, "No room code in the link.");
  throw new Error("missing code");
}
if (!isConfigured) {
  showError(errorBox, "Nightcast isn't connected to Supabase.");
  throw new Error("supabase not configured");
}

const ownerEntry = (() => {
  try {
    return JSON.parse(localStorage.getItem("nightcast_owned_rooms") || "[]")
      .find((r) => r.code === code) || null;
  } catch {
    return null;
  }
})();

const isHost = Boolean(ownerEntry) || localStorage.getItem(`nightcast_host_${code}`) === "1";
const guestId = globalThis.crypto?.randomUUID?.() ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const guestName = localStorage.getItem("nightcast_name") ||
  `Guest ${Math.floor(100 + Math.random() * 900)}`;

localStorage.setItem("nightcast_name", guestName);

let room = null;
let mediaEl = null;
let mediaRecorder = null;
let recordingChunks = [];
let callStream = null;
let callMode = null;
let localCallTile = null;

const peers = new Map();
const pendingCandidates = new Map();
const seenMessages = new Set();

const channel = supabase.channel(`room:${code}`, {
  config: {
    broadcast: { self: false },
    presence: { key: guestId }
  }
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function setLive(on) {
  tally.classList.toggle("live", on);
  tallyText.textContent = on ? "live" : "idle";
  vinyl.classList.toggle("spin", on);
}

function ownedRooms() {
  try {
    return JSON.parse(localStorage.getItem("nightcast_owned_rooms") || "[]");
  } catch {
    return [];
  }
}

function rememberRoomName(name) {
  const list = ownedRooms();
  const index = list.findIndex((r) => r.code === code);
  if (index >= 0) {
    list[index].name = name;
    localStorage.setItem("nightcast_owned_rooms", JSON.stringify(list));
  }
}

async function ownerFetch(method, body) {
  if (!ownerEntry?.ownerToken) {
    throw new Error("Only the room owner can do that.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rooms?code=eq.${encodeURIComponent(code)}`,
    {
      method,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "x-nightcast-owner-token": ownerEntry.ownerToken,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: body ? JSON.stringify(body) : undefined
    }
  );

  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function sendBroadcast(event, payload) {
  return channel.send({ type: "broadcast", event, payload });
}

function showChannelError(status) {
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
    showError(errorBox, `Realtime connection failed (${status}). Refresh the room and try again.`);
  }
}

inviteBtn?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    inviteBtn.textContent = "Link copied!";
    setTimeout(() => { inviteBtn.textContent = "Invite friends"; }, 1500);
  } catch {
    prompt("Copy this invite link:", location.href);
  }
});

editRoomBtn?.addEventListener("click", async () => {
  const next = prompt("Room name:", room?.name || "");
  if (next === null) return;

  const name = next.trim().slice(0, 80);
  if (!name) return;

  try {
    await ownerFetch("PATCH", { name });
    room.name = name;
    roomNameEl.textContent = name;
    rememberRoomName(name);
  } catch (error) {
    showError(errorBox, `Couldn't rename room: ${error.message}`);
  }
});

deleteRoomBtn?.addEventListener("click", async () => {
  if (!confirm("Delete this room for everyone?")) return;

  try {
    await ownerFetch("DELETE");
    location.href = "index.html";
  } catch (error) {
    showError(errorBox, `Couldn't delete room: ${error.message}`);
  }
});

function updatePresence() {
  const people = Object.values(channel.presenceState()).flat();
  presenceCount.textContent = `${people.length || 1} here`;

  dots.innerHTML = people.slice(0, 8).map((person) => {
    const initial = escapeHtml((person.name || "?").slice(0, 1).toUpperCase());
    return `<div class="dot" title="${escapeHtml(person.name || "Guest")}">${initial}</div>`;
  }).join("");

  if (callMode) syncPeers(people.filter((person) => person.id !== guestId && person.call));
}

channel.on("presence", { event: "sync" }, updatePresence);
channel.on("presence", { event: "join" }, updatePresence);
channel.on("presence", { event: "leave" }, ({ key }) => {
  document.getElementById(`peer-${key}`)?.remove();
  const peer = peers.get(key);
  peer?.pc?.close?.();
  peers.delete(key);
  updatePresence();
});

function renderMessages(rows) {
  messageList.innerHTML = "";
  seenMessages.clear();
  rows.forEach(appendMessage);
  scrollMessages();
}

function appendMessage(message) {
  if (!message?.id || seenMessages.has(message.id)) return;
  seenMessages.add(message.id);

  const element = document.createElement("div");
  element.className = `message ${message.sender_id === guestId ? "mine" : ""}`;

  const time = new Date(message.created_at || Date.now())
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const body = message.kind === "voice"
    ? `<audio controls preload="metadata" src="${escapeHtml(message.media_url)}"></audio>`
    : `<div class="message-body">${escapeHtml(message.body || "")}</div>`;

  element.innerHTML = `
    <div class="message-meta">${escapeHtml(message.sender_name)} · ${time}</div>
    ${body}
  `;

  messageList.appendChild(element);
  scrollMessages();
}

function scrollMessages() {
  messageList.scrollTop = messageList.scrollHeight;
}

async function loadMessages() {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("room_code", code)
    .order("created_at", { ascending: true });

  if (error) {
    showError(errorBox, `Couldn't load messages: ${error.message}`);
    return;
  }

  renderMessages(data || []);
}

function subscribeMessages() {
  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `room_code=eq.${code}`
    },
    ({ new: message }) => appendMessage(message)
  );
}

async function sendText() {
  const body = messageInput.value.trim();
  if (!body || sendBtn.disabled) return;

  sendBtn.disabled = true;

  try {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        room_code: code,
        sender_id: guestId,
        sender_name: guestName,
        kind: "text",
        body
      })
      .select()
      .single();

    if (error) throw error;

    messageInput.value = "";
    appendMessage(data);
  } catch (error) {
    showError(errorBox, `Message failed: ${error.message}`);
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

sendBtn.addEventListener("click", sendText);
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendText();
  }
});

recordBtn.addEventListener("click", async () => {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];

    const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported?.(type));
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      recordBtn.disabled = true;
      voiceStatus.textContent = "Uploading voice message…";

      try {
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const extension = blob.type.includes("ogg") ? "ogg" : "webm";
        const path = `voice/${code}/${guestId}-${Date.now()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(path, blob, {
            contentType: blob.type,
            cacheControl: "3600",
            upsert: false
          });

        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);
        const { data, error } = await supabase
          .from("messages")
          .insert({
            room_code: code,
            sender_id: guestId,
            sender_name: guestName,
            kind: "voice",
            media_url: publicData.publicUrl
          })
          .select()
          .single();

        if (error) throw error;

        appendMessage(data);
        voiceStatus.textContent = "Voice message sent";
        setTimeout(() => { voiceStatus.textContent = ""; }, 1500);
      } catch (error) {
        voiceStatus.textContent = "";
        showError(errorBox, `Voice message failed: ${error.message}`);
      } finally {
        recordBtn.disabled = false;
        recordBtn.textContent = "🎤 Voice";
      }
    };

    mediaRecorder.start();
    voiceStatus.textContent = "Recording… tap again to stop";
    recordBtn.textContent = "Stop recording";
  } catch (error) {
    showError(errorBox, `Microphone permission is required: ${error.message || error}`);
  }
});

function createPeer(remote) {
  const existing = peers.get(remote.id);
  if (existing) return existing.pc;

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });

  peers.set(remote.id, { pc, remote });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      sendBroadcast("signal", { to: remote.id, from: guestId, data: { candidate } });
    }
  };

  pc.ontrack = ({ streams }) => {
    if (streams[0]) attachRemoteStream(remote, streams[0]);
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) removePeer(remote.id);
  };

  callStream?.getTracks().forEach((track) => pc.addTrack(track, callStream));
  return pc;
}

function attachRemoteStream(remote, stream) {
  let box = document.getElementById(`peer-${remote.id}`);

  if (!box) {
    box = document.createElement("div");
    box.id = `peer-${remote.id}`;
    box.className = "call-tile";
    callGrid.appendChild(box);
  }

  let media = box.querySelector("video");
  if (!media) {
    media = document.createElement("video");
    media.autoplay = true;
    media.playsInline = true;
    box.appendChild(media);
  }

  media.srcObject = stream;

  let label = box.querySelector(".call-label");
  if (!label) {
    label = document.createElement("div");
    label.className = "call-label";
    box.appendChild(label);
  }
  label.textContent = remote.name || "Guest";
}

function addLocalPreview() {
  if (localCallTile) return;

  localCallTile = document.createElement("div");
  localCallTile.id = "local-call-tile";
  localCallTile.className = "call-tile";

  const media = document.createElement("video");
  media.autoplay = true;
  media.muted = true;
  media.playsInline = true;
  media.srcObject = callStream;

  const label = document.createElement("div");
  label.className = "call-label";
  label.textContent = `${guestName} (you)`;

  localCallTile.append(media, label);
  callGrid.prepend(localCallTile);
}

function removePeer(id) {
  const peer = peers.get(id);
  if (peer) peer.pc.close();
  peers.delete(id);
  pendingCandidates.delete(id);
  document.getElementById(`peer-${id}`)?.remove();
}

async function flushCandidates(id) {
  const peer = peers.get(id);
  if (!peer || !peer.pc.remoteDescription) return;

  const queued = pendingCandidates.get(id) || [];
  pendingCandidates.delete(id);

  for (const candidate of queued) {
    try { await peer.pc.addIceCandidate(candidate); } catch {}
  }
}

async function connectPeer(remote) {
  if (!callMode || remote.id === guestId || peers.has(remote.id)) return;

  const pc = createPeer(remote);

  if (guestId < remote.id) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendBroadcast("signal", {
      to: remote.id,
      from: guestId,
      name: guestName,
      data: { description: pc.localDescription }
    });
  }
}

async function syncPeers(people) {
  if (!callMode) return;

  for (const person of people) await connectPeer(person);

  const ids = new Set(people.map((person) => person.id));
  for (const id of peers.keys()) {
    if (!ids.has(id)) removePeer(id);
  }
}

channel.on("broadcast", { event: "call-join" }, ({ payload }) => {
  if (!callMode || payload.from === guestId) return;
  if (guestId < payload.from) {
    connectPeer({ id: payload.from, name: payload.name || "Guest", call: true })
      .catch((error) => showError(errorBox, `Call connection failed: ${error.message}`));
  }
});

channel.on("broadcast", { event: "call-leave" }, ({ payload }) => {
  if (payload.from && payload.from !== guestId) removePeer(payload.from);
});

channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
  if (payload.to !== guestId || payload.from === guestId) return;

  const remote = { id: payload.from, name: payload.name || "Guest" };
  let peer = peers.get(payload.from);

  if (!peer) {
    createPeer(remote);
    peer = peers.get(payload.from);
  }
  if (!peer) return;

  const data = payload.data || {};

  if (data.description) {
    const description = data.description;
    await peer.pc.setRemoteDescription(description);
    await flushCandidates(payload.from);

    if (description.type === "offer") {
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      sendBroadcast("signal", {
        to: payload.from,
        from: guestId,
        name: guestName,
        data: { description: peer.pc.localDescription }
      });
    }
  }

  if (data.candidate) {
    if (peer.pc.remoteDescription) {
      try { await peer.pc.addIceCandidate(data.candidate); } catch {}
    } else {
      const queue = pendingCandidates.get(payload.from) || [];
      queue.push(data.candidate);
      pendingCandidates.set(payload.from, queue);
    }
  }
});

async function startCall(mode) {
  if (callMode) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showError(errorBox, "This browser does not support microphone/camera calls.");
    return;
  }

  try {
    callStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video"
    });

    callMode = mode;
    addLocalPreview();
    callStatus.textContent = mode === "video" ? "Video call active" : "Live voice chat active";
    voiceBtn.disabled = true;
    videoCallBtn.disabled = true;
    hangupBtn.style.display = "inline-flex";

    await channel.track({ id: guestId, name: guestName, host: isHost, call: true, mode });
    await sendBroadcast("call-join", { from: guestId, name: guestName, mode });

    const people = Object.values(channel.presenceState())
      .flat()
      .filter((person) => person.id !== guestId && person.call);
    await syncPeers(people);
  } catch (error) {
    callStream?.getTracks().forEach((track) => track.stop());
    callStream = null;
    callMode = null;
    localCallTile?.remove();
    localCallTile = null;
    showError(errorBox, `Camera/microphone permission is required: ${error.message || error}`);
  }
}

function hangup() {
  sendBroadcast("call-leave", { from: guestId });
  callStream?.getTracks().forEach((track) => track.stop());
  callStream = null;

  for (const id of peers.keys()) removePeer(id);
  localCallTile?.remove();
  localCallTile = null;

  callMode = null;
  voiceBtn.disabled = false;
  videoCallBtn.disabled = false;
  hangupBtn.style.display = "none";
  callStatus.textContent = "";
  channel.track({ id: guestId, name: guestName, host: isHost, call: false });
}

voiceBtn.addEventListener("click", () => startCall("voice"));
videoCallBtn.addEventListener("click", () => startCall("video"));
hangupBtn.addEventListener("click", hangup);

async function stageSetup() {
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

  $("stage").style.display = "block";

  if (!isHost) {
    guestLock.style.display = "flex";
    guestLock.addEventListener("click", unlockGuest, { once: true });
  } else {
    setupHost();
  }
}

async function unlockGuest() {
  try {
    await mediaEl.play();
    mediaEl.pause();
  } catch {}

  guestLock.style.display = "none";
  sendBroadcast("request-sync", { from: guestId });
}

function setupHost() {
  const sendState = (action) => {
    if (!mediaEl) return;
    sendBroadcast("state", {
      action,
      time: mediaEl.currentTime,
      playing: !mediaEl.paused
    });
  };

  mediaEl.addEventListener("play", () => { setLive(true); sendState("play"); });
  mediaEl.addEventListener("pause", () => { setLive(false); sendState("pause"); });
  mediaEl.addEventListener("seeked", () => sendState("seek"));

  setInterval(() => { if (mediaEl?.src) sendState("sync"); }, 4000);
  channel.on("broadcast", { event: "request-sync" }, () => sendState("sync"));
}

channel.on("broadcast", { event: "state" }, ({ payload }) => {
  if (isHost || !mediaEl || guestLock.style.display !== "none") return;

  const targetTime = Number(payload.time || 0);
  const drift = Math.abs(mediaEl.currentTime - targetTime);

  if (payload.action === "play") {
    if (drift > 0.75) mediaEl.currentTime = targetTime;
    mediaEl.play().then(() => setLive(true)).catch(() => {});
  } else if (payload.action === "pause") {
    mediaEl.currentTime = targetTime;
    mediaEl.pause();
    setLive(false);
  } else if (payload.action === "seek") {
    mediaEl.currentTime = targetTime;
  } else if (payload.action === "sync") {
    if (drift > 1.25) mediaEl.currentTime = targetTime;
    if (payload.playing) mediaEl.play().then(() => setLive(true)).catch(() => {});
    else { mediaEl.pause(); setLive(false); }
  }
});

async function init() {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    showError(errorBox, `Couldn't load room: ${error.message}`);
    return;
  }
  if (!data) {
    showError(errorBox, "This room doesn't exist or has been deleted.");
    return;
  }

  room = data;
  roomNameEl.textContent = room.name || "Nightcast Room";

  if (isHost) {
    hostNote.style.display = "block";
    if (roomActions) roomActions.style.display = "flex";
  }

  await stageSetup();
  await loadMessages();
  subscribeMessages();

  channel.subscribe(async (status) => {
    showChannelError(status);
    if (status === "SUBSCRIBED") {
      await channel.track({ id: guestId, name: guestName, host: isHost, call: false });
      updatePresence();
    }
  });
}

init();
