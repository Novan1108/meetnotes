let session = null;
let pendingSession = null;
let lastSession = null;
let chunkCount = 0;
let transcribing = false;
let offscreenReadyResolve = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  return contexts.length > 0;
}

async function ensureOffscreenReady() {
  let exists = false;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    exists = contexts.length > 0;
  } catch (err) {
    exists = false;
  }
  if (exists) return true;
  try {
    await chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Capture Google Meet tab audio for meeting notes"
    });
  } catch (err) {
    if (!/offscreen document/i.test(String(err))) throw err;
  }
  await Promise.race([
    new Promise((resolve) => {
      offscreenReadyResolve = resolve;
    }),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  return true;
}

async function persistMeeting(record) {
  const { meetings = [] } = await chrome.storage.local.get("meetings");
  meetings.push(record);
  await chrome.storage.local.set({ meetings: meetings.slice(-100) });
}

async function updateMeetingRecord(startedAt, patch) {
  const { meetings = [] } = await chrome.storage.local.get("meetings");
  const idx = meetings.findIndex((m) => m.startedAt === startedAt);
  if (idx >= 0) {
    meetings[idx] = { ...meetings[idx], ...patch };
    await chrome.storage.local.set({ meetings });
  }
}
const NOTION_API = "https://api.notion.com/v1";
const NOTION_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  "Notion-Version": "2022-06-11",
  "Content-Type": "application/json"
});

function notionPageId(source) {
  const match = String(source || "").match(/[0-9a-f]{32}/i);
  return match ? match[0] : null;
}

