let recorder = null;
let chunks = [];
let startedAt = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "offscreen-start") start(msg.streamId);
  if (msg.type === "offscreen-stop") stop();
  if (msg.type === "offscreen-generate-notes") runNotesJob(msg.record);
});

chrome.runtime.sendMessage({ type: "offscreen-ready" });

async function start(streamId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      }
    });
    recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 32000
    });
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) {
        chunks.push(e.data);
        chrome.runtime.sendMessage({ type: "audio-chunk" });
      }
    };
    recorder.start(10000);
    startedAt = Date.now();
    stream.getTracks().forEach((t) => (t.onended = () => stop()));
    chrome.runtime.sendMessage({ type: "recording-state", active: true });
    chrome.runtime.sendMessage({ type: "tab-audio-status", transcribing: false });
  } catch (err) {
    chrome.runtime.sendMessage({ type: "capture-error", error: String(err) });
  }
}

function stop() {
  if (!recorder || recorder.state === "inactive") {
    chrome.runtime.sendMessage({
      type: "offscreen-stopped",
      durationMs: 0,
      chunks: 0,
      tabTranscript: null
    });
    return;
  }
  const rec = recorder;
  const duration = Date.now() - startedAt;
  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
    let tabTranscript = null;
    if (blob.size > 0) {
      chrome.runtime.sendMessage({ type: "tab-audio-status", transcribing: true });
      try {
        tabTranscript = await transcribeTabAudio(blob);
      } catch (err) {
        tabTranscript = { error: String(err) };
      }
    }
    chrome.runtime.sendMessage({
      type: "offscreen-stopped",
      durationMs: duration,
      chunks: chunks.length,
      tabTranscript
    });
    rec.stream.getTracks().forEach((t) => t.stop());
    recorder = null;
  };
  rec.stop();
}

function getGroqKey() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-token" }, (res) =>
      resolve(res ? res.groqKey : null)
    );
  });
}

async function transcribeTabAudio(blob) {
  const groqKey = await getGroqKey();
  if (!groqKey) return null;
  const form = new FormData();
  form.append("file", blob, "meeting.webm");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey}` },
    body: form
  });
  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const segments = (data.segments || []).map((s) => ({
    t: s.start,
    who: "others",
    text: (s.text || "").trim()
  }));
  return { segments };
}

const NOTES_MODEL = "llama-3.3-70b-versatile";

const NOTES_SYSTEM_PROMPT =
  "You are a meticulous meeting-notes assistant. You receive a transcript where each line has an ID (L00, L01...), a timestamp, and a speaker ('you' or 'others')." +
  " Return STRICT JSON only, with exactly these keys: " +
  '{"summary": string, "decisions": [{"text": string, "evidence": string[]}], "action_items": [{"task": string, "owner": string, "evidence": string[]}], "open_questions": [{"text": string, "evidence": string[]}]}' +
  " Rules:" +
  " - summary: 3-5 sentences covering the purpose, key discussion, and outcomes." +
  " - Every decision, action item, and open question MUST include at least one line ID in evidence, citing lines that genuinely support it. Only cite IDs that exist in the transcript." +
  " - Owners: use a person's name if the transcript names one, otherwise 'you', 'others', or 'unassigned'." +
  " - Write everything in the same language as the transcript." +
  " - Keep items short, specific, and atomic (one point per item). Do not invent facts." +
  ' Output shape example: {"summary": "...", "decisions": [{"text": "Launch on Friday", "evidence": ["L04"]}], "action_items": [{"task": "Email the client", "owner": "you", "evidence": ["L07", "L08"]}], "open_questions": []}';

function fmtClockForNotes(t) {
  const s = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function collectEvidenceRefs(evidenceArr, segmentCount) {
  if (!Array.isArray(evidenceArr)) return [];
  const refs = [];
  for (const e of evidenceArr) {
    const match = /^L(\d+)$/.exec(String(e).trim());
    const i = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isNaN(i) && i >= 0 && i < segmentCount && !refs.some((r) => r.i === i)) {
      refs.push(i);
    }
  }
  return refs;
}

function validateNotes(parsed, segments) {
  const withRefs = (items, textKey, hasOwner) => {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && (typeof item === "string" || item[textKey]))
      .map((item) => {
        if (typeof item === "string") {
          return { [textKey]: item, evidence: [] };
        }
        return {
          ...(hasOwner ? { owner: item.owner || "unassigned" } : {}),
          [textKey]: String(item[textKey] || ""),
          evidence: collectEvidenceRefs(item.evidence, segments.length).map((i) => ({
            i,
            t: segments[i].t
          }))
        };
      });
  };
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    decisions: withRefs(parsed.decisions, "text", false),
    action_items: withRefs(parsed.action_items, "task", true),
    open_questions: withRefs(parsed.open_questions, "text", false)
  };
}

async function generateNotes(record) {
  const groqKey = await getGroqKey();
  if (!groqKey) throw new Error("no Groq API key saved");
  if (!record.segments.length) throw new Error("empty transcript");
  const numbered = record.segments
    .map(
      (s, i) => `L${String(i).padStart(2, "0")} [${fmtClockForNotes(s.t)}] ${s.who}: ${s.text}`
    )
    .join("\n");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: NOTES_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: NOTES_SYSTEM_PROMPT },
        { role: "user", content: `Meeting transcript:\n\n${numbered}` }
      ]
    })
  });
  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 150)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return validateNotes(parsed, record.segments);
}

async function runNotesJob(record) {
  try {
    const notes = await generateNotes(record);
    chrome.runtime.sendMessage({
      type: "notes-done",
      startedAt: record.startedAt,
      notes
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "notes-done",
      startedAt: record.startedAt,
      error: String(err).slice(0, 200)
    });
  }
}
