const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const lastEl = document.getElementById("lastSession");
const setupEl = document.getElementById("setup");

async function refreshSetup() {
  const cfg = await chrome.storage.local.get(["groqKey", "notionToken", "notionDatabaseId", "autoRecord"]);
  const needs = [];
  if (!cfg.groqKey) needs.push("Groq key missing — add in Settings");
  if (!cfg.notionDatabaseId) needs.push("Notion not connected — History ⚙");
  if (!cfg.autoRecord) needs.push("auto-record off");
  setupEl.textContent = needs.length ? needs.join(" · ") : "";
  setupEl.style.display = needs.length ? "block" : "none";
}

function getStreamId(tabId) {
  return new Promise((resolve) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) =>
      resolve(id || null)
    );
  });
}

async function activeMeetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/meet\.google\.com\/[a-z-]+/.test(tab.url || "")) {
    return null;
  }
  return tab;
}

async function refresh() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
  let state;
  try {
    state = await Promise.race([
      chrome.runtime.sendMessage({ type: "get-state" }),
      timeout
    ]);
  } catch (err) {
    statusTextEl.textContent = "worker error — see chrome://extensions → MeetNotes → Errors";
    statusEl.classList.add("rec");
    return;
  }
  if (!state) {
    statusTextEl.textContent = "no response — reload the extension";
    statusEl.classList.add("rec");
    return;
  }
  if (state.error) {
    statusTextEl.textContent = `worker: ${String(state.error).slice(0, 60)}`;
    statusEl.classList.add("rec");
    return;
  }
  statusTextEl.textContent = state.recording
    ? `recording · ${state.transcriptLines} lines`
    : state.transcribing
      ? "transcribing remote audio…"
      : "idle";
  statusEl.classList.toggle("rec", !!state.recording || !!state.transcribing);
  if (state.lastSession) {
    const s = state.lastSession;
    let text = `last meeting: ~${Math.round(s.durationMs / 1000)}s, ${s.lines} your lines, ${s.remoteLines ?? 0} remote lines`;
    if (s.tabTranscriptSkipped) text += " · tab transcript skipped (no API key)";
    if (s.tabError) text += ` · tab error: ${String(s.tabError).slice(0, 60)}`;
    if (s.notesReady === false) text += " · AI notes generating…";
    else if (s.notesError) text += ` · notes error: ${String(s.notesError).slice(0, 50)}`;
    else if (s.notesReady) text += " · AI notes ready ✓";
    lastEl.textContent = text;
  }
}

document.getElementById("start").addEventListener("click", async () => {
  const tab = await activeMeetTab();
  if (!tab) {
    statusTextEl.textContent = "open a Google Meet call first";
    return;
  }
  const streamId = await getStreamId(tab.id);
  if (!streamId) {
    statusTextEl.textContent = "could not get tab audio permission";
    return;
  }
  await chrome.runtime.sendMessage({
    type: "start-capture",
    streamId,
    tabId: tab.id
  });
  refresh();
});

document.getElementById("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stop-capture" });
  refresh();
});

document.getElementById("open-notes").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("pages/notes.html") });
});

document.getElementById("open-history").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("pages/history.html") });
});

document.getElementById("open-settings").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("pages/settings.html") });
});

document.getElementById("open-analytics").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("pages/analytics.html") });
});

const keyInput = document.getElementById("api-key");
const keyStatus = document.getElementById("key-status");
const saveBtn = document.getElementById("save-key");

chrome.storage.local.get("groqKey", async ({ groqKey }) => {
  if (groqKey) {
    keyInput.placeholder = "key saved · paste to replace";
    return;
  }
  try {
    const res = await fetch(chrome.runtime.getURL("secrets.txt"));
    if (!res.ok) return;
    const key = (await res.text()).trim();
    if (key) {
      await chrome.storage.local.set({ groqKey: key });
      keyInput.placeholder = "key loaded from secrets.txt ✓";
    }
  } catch (err) {}
});

saveBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "enter a key first";
    keyStatus.style.color = "#d93025";
    return;
  }
  await chrome.storage.local.set({ groqKey: key });
  keyInput.value = "";
  keyInput.placeholder = "key saved · paste to replace";
  keyStatus.textContent = "saved ✓";
  keyStatus.style.color = "#188038";
  setTimeout(() => (keyStatus.textContent = ""), 2000);
});

refresh();
setInterval(refresh, 2000);
refreshSetup();
setInterval(refreshSetup, 5000);

document.getElementById("ver").textContent =
  "v" + chrome.runtime.getManifest().version;
