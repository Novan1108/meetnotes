let active = false;
let micAllowed = true;
let recognition = null;

const root = document.createElement("div");
root.id = "meetnotes-overlay";

const statusPill = document.createElement("div");
statusPill.className = "mn-status";
statusPill.textContent = "NoteAssist: idle";

const interimLine = document.createElement("div");
interimLine.className = "mn-interim";

const micLine = document.createElement("div");
micLine.className = "mn-mic-state";

const transcriptPanel = document.createElement("div");
transcriptPanel.className = "mn-transcript";
transcriptPanel.appendChild(micLine);
transcriptPanel.appendChild(interimLine);

root.appendChild(statusPill);
root.appendChild(transcriptPanel);
document.body.appendChild(root);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "recording-state") {
    active = !!msg.active;
    micAllowed = true;
    statusPill.textContent = active
      ? "NoteAssist: listening"
      : "NoteAssist: idle";
    root.classList.toggle("active", active);
    if (active) {
      stopCountdown();
      startRecognition();
    } else {
      stopRecognition();
    }
    clearPanel();
  }
  if (msg.type === "capture-error") {
    active = false;
    statusPill.textContent = "NoteAssist: capture failed — restart from the popup";
    root.classList.remove("active");
    stopRecognition();
  }
  if (msg.type === "auto-start-failed") {
    statusPill.textContent = `NoteAssist: auto-record failed (${msg.reason || "unknown"})`;
  }
});

function clearPanel() {
  interimLine.textContent = "";
  [...transcriptPanel.querySelectorAll(".mn-line")].forEach((n) => n.remove());
}

function setInterim(text) {
  interimLine.textContent = text;
  transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
}

function addLine(text) {
  interimLine.textContent = "";
  const line = document.createElement("div");
  line.className = "mn-line";
  line.textContent = text;
  transcriptPanel.insertBefore(line, interimLine);
  while (transcriptPanel.querySelectorAll(".mn-line").length > 40) {
    const first = transcriptPanel.querySelector(".mn-line");
    if (first) first.remove();
  }
  transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
}

async function probeMicPermission() {
  try {
    const st = await navigator.permissions.query({ name: "microphone" });
    if (st.state === "denied") {
      setMicState("mic: ✕ BLOCKED — allow meet.google.com in the address bar");
    } else if (st.state === "prompt") {
      setMicState("mic: permission not granted yet — allow it in the address bar");
    }
  } catch {}
}

function setMicState(text) {
  micLine.textContent = text;
}

async function startRecognition() {
  stopRecognition();
  const { speechLang } = await chrome.storage.local.get("speechLang");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setMicState("mic: unavailable in this Chrome");
    statusPill.textContent = "NoteAssist: speech recognition unavailable";
    return;
  }
  setMicState("mic: starting…");
  probeMicPermission();
  const rec = new SR();
  recognition = rec;
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = speechLang || "en-US";

  rec.onresult = (event) => {
    micRetries = 0;
    abortedRuns = 0;
    setMicState("mic: listening ✓ (speak — lines appear here)");
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const text = [...result].map((alt) => alt.transcript).join("").trim();
        if (text) {
          addLine(text);
          chrome.runtime.sendMessage({ type: "transcript-line", text, at: Date.now() });
        }
      } else {
        interim += [...result].map((alt) => alt.transcript).join("");
      }
    }
    setInterim(interim);
  };

  rec.onend = () => {
    if (!active || recognition !== rec || !micAllowed) return;
    setTimeout(() => {
      if (active && recognition === rec && micAllowed) safeStart(rec);
    }, 250);
  };

  rec.onerror = (event) => {
    const err = event.error;
    if (err === "no-speech") return;
    if (err === "aborted") {
      abortedRuns++;
      if (abortedRuns >= 5 && active) {
        setMicState("mic: keeps restarting — reload the Meet tab");
      }
      return;
    }
    abortedRuns = 0;
    if (err === "not-allowed") {
      micAllowed = false;
      active = false;
      statusPill.textContent = "NoteAssist: mic blocked — check browser permissions";
      root.classList.remove("active");
      setMicState("mic: ✕ blocked — allow the site microphone permission");
      return;
    }
    const reasons = {
      "service-not-allowed": "blocked by the browser — try reloading",
      "audio-capture": "no microphone found by Chrome — check Windows default input device",
      network: "network error — the speech service is unreachable",
      "language-not-supported": `language "${rec.lang}" is not supported`,
    };
    setMicState(`mic: ✕ ${reasons[err] || err}`);
    statusPill.textContent = "NoteAssist: mic error — see status in the transcript panel";
  };

  safeStart(rec);
  statusPill.textContent = "NoteAssist: listening";
}

function safeStart(rec) {
  try {
    rec.start();
  } catch {
    micRetries++;
    if (micRetries <= 8 && active) {
      setTimeout(() => {
        if (active && recognition === rec) safeStart(rec);
      }, 400);
    } else {
      setMicState("mic: failed to start — reload the Meet tab");
    }
  }
}

function stopRecognition() {
  if (recognition) {
    const rec = recognition;
    recognition = null;
    rec.onend = null;
    rec.onresult = null;
    rec.onerror = null;
    try {
      rec.stop();
    } catch {}
  }
  micRetries = 0;
  abortedRuns = 0;
  interimLine.textContent = "";
  if (active) setMicState("mic: starting…");
  else setMicState("");
}

let micRetries = 0;
let abortedRuns = 0;

let countdownTimer = null;

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function reallyAutoStart() {
  chrome.runtime.sendMessage({ type: "request-auto-start" }, (res) => {
    if (res && res.ok === false && res.error) {
      statusPill.textContent = `NoteAssist: auto-record failed (${res.error})`;
      root.classList.remove("active");
    }
  });
}

function startCountdown() {
  const root2 = root;
  chrome.storage.local.get("autoDelaySecs", ({ autoDelaySecs }) => {
    const delay = autoDelaySecs == null ? 10 : autoDelaySecs;
    if (delay === 0) {
      reallyAutoStart();
      return;
    }
    let remaining = delay;
    const cancel = document.createElement("button");
    cancel.textContent = "cancel ✕";
    cancel.style.cssText =
      "margin-left:8px;background:#f1f3f4;border:none;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:10px;";
    const updatePill = () => {
      statusPill.textContent = `NoteAssist: auto-record starts in ${remaining}s`;
      if (!cancel.parentElement) statusPill.appendChild(cancel);
    };
    updatePill();
    cancel.onclick = () => {
      stopCountdown();
      statusPill.textContent = "NoteAssist: auto-record skipped — start manually";
      root2.classList.remove("active");
    };
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        stopCountdown();
        reallyAutoStart();
        return;
      }
      updatePill();
    }, 1000);
  });
}

if (!/\/(newcall|landing|home|join|demolobby)/.test(location.pathname)) {
  chrome.runtime.sendMessage(
    { type: "request-auto-record-gate" },
    (res) => {
      if (res && res.gated) startCountdown();
    }
  );
}

statusPill.addEventListener("click", () => {
  root.classList.toggle("collapsed");
});