async function notionRequest(path, token, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: NOTION_HEADERS(token),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 150)}`);
  }
  return await res.json();
}

function meetingDateLabel(startedAt) {
  return new Date(startedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getStreamId(tabId) {
  return new Promise((resolve) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) =>
      resolve(id || null)
    );
  });
}

async function beginCapture(streamId, tabId) {
  const ready = await ensureOffscreenReady();
  if (!ready) return { ok: false, error: "offscreen document failed to start" };
  session = {
    startedAt: Date.now(),
    tabId,
    lines: []
  };
  chunkCount = 0;
  transcribing = false;
  chrome.runtime.sendMessage({ type: "offscreen-start", streamId });
  chrome.action.setBadgeText({ text: "REC" });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "get-state":
        sendResponse({
          recording: !!session,
          transcriptLines: session ? session.lines.length : 0,
          transcribing,
          lastSession
        });
        break;

      case "start-capture": {
        if (session) {
          sendResponse({ ok: false, error: "already recording" });
          break;
        }
        sendResponse(await beginCapture(msg.streamId, msg.tabId));
        break;
      }

      case "request-auto-start": {
        const { autoRecord } = await chrome.storage.local.get("autoRecord");
        if (!autoRecord || session || !(sender.tab && sender.tab.id)) {
          sendResponse({ ok: false, error: "auto-record disabled or already recording" });
          break;
        }
        const streamId = await getStreamId(sender.tab.id);
        if (!streamId) {
          sendResponse({ ok: false, error: "tab capture permission missing" });
          break;
        }
        sendResponse(await beginCapture(streamId, sender.tab.id));
        break;
      }

      case "request-auto-record-gate": {
        const { autoRecord } = await chrome.storage.local.get("autoRecord");
        sendResponse({ gated: !!autoRecord && !session });
        break;
      }

      case "stop-capture": {
        if (!session) {
          sendResponse({ ok: false, error: "not recording" });
          break;
        }
        pendingSession = session;
        session = null;
        chrome.action.setBadgeText({ text: "" });
        chrome.runtime.sendMessage({ type: "offscreen-stop" });
        sendResponse({ ok: true });
        break;
      }

      case "transcript-line":
        if (session) session.lines.push({ text: msg.text, at: msg.at });
        break;

      case "tab-audio-status":
        transcribing = !!msg.transcribing;
        break;

      case "offscreen-ready":
        if (offscreenReadyResolve) {
          offscreenReadyResolve();
          offscreenReadyResolve = null;
        }
        break;

      case "audio-chunk":
        chunkCount += 1;
        break;

      case "offscreen-stopped": {
        transcribing = false;
        if (pendingSession) {
          const micSegs = pendingSession.lines.map((l) => ({
            t: (l.at - pendingSession.startedAt) / 1000,
            who: "you",
            text: l.text
          }));
          const remoteSegs =
            msg.tabTranscript && Array.isArray(msg.tabTranscript.segments)
              ? msg.tabTranscript.segments.filter((s) => s.text)
              : [];
          const segments = [...micSegs, ...remoteSegs].sort((a, b) => a.t - b.t);
          const record = {
            startedAt: pendingSession.startedAt,
            endedAt: Date.now(),
            durationMs: msg.durationMs,
            chunks: msg.chunks,
            segments,
            tabError: msg.tabTranscript && msg.tabTranscript.error ? msg.tabTranscript.error : null,
            tabTranscriptSkipped: msg.tabTranscript === null
          };
          await persistMeeting(record);
          lastSession = {
            durationMs: record.durationMs,
            chunks: record.chunks,
            lines: micSegs.length,
            remoteLines: remoteSegs.length,
            tabError: record.tabError,
            tabTranscriptSkipped: record.tabTranscriptSkipped,
            notesReady: false,
            notesError: null
          };
          pendingSession = null;
          chrome.runtime.sendMessage({
            type: "offscreen-generate-notes",
            record
          });
        }
        break;
      }

      case "notes-done": {
        const patch = msg.error
          ? { notesReady: true, notesError: msg.error }
          : { notes: msg.notes, notesReady: true, notesError: null };
        await updateMeetingRecord(msg.startedAt, patch);
        if (lastSession && lastSession.notesReady === false) {
          lastSession.notesReady = true;
          lastSession.notesError = msg.error || null;
        }
        if (!session && !pendingSession) {
          try {
            const contexts = await chrome.runtime.getContexts({
              contextTypes: ["OFFSCREEN_DOCUMENT"]
            });
            if (contexts.length > 0) await chrome.offscreen.closeDocument();
          } catch (err) {}
        }
        break;
      }

      case "notion-config": {
        const cfg = await chrome.storage.local.get(["notionToken", "notionPageUrl"]);
        sendResponse({
          hasToken: !!cfg.notionToken,
          hasPage: !!cfg.notionPageUrl,
          databaseId: cfg.notionDatabaseId || null
        });
        break;
      }

      case "notion-create-db": {
        try {
          const { notionToken, notionPageUrl } = await chrome.storage.local.get([
            "notionToken",
            "notionPageUrl"
          ]);
          const pageId = notionPageId(notionPageUrl);
          if (!notionToken || !pageId) {
            sendResponse({ ok: false, error: "save token and page link first" });
            break;
          }
          const db = await notionRequest("/databases", notionToken, {
            parent: { type: "page_id", page_id: pageId },
            title: [{ type: "text", text: { content: "MeetNotes Tasks" } }],
            properties: {
              Name: { title: {} },
              Owner: { rich_text: {} },
              From: { rich_text: {} },
              Done: { checkbox: {} }
            }
          });
          await chrome.storage.local.set({ notionDatabaseId: db.id });
          sendResponse({ ok: true, databaseId: db.id });
        } catch (err) {
          sendResponse({ ok: false, error: String(err).slice(0, 180) });
        }
        break;
      }

      case "notion-push": {
        try {
          const { meetings = [], notionToken, notionDatabaseId } =
            await chrome.storage.local.get([
              "meetings",
              "notionToken",
              "notionDatabaseId"
            ]);
          const meeting = meetings.find((m) => m.startedAt === msg.startedAt);
          const items =
            meeting &&
            meeting.notes &&
            meeting.notesReady &&
            Array.isArray(meeting.notes.action_items)
              ? meeting.notes.action_items
              : [];
          if (!notionToken || !notionDatabaseId) {
            sendResponse({ ok: false, error: "complete Notion setup in History first" });
            break;
          }
          if (!items.length) {
            sendResponse({ ok: false, error: "no action items to push" });
            break;
          }
          const label = meetingDateLabel(meeting.startedAt);
          const pushItem = (task, owner) =>
            notionRequest("/pages", notionToken, {
              parent: { database_id: notionDatabaseId },
              properties: {
                Name: { title: [{ text: { content: task } }] },
                Owner: { rich_text: [{ text: { content: owner || "unassigned" } }] },
                From: { rich_text: [{ text: { content: label } }] },
                Done: { checkbox: false }
              }
            });
          let count = 0;
          const failures = [];
          for (const item of items) {
            const task = typeof item === "string" ? item : item.task || "";
            const owner = typeof item === "string" ? "unassigned" : item.owner;
            if (!task) continue;
            try {
              await pushItem(task, owner);
              count += 1;
            } catch (err) {
              failures.push(String(err).slice(0, 150));
            }
          }
          if (count && meeting) {
            await updateMeetingRecord(meeting.startedAt, {
              notionPushed: count,
              notionPushedAt: Date.now()
            });
          }
          sendResponse({
            ok: count > 0,
            count,
            error: count ? (failures.length ? `${failures.length} failed` : null) : failures[0]
          });
        } catch (err) {
          sendResponse({ ok: false, error: String(err).slice(0, 180) });
        }
        break;
      }

      case "capture-error": {
        transcribing = false;
        if (pendingSession) {
          await persistMeeting({
            startedAt: pendingSession.startedAt,
            endedAt: Date.now(),
            durationMs: 0,
            chunks: 0,
            segments: [],
            tabError: null
          });
          pendingSession = null;
        } else if (session) {
          session = null;
          lastSession = { durationMs: 0, chunks: 0, lines: 0, remoteLines: 0 };
        }
        chrome.action.setBadgeText({ text: "" });
        try {
          if (await hasOffscreen()) await chrome.offscreen.closeDocument();
        } catch (err) {}
        break;
      }
    }
  })().catch((err) => {
    try {
      sendResponse({ error: String(err).slice(0, 200) });
    } catch (e) {}
  });
  return true;
});
