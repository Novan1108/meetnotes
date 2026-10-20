let active = false;
let micAllowed = true;
let recognition = null;

const root = document.createElement("div");
root.id = "meetnotes-overlay";

const statusPill = document.createElement("div");
statusPill.className = "mn-status";
statusPill.textContent = "MeetNotes: idle";

const interimLine = document.createElement("div");
interimLine.className = "mn-interim";

const transcriptPanel = document.createElement("div");
transcriptPanel.className = "mn-transcript";
transcriptPanel.appendChild(interimLine);

root.appendChild(statusPill);
root.appendChild(transcriptPanel);
document.body.appendChild(root);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "recording-state") {
    active = !!msg.active;
    micAllowed = true;
    statusPill.textContent = active
      ? "MeetNotes: listening"
      : "MeetNotes: idle";
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
    statusPill.textContent = "MeetNotes: capture failed — restart from the popup";
    root.classList.remove("active");
    stopRecognition();
  }
  if (msg.type === "auto-start-failed") {
    statusPill.textContent = `MeetNotes: auto-record failed (${msg.reason || "unknown"})`;
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

async function startRecognition() {
  const { speechLang } = await chrome.storage.local.get("speechLang");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    statusPill.textContent = "MeetNotes: speech recognition unavailable";
    return;
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = speechLang || "en-US";

  recognition.onresult = (event) => {
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

  recognition.onend = () => {
    if (active && micAllowed && recognition) recognition.start();
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed") {
      micAllowed = false;
      active = false;
      statusPill.textContent = "MeetNotes: mic blocked — check browser permissions";
      root.classList.remove("active");
    }
  };

  recognition.start();
  statusPill.textContent = "MeetNotes: listening";
}

function stopRecognition() {
  if (recognition) {
    const rec = recognition;
    recognition = null;
    rec.onend = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.stop();
  }
  interimLine.textContent = "";
}

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
      statusPill.textContent = `MeetNotes: auto-record failed (${res.error})`;
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
      statusPill.textContent = `MeetNotes: auto-record starts in ${remaining}s`;
      if (!cancel.parentElement) statusPill.appendChild(cancel);
    };
    updatePill();
    cancel.onclick = () => {
      stopCountdown();
      statusPill.textContent = "MeetNotes: auto-record skipped — start manually";
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
