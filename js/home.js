import { supabase, isConfigured, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabaseClient.js";
import { generateCode, showError, hideError } from "./util.js";

const Upload = window.tus?.Upload;
if (!Upload) throw new Error("Nightcast upload client failed to load.");

const $ = (id) => document.getElementById(id);
const errorBox = $("errorBox");
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const dzText = $("dzText");
const fileNameEl = $("fileName");
const roomNameInput = $("roomNameInput");
const createBtn = $("createBtn");
const progressWrap = $("progressWrap");
const progressBar = $("progressBar");
const codeInput = $("codeInput");
const joinBtn = $("joinBtn");
const roomsList = $("roomsList");
const roomSearch = $("roomSearch");
const filterPills = [...document.querySelectorAll(".filter-pill")];
const heroCreateBtn = $("heroCreateBtn");
const heroJoinBtn = $("heroJoinBtn");

let selectedFile = null;
let roomsCache = [];
let activeFilter = "all";

if (!isConfigured) showError(errorBox, "Nightcast is not connected to Supabase.");

function ownedRooms() {
  try { return JSON.parse(localStorage.getItem("nightcast_owned_rooms") || "[]"); }
  catch { return []; }
}

function saveOwnedRooms(rooms) {
  localStorage.setItem("nightcast_owned_rooms", JSON.stringify(rooms.slice(-50)));
}

function rememberRoom(code, ownerToken) {
  saveOwnedRooms([...ownedRooms().filter((room) => room.code !== code), { code, ownerToken }]);
}

function forgetRoom(code) {
  saveOwnedRooms(ownedRooms().filter((room) => room.code !== code));
}

function selectFile(file) {
  if (!file?.type?.startsWith("video") && !file?.type?.startsWith("audio")) {
    showError(errorBox, "Choose a video or audio file.");
    return;
  }

  hideError(errorBox);
  selectedFile = file;
  dzText.innerHTML = "<strong>File ready</strong><br/>click to choose another";
  fileNameEl.textContent = file.name;
  fileNameEl.style.display = "block";
  createBtn.disabled = false;
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

heroCreateBtn?.addEventListener("click", () => scrollToSection("createSection"));
heroJoinBtn?.addEventListener("click", () => {
  scrollToSection("joinSection");
  setTimeout(() => codeInput?.focus(), 450);
});

fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
["dragover", "dragenter"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropzone.classList.add("drag");
}));
["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropzone.classList.remove("drag");
}));
dropzone.addEventListener("drop", (event) => selectFile(event.dataTransfer.files[0]));

createBtn.addEventListener("click", () => {
  if (!selectedFile || !isConfigured) return;

  hideError(errorBox);
  createBtn.disabled = true;
  createBtn.textContent = "Uploading… 0%";
  progressWrap.style.display = "block";
  progressBar.style.width = "0%";

  const code = generateCode();
  const ownerToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const roomName = roomNameInput.value.trim().slice(0, 80) || "Nightcast Room";
  const ext = (selectedFile.name.split(".").pop() || "bin").toLowerCase();
  const path = `${code}.${ext}`;

  const upload = new Upload(selectedFile, {
    endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    chunkSize: 6 * 1024 * 1024,
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "x-upsert": "false"
    },
    metadata: {
      bucketName: "media",
      objectName: path,
      contentType: selectedFile.type || "application/octet-stream",
      cacheControl: "3600"
    },
    onError: (error) => {
      showError(errorBox, `Upload failed: ${error.message || error}`);
      reset();
    },
    onProgress: (sent, total) => {
      const pct = Math.round((sent / total) * 100);
      progressBar.style.width = `${pct}%`;
      createBtn.textContent = `Uploading… ${pct}%`;
    },
    onSuccess: async () => {
      try {
        const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
        const { error } = await supabase.from("rooms").insert({
          code,
          name: roomName,
          owner_token: ownerToken,
          media_url: pub.publicUrl,
          media_type: selectedFile.type.startsWith("video") ? "video" : "audio",
          media_name: selectedFile.name
        });
        if (error) throw error;

        rememberRoom(code, ownerToken);
        localStorage.setItem(`nightcast_host_${code}`, "1");
        window.location.href = `room.html?code=${code}`;
      } catch (error) {
        showError(errorBox, `Room creation failed: ${error.message || error}`);
        reset();
      }
    }
  });

  upload.findPreviousUploads().then((previous) => {
    if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
    upload.start();
  });
});

function reset() {
  createBtn.disabled = false;
  createBtn.textContent = "Create room";
  progressWrap.style.display = "none";
}

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

joinBtn.addEventListener("click", async () => {
  const code = codeInput.value.trim();
  if (code.length < 4) {
    showError(errorBox, "Enter a room code.");
    return;
  }

  joinBtn.disabled = true;
  joinBtn.textContent = "Checking…";
  const { data, error } = await supabase.from("rooms").select("code").eq("code", code).maybeSingle();
  joinBtn.disabled = false;
  joinBtn.textContent = "Join room";

  if (error || !data) {
    showError(errorBox, "No room found with that code.");
    return;
  }

  window.location.href = `room.html?code=${code}`;
});

codeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinBtn.click();
});

function renderRooms() {
  const query = roomSearch?.value.trim().toLowerCase() || "";
  const filtered = roomsCache.filter((room) => {
    const matchesType = activeFilter === "all" || room.media_type === activeFilter;
    const matchesSearch = !query || `${room.name} ${room.code} ${room.media_name || ""}`.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  });

  if (!filtered.length) {
    roomsList.innerHTML = roomsCache.length
      ? '<div class="empty">No rooms match that filter.</div>'
      : '<div class="empty">Your rooms will appear here after you create one.</div>';
    return;
  }

  roomsList.innerHTML = filtered.map((room) => `
    <article class="room-row room-card">
      <div class="room-thumb ${room.media_type}"><span>${room.media_type === "video" ? "▶" : "♫"}</span></div>
      <div class="room-info"><strong>${escapeHtml(room.name)}</strong><span>${room.code} · ${room.media_type} · ${escapeHtml(room.media_name || "media")}</span></div>
      <div class="row-actions"><a class="btn-ghost small" href="room.html?code=${encodeURIComponent(room.code)}">Open</a><button class="btn-ghost small danger" data-delete="${escapeHtml(room.code)}">Delete</button></div>
    </article>
  `).join("");

  roomsList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteRoom(button.dataset.delete));
  });
}

roomSearch?.addEventListener("input", renderRooms);
filterPills.forEach((pill) => pill.addEventListener("click", () => {
  activeFilter = pill.dataset.filter || "all";
  filterPills.forEach((item) => item.classList.toggle("active", item === pill));
  renderRooms();
}));

async function loadOwnedRooms() {
  const owned = ownedRooms();
  if (!owned.length) {
    roomsCache = [];
    renderRooms();
    return;
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("code,name,media_type,media_name,created_at")
    .in("code", owned.map((room) => room.code));

  if (error) {
    showError(errorBox, `Couldn't load rooms: ${error.message}`);
    return;
  }

  roomsCache = (data || []).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderRooms();
}

async function deleteRoom(code) {
  const entry = ownedRooms().find((room) => room.code === code);
  if (!entry) return;
  if (!confirm(`Delete room ${code}?`)) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?code=eq.${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "x-nightcast-owner-token": entry.ownerToken,
      Prefer: "return=minimal"
    }
  });

  if (!response.ok) {
    showError(errorBox, "Couldn't delete the room. You must be the room owner.");
    return;
  }

  forgetRoom(code);
  roomsCache = roomsCache.filter((room) => room.code !== code);
  renderRooms();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

loadOwnedRooms();
