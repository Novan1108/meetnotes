const LANGS = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["en-IN", "English (India)"],
  ["es-ES", "Spanish (Spain)"],
  ["fr-FR", "French (France)"],
  ["de-DE", "German (Germany)"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["it-IT", "Italian (Italy)"],
  ["ru-RU", "Russian"],
  ["hi-IN", "Hindi (India)"],
  ["zh-CN", "Chinese (Mandarin)"],
  ["ja-JP", "Japanese"],
  ["ko-KR", "Korean"],
  ["ar-SA", "Arabic"]
];

const langSelect = document.getElementById("lang");
const autoRecord = document.getElementById("auto-record");
const autoDelay = document.getElementById("auto-delay");
const saved = document.getElementById("saved");

LANGS.forEach(([code, label]) => {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = label;
  langSelect.appendChild(opt);
});

chrome.storage.local.get(
  ["speechLang", "autoRecord", "autoDelaySecs"],
  ({ speechLang, autoRecord: auto, autoDelaySecs }) => {
    langSelect.value = speechLang || "en-US";
    autoRecord.checked = !!auto;
    autoDelay.value = String(autoDelaySecs == null ? 10 : autoDelaySecs);
  }
);

function flashSave() {
  saved.textContent = "Saved ✓";
  setTimeout(() => (saved.textContent = ""), 1500);
}

langSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ speechLang: langSelect.value });
  flashSave();
});

autoRecord.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoRecord: autoRecord.checked });
  flashSave();
});

autoDelay.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoDelaySecs: Number(autoDelay.value) });
  flashSave();
});

document.getElementById("clear-meetings").addEventListener("click", async () => {
  if (!confirm("Delete every stored meeting, transcript, and note?")) return;
  await chrome.storage.local.remove("meetings");
  alert("All meetings deleted.");
});

document.getElementById("ver").textContent =
  "v" + chrome.runtime.getManifest().version;
