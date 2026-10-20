function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium" });
}

function talkTimeSecs(m) {
  if (!m.segments || m.segments.length === 0) return { you: 0, others: 0 };
  const segs = [...m.segments].sort((a, b) => a.t - b.t);
  let you = 0;
  let others = 0;
  for (let i = 0; i < segs.length; i++) {
    const gap = i < segs.length - 1 ? segs[i + 1].t - segs[i].t : 20;
    const d = Math.min(Math.max(gap, 3), 45);
    if (segs[i].who === "you") you += d;
    else others += d;
  }
  return { you, others };
}

function weekIndex(ts) {
  const d = new Date(ts);
  const monday = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() - ((d.getDay() + 6) % 7)
  );
  monday.setHours(0, 0, 0, 0);
  return Math.floor((Date.now() - monday.getTime()) / 604800000);
}

function fmtSecs(s) {
  const m = Math.round(s / 60);
  return m >= 1 ? `${m}m` : `${Math.round(s)}s`;
}

function barHtml(pctYou, heightClass) {
  const you = Math.round(pctYou);
  return `<div class="bar ${heightClass}"><div class="you" style="width:${you}%"></div><div class="others" style="width:${
    100 - you
  }%"></div></div>`;
}

function weeklyChartSvg(buckets) {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.meetings, b.actions)));
  const w = 480;
  const base = 200;
  const colW = w / buckets.length;
  let svg = `<svg viewBox="0 0 ${w} 230" style="width:100%">
    <line x1="0" y1="${base}" x2="${w}" y2="${base}" stroke="#e0e0e0"/>`;
  buckets.forEach((b, i) => {
    const x = i * colW + colW / 2;
    const hM = (b.meetings / max) * 150;
    const hA = (b.actions / max) * 150;
    svg += `<rect x="${x - 21}" y="${base - hM}" width="18" height="${Math.max(
      hM,
      b.meetings ? 2 : 0
    )}" rx="3" fill="#1a73e8"><title>${b.label}: ${b.meetings} meetings</title></rect>`;
    svg += `<rect x="${x + 3}" y="${base - hA}" width="18" height="${Math.max(
      hA,
      b.actions ? 2 : 0
    )}" rx="3" fill="#188038"><title>${b.label}: ${b.actions} action items</title></rect>`;
    svg += `<text x="${x}" y="220" font-size="10" fill="#5f6368" text-anchor="middle">${b.label}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function render() {
  chrome.storage.local.get("meetings", ({ meetings = [] }) => {
    const root = document.getElementById("root");

    if (!meetings.length) {
      root.innerHTML = `<div class="empty">No meetings yet — analytics appear after your first recording.</div>`;
      return;
    }

    const sorted = [...meetings].sort((a, b) => b.startedAt - a.startedAt);

    let totalTalk = { you: 0, others: 0 };
    let totalActions = 0;
    let totalDecisions = 0;
    let totalMs = 0;
    const buckets = new Map();
    for (let i = 0; i < 8; i++) {
      buckets.set(i, { meetings: 0, actions: 0, decisions: 0 });
    }
    const labels = new Map();
    const d = new Date();
    for (let i = 0; i < 8; i++) {
      const monday = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate() - ((d.getDay() + 6) % 7) - i * 7
      );
      labels.set(
        i,
        i === 0
          ? "this wk"
          : i === 1
            ? "last wk"
            : `${monday.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
      );
    }

    sorted.forEach((m) => {
      totalTalk = {
        you: totalTalk.you + talkTimeSecs(m).you,
        others: totalTalk.others + talkTimeSecs(m).others
      };
      totalMs += m.durationMs || 0;
      if (m.notes && m.notesReady) {
        if (Array.isArray(m.notes.action_items)) totalActions += m.notes.action_items.length;
        if (Array.isArray(m.notes.decisions)) totalDecisions += m.notes.decisions.length;
      }
      const wk = weekIndex(m.startedAt);
      if (wk >= 0 && wk < 8 && buckets.has(wk)) {
        const b = buckets.get(wk);
        b.meetings += 1;
        if (m.notes && m.notesReady) {
          b.actions += Array.isArray(m.notes.action_items) ? m.notes.action_items.length : 0;
          b.decisions += Array.isArray(m.notes.decisions) ? m.notes.decisions.length : 0;
        }
      }
    });

    const totalTalkSecs = totalTalk.you + totalTalk.others || 1;
    const pctYou = (totalTalk.you / totalTalkSecs) * 100;

    const rows = sorted
      .slice(0, 10)
      .map((m) => {
        const t = talkTimeSecs(m);
        const p = (t.you / (t.you + t.others || 1)) * 100;
        return `<tr><td>${fmtDate(m.startedAt)}</td><td>${fmtDuration(m.durationMs)}</td><td>${fmtSecs(
          t.you
        )}</td><td>${fmtSecs(t.others)}</td><td><span class="mini">${barHtml(
          p,
          ""
        ).replace('<div class="bar ">', '<div class="bar" style="width:120px">')}</span></td><td>${
          m.notes && m.notesReady && Array.isArray(m.notes.action_items)
            ? m.notes.action_items.length
            : 0
        }</td></tr>`;
      })
      .join("");

    const bucketArr = [...buckets.entries()].map(([i, b]) => ({ ...b, label: labels.get(i) }));
    const chart = weeklyChartSvg(bucketArr);

    root.innerHTML = `
      <div class="cards">
        <div class="card"><div class="n">${meetings.length}</div><div class="l">meetings captured</div></div>
        <div class="card"><div class="n">${fmtDuration(totalMs)}</div><div class="l">time in meetings</div></div>
        <div class="card"><div class="n">${totalActions}</div><div class="l">action items created</div></div>
        <div class="card"><div class="n">${totalDecisions}</div><div class="l">decisions logged</div></div>
      </div>

      <section>
        <h2>Talk time — you vs others (all meetings)</h2>
        <div class="legend">
          <span><span class="dot" style="background:#1a73e8"></span>you · ${Math.round(pctYou)}%</span>
          <span><span class="dot" style="background:#ea8600"></span>others · ${Math.round(100 - pctYou)}%</span>
        </div>
        ${barHtml(pctYou, "overall")}
      </section>

      <section>
        <h2>Activity — last 8 weeks</h2>
        <div class="legend">
          <span><span class="dot" style="background:#1a73e8"></span>meetings</span>
          <span><span class="dot" style="background:#188038"></span>action items</span>
        </div>
        ${chart}
      </section>

      <section>
        <h2>Recent meetings</h2>
        <table>
          <tr><th>Date</th><th>Length</th><th>You</th><th>Others</th><th>Balance</th><th>Actions</th></tr>
          ${rows}
        </table>
      </section>
    `;
  });
}

document.getElementById("ver").textContent = "v" + chrome.runtime.getManifest().version;
render();
