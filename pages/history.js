function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text == null ? "" : text);
  return div.innerHTML;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function meetingText(m) {
  const parts = [m.notes && m.notes.summary ? m.notes.summary : ""];
  if (m.notes && Array.isArray(m.notes.decisions)) {
    m.notes.decisions.forEach((d) => parts.push(typeof d === "string" ? d : d.text || ""));
  }
  if (m.notes && Array.isArray(m.notes.open_questions)) {
    m.notes.open_questions.forEach((q) => parts.push(typeof q === "string" ? q : q.text || ""));
  }
  if (m.segments) m.segments.forEach((s) => parts.push(s.text));
  return parts.join(" ").toLowerCase();
}

function countActions(m) {
  return m.notes && Array.isArray(m.notes.action_items) ? m.notes.action_items.length : 0;
}

function statusBadge(m) {
  if (m.notesError) return '<span class="badge error">notes failed</span>';
  if (!m.notesReady) return '<span class="badge pending">notes generating…</span>';
  if (m.notes) return '<span class="badge">notes ✓</span>';
  return "";
}

function cardHtml(m) {
  const preview =
    m.notes && m.notes.summary
      ? m.notes.summary.slice(0, 140)
      : m.segments && m.segments.length
        ? m.segments.slice(0, 2).map((s) => s.text).join(" ").slice(0, 140)
        : "no transcript captured";
  return `
    <div class="card">
      <button class="del" data-id="${m.startedAt}" title="delete meeting">✕</button>
      <a class="card-link" href="notes.html?id=${m.startedAt}" style="all: unset; cursor: pointer; display: block;">
        <div class="when">${fmtDate(m.startedAt)} ${statusBadge(m)}</div>
        <div class="stats">${fmtDuration(m.durationMs)} · ${m.segments ? m.segments.length : 0} lines · ${countActions(m)} action items</div>
        <div class="preview">${escapeHtml(preview)}…</div>
      </a>
    </div>`;
}

async function render() {
  const { meetings = [] } = await chrome.storage.local.get("meetings");
  const query = document.getElementById("search").value.trim().toLowerCase();
  const list = document.getElementById("list");

  if (!meetings.length) {
    list.innerHTML = `<div class="empty">No meetings yet — record one from the extension popup.</div>`;
    return;
  }

  const sorted = [...meetings].sort((a, b) => b.startedAt - a.startedAt);
  const filtered = query ? sorted.filter((m) => meetingText(m).includes(query)) : sorted;

  if (!filtered.length) {
    list.innerHTML = `<div class="empty">No meetings match "${escapeHtml(query)}".</div>`;
    return;
  }

  list.innerHTML = filtered.map(cardHtml).join("");

  list.querySelectorAll(".del").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const id = Number(btn.dataset.id);
      if (!confirm("Delete this meeting and its notes?")) return;
      const { meetings = [] } = await chrome.storage.local.get("meetings");
      await chrome.storage.local.set({
        meetings: meetings.filter((m) => m.startedAt !== id)
      });
      render();
    });
  });
}

document.getElementById("search").addEventListener("input", () => render());

const notionTokenInput = document.getElementById("notion-token");
const notionPageInput = document.getElementById("notion-page");
const notionStatus = document.getElementById("notion-status");

chrome.storage.local.get(["notionToken", "notionPageUrl", "notionDatabaseId"], (cfg) => {
  if (cfg.notionToken) notionTokenInput.placeholder = "token saved · paste to replace";
  if (cfg.notionPageUrl) notionPageInput.value = cfg.notionPageUrl;
  if (cfg.notionDatabaseId) notionStatus.textContent = "connected: tasks database ✓";
});

document.getElementById("notion-save").addEventListener("click", async () => {
  const token = notionTokenInput.value.trim();
  const pageUrl = notionPageInput.value.trim();
  if (!token || !pageUrl) {
    notionStatus.textContent = "both fields required";
    notionStatus.style.color = "#b3261e";
    return;
  }
  await chrome.storage.local.set({ notionToken: token, notionPageUrl: pageUrl });
  notionTokenInput.value = "";
  notionTokenInput.placeholder = "token saved · paste to replace";
  notionStatus.textContent = "connection saved — now create the tasks database";
  notionStatus.style.color = "#188038";
});

document.getElementById("notion-create-db").addEventListener("click", async () => {
  notionStatus.textContent = "creating…";
  notionStatus.style.color = "#5f6368";
  const res = await chrome.runtime.sendMessage({ type: "notion-create-db" });
  if (res && res.ok) {
    notionStatus.textContent = "tasks database created ✓ — open a notes page to push items";
    notionStatus.style.color = "#188038";
  } else {
    notionStatus.textContent = `failed: ${(res && res.error) || "unknown"}`;
    notionStatus.style.color = "#b3261e";
  }
});

render();
