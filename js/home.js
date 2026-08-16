import { supabase, isConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";
import { generateCode, showError, hideError, mediaKind } from "./util.js";

if (!isConfigured) {
  showError(
    document.getElementById("errorBox"),
    "Nightcast isn't connected to Supabase yet — open js/supabaseClient.js and paste in your Project URL and anon key (see README)."
  );
}

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const dzText = document.getElementById("dzText");
const fileNameEl = document.getElementById("fileName");
const createBtn = document.getElementById("createBtn");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const errorBox = document.getElementById("errorBox");
const codeInput = document.getElementById("codeInput");
const joinBtn = document.getElementById("joinBtn");

let selectedFile = null;

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) selectFile(fileInput.files[0]);
});

["dragover", "dragenter"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
  })
);
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) selectFile(f);
});

function selectFile(file) {
  if (!file.type.startsWith("video") && !file.type.startsWith("audio")) {
    showError(errorBox, "Please choose a video or audio file.");
    return;
  }
  hideError(errorBox);
  selectedFile = file;
  dzText.innerHTML = `<strong>File ready</strong><br/>click to choose a different one`;
  fileNameEl.textContent = file.name;
  fileNameEl.style.display = "block";
  createBtn.disabled = false;
}

/*
 * Upload directly from the browser with XMLHttpRequest.
 *
 * The previous TUS implementation was failing before it even contacted
 * Supabase because the CDN build of tus-js-client was using a Node-style
 * source adapter. A browser File is a valid body for XMLHttpRequest, so this
 * path avoids Buffer/Readable entirely and gives us native upload progress.
 */
function uploadFile(file, objectPath) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${SUPABASE_URL}/storage/v1/object/media/${objectPath}`;

    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = `${pct}%`;
      createBtn.textContent = `Uploading… ${pct}%`;
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      let detail = xhr.responseText || `HTTP ${xhr.status}`;
      try {
        const body = JSON.parse(xhr.responseText);
        detail = body.message || body.error || body.error_description || detail;
      } catch (_) {
        // Keep the raw response when it isn't JSON.
      }
      reject(new Error(detail));
    };

    xhr.onerror = () => reject(new Error("Network error while uploading to Supabase Storage."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.send(file);
  });
}

createBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  if (!isConfigured) {
    showError(errorBox, "Add your Supabase URL and anon key in js/supabaseClient.js first — see README.");
    return;
  }

  hideError(errorBox);
  createBtn.disabled = true;
  createBtn.textContent = "Uploading… 0%";
  progressWrap.style.display = "block";
  progressBar.style.width = "0%";

  const code = generateCode();
  const ext = (selectedFile.name.split(".").pop() || "bin").toLowerCase();
  const path = `${code}.${ext}`;

  try {
    await uploadFile(selectedFile, path);

    const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
    const { error: dbError } = await supabase.from("rooms").insert({
      code,
      media_url: pub.publicUrl,
      media_type: mediaKind(selectedFile),
      media_name: selectedFile.name,
    });

    if (dbError) throw dbError;

    localStorage.setItem(`nightcast_host_${code}`, "1");
    window.location.href = `room.html?code=${code}`;
  } catch (err) {
    console.error("Nightcast upload error:", err);
    showError(
      errorBox,
      `Upload failed: ${err.message || err}. Check that the "media" bucket exists, your Storage INSERT policy allows uploads, and the bucket file-size limit allows this file.`
    );
    resetCreateButton();
  }
});

function resetCreateButton() {
  createBtn.disabled = false;
  createBtn.textContent = "Create room";
  progressWrap.style.display = "none";
  progressBar.style.width = "0%";
}

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

joinBtn.addEventListener("click", async () => {
  if (!isConfigured) {
    showError(errorBox, "Add your Supabase URL and anon key in js/supabaseClient.js first — see README.");
    return;
  }

  const code = codeInput.value.trim();
  if (code.length < 4) {
    showError(errorBox, "Enter the room code your friend sent you.");
    return;
  }

  hideError(errorBox);
  joinBtn.disabled = true;
  joinBtn.textContent = "Checking…";

  const { data, error } = await supabase
    .from("rooms")
    .select("code")
    .eq("code", code)
    .maybeSingle();

  joinBtn.disabled = false;
  joinBtn.textContent = "Join room";

  if (error || !data) {
    showError(errorBox, "No room found with that code.");
    return;
  }

  window.location.href = `room.html?code=${code}`;
});

codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
