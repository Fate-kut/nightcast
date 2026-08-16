import { supabase, isConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";
import { generateCode, showError, hideError, mediaKind } from "./util.js";
import { Upload } from "https://esm.sh/tus-js-client@4.1.0";

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

// ── file selection ──
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

// ── create room ──
// Uses Supabase's resumable (TUS) upload endpoint instead of the plain
// storage.upload() call — the plain endpoint buffers the whole request and
// rejects anything past a few dozen MB, which is why video files were
// failing. Resumable uploads are chunked, support files up to several GB,
// retry automatically, and give real progress.
createBtn.addEventListener("click", () => {
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

  const upload = new Upload(selectedFile, {
    endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    chunkSize: 6 * 1024 * 1024, // Supabase's TUS implementation requires exactly 6MB chunks
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: {
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      "x-upsert": "false",
    },
    metadata: {
      bucketName: "media",
      objectName: path,
      contentType: selectedFile.type || "application/octet-stream",
      cacheControl: "3600",
    },
    onError: (err) => {
      console.error(err);
      showError(
        errorBox,
        `Upload failed: ${err.message || err}. Check that the "media" bucket exists, is set to Public, and its file size limit is big enough for this file (Storage → media → Edit bucket).`
      );
      resetCreateButton();
    },
    onProgress: (sent, total) => {
      const pct = Math.round((sent / total) * 100);
      progressBar.style.width = pct + "%";
      createBtn.textContent = `Uploading… ${pct}%`;
    },
    onSuccess: async () => {
      try {
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
        console.error(err);
        showError(
          errorBox,
          `File uploaded, but the room couldn't be created: ${err.message || err}. Check that the "rooms" table and its policies exist (see README).`
        );
        resetCreateButton();
      }
    },
  });

  upload.findPreviousUploads().then((previous) => {
    if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
    upload.start();
  });
});

function resetCreateButton() {
  createBtn.disabled = false;
  createBtn.textContent = "Create room";
  progressWrap.style.display = "none";
}

// ── join room ──
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
