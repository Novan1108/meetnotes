function fmtClock(t) {
  const s = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short"
  });
}

function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function itemText(item, textKey) {
  return typeof item === "string" ? item : item[textKey] || "";
}

function evidenceChips(item) {
  const ev = (item && typeof item === "object" && item.evidence) || [];
  return ev
    .map((e) => `<a class="ev" href="#seg-${e.i}">${fmtClock(e.t)}</a>`)
    .join("");
}

function listSection(title, items) {
  if (!items || !items.length) return "";
  const li = items
    .map(
      (i) =>
        `<li>${escapeHtml(itemText(i, "text"))}${evidenceChips(i)}</li>`
    )
    .join("");
  return `<section><h2>${title}</h2><ul>${li}</ul></section>`;
}

function actionsSection(items) {
  if (!items || !items.length) return "";
  const li = items
    .map(
      (a) =>
        `<li>${escapeHtml(itemText(a, "task"))}${
          a.owner && a.owner !== "unassigned"
            ? `<span class="owner">${escapeHtml(a.owner)}</span>`
            : ""
        }${evidenceChips(a)}</li>`
    )
    .join("");
  return `<section><h2>Action items</h2><ul>${li}</ul></section>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text == null ? "" : text);
  return div.innerHTML;
}

function toMarkdown(m) {
  const lines = [
    `# Meeting notes — ${fmtDate(m.startedAt)}`,
    ``,
    `**Duration:** ${fmtDuration(m.durationMs)}`,
    ``
  ];
  const n = m.notes;
  const evMarkdown = (e) =>
    e && e.length ? ` (${e.map((x) => fmtClock(x.t)).join(", ")})` : "";
  lines.push(`## Summary`, ``, n.summary, ``);
  if (n.decisions.length) {
    lines.push(
      `## Decisions`,
      ...n.decisions.map((d) => `- ${itemText(d, "text")}${evMarkdown(d.evidence)}`),
      ``
    );
  }
  if (n.action_items.length) {
    lines.push(
      `## Action items`,
      ...n.action_items.map(
        (a) => `- ${itemText(a, "task")}${a.owner && a.owner !== "unassigned" ? ` (${a.owner})` : ""}${evMarkdown(a.evidence)}`
      ),
      ``
    );
  }
  if (n.open_questions.length) {
    lines.push(
      `## Open questions`,
      ...n.open_questions.map((q) => `- ${itemText(q, "text")}${evMarkdown(q.evidence)}`),
      ``
    );
  }
  lines.push(
    `## Transcript`,
    ``,
    ...m.segments.map((s) => `**[${fmtClock(s.t)}] ${s.who}:** ${s.text}`),
    ``
  );
  return lines.join("\n");
}

async function render() {
  const { meetings = [] } = await chrome.storage.local.get("meetings");
  const content = document.getElementById("content");
  const meta = document.getElementById("meta");
  const copyBtn = document.getElementById("copy");

  if (!meetings.length) {
    content.innerHTML = `<p class="empty">No meetings recorded yet. Join a Google Meet call and press Start in the MeetNotes popup.</p>
      <p style="text-align:center"><a href="history.html" style="color:#1a73e8">History</a> · <a href="settings.html" style="color:#1a73e8">Settings</a></p>`;
    return;
  }

  const requestedId = new URLSearchParams(location.search).get("id");
  const m =
    (requestedId && meetings.find((x) => x.startedAt === Number(requestedId))) ||
    meetings[meetings.length - 1];
  meta.textContent = `${fmtDate(m.startedAt)} · ${fmtDuration(m.durationMs)} · ${m.segments.length} lines`;

  let html = "";
  if (m.tabError) {
    html += `<div class="error">Remote-audio transcript failed: ${escapeHtml(m.tabError)}</div>`;
  } else if (m.tabTranscriptSkipped) {
    html += `<div class="error">Remote audio was not transcribed (no API key at the time).</div>`;
  }

  if (m.notes && m.notesReady) {
    html += `<section><h2>Summary</h2><p>${escapeHtml(m.notes.summary)}</p></section>`;
    html += actionsSection(m.notes.action_items);
    html += listSection("Decisions", m.notes.decisions);
    html += listSection("Open questions", m.notes.open_questions);
    copyBtn.hidden = false;
  } else if (m.notesError) {
    html += `<div class="error">Notes generation failed: ${escapeHtml(m.notesError)}</div>`;
  } else {
    html += `<p class="empty">AI notes are still generating… reopen this page in a minute.</p>`;
  }

  const segs = m.segments
    .map(
      (s, i) =>
        `<div class="seg" id="seg-${i}"><span class="t">[${fmtClock(s.t)}]</span><span class="who-${
          s.who
        }">${escapeHtml(s.who)}</span>: ${escapeHtml(s.text)}</div>`
    )
    .join("");
  html += `<details><summary>Raw transcript (${m.segments.length} lines)</summary>${segs}</details>`;

  content.innerHTML = html;

  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(toMarkdown(m));
    copyBtn.textContent = "Copied ✓";
    setTimeout(() => (copyBtn.textContent = "Copy as markdown"), 1500);
  };

  const pushBtn = document.getElementById("notion-push");
  const setPushState = (text, disabled) => {
    pushBtn.textContent = text;
    pushBtn.disabled = !!disabled;
  };
  if (typeof m.notionPushed === "number") {
    setPushState(`Pushed ${m.notionPushed} ✓`, false);
  }
  const canPush =
    m.notes && m.notesReady && m.notes.action_items && m.notes.action_items.length;
  if (!canPush) {
    setPushState(m.notionPushed ? `Pushed ${m.notionPushed} ✓` : "No action items yet", true);
  }
  pushBtn.onclick = async () => {
    setPushState("Pushing…", true);
    const res = await chrome.runtime.sendMessage({
      type: "notion-push",
      startedAt: m.startedAt
    });
    if (res && res.ok) {
      setPushState(`Pushed ${res.count} ✓`, false);
    } else {
      setPushState(`Retry push (${(res && res.error) || "failed"})`, false);
    }
  };
}

render();
