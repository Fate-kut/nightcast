const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

export function generateCode(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function showError(el, message) {
  el.textContent = message;
  el.style.display = "block";
}

export function hideError(el) {
  el.style.display = "none";
}

export function mediaKind(file) {
  return file.type.startsWith("video") ? "video" : "audio";
}
