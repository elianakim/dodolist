import { P_META, PS } from './constants.js';
import { S, esc, today, sorted } from './state.js';
import { SS, gifDisplayName } from './settings.js';

// ─── TOP-LEVEL RENDER ─────────────────────────────────────────────

export function render() {
  try {
    renderHeader();
    renderTabs();
    renderToday();
    renderCategory();
    renderSidebar();
  } catch (e) {
    console.error('[render] error:', e);
  }
}

// ─── HEADER ───────────────────────────────────────────────────────

function renderHeader() {
  const p        = PS.includes(S.tab) ? S.tab : null;
  const sortWrap = document.getElementById('tab-sort-wrap');
  const sel      = document.getElementById('sort-select');
  if (p) {
    sortWrap.style.display = '';
    sel.value = S.sort[p] ?? 'manual';
  } else {
    sortWrap.style.display = 'none';
  }
}

// ─── TABS ─────────────────────────────────────────────────────────

function renderTabs() {
  const counts = {};
  for (const t of S.todos) {
    if (!t.done && t.priority) counts[t.priority] = (counts[t.priority] ?? 0) + 1;
  }
  PS.forEach(p => {
    document.querySelector(`.folder-tab[data-tab="${p}"]`).classList.toggle('active', S.tab === p);
    const tc = document.getElementById(`tc-${p}`);
    const n  = counts[p] ?? 0;
    tc.textContent   = n > 0 ? n : '';
    tc.style.display = n > 0 ? '' : 'none';
  });
}

// ─── TODAY PANEL ──────────────────────────────────────────────────

function renderToday() {
  const pane        = document.getElementById('today-pane');
  const pinned      = S.todos.filter(t => t.pinnedToToday);
  // Celebrating tasks count as done for progress (instant feedback) but stay in their original position
  const celebrating   = pinned.filter(t => !t.done && S.celebrating.has(t.id));
  const inProgressRaw = pinned.filter(t => !t.done);
  // Sort by todayOrder; append any untracked tasks at the end
  const _tids = S.todayOrder.filter(id => inProgressRaw.some(t => t.id === id));
  for (const t of inProgressRaw) { if (!_tids.includes(t.id)) _tids.push(t.id); }
  const inProgress = _tids.map(id => inProgressRaw.find(t => t.id === id)).filter(Boolean);
  const done        = pinned.filter(t =>  t.done);
  const total       = pinned.length;
  const doneCount   = done.length + celebrating.length;
  const pct         = total > 0 ? Math.round(doneCount / total * 100) : 0;
  const dl          = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  let h = `
    <div class="today-sticky">
      <div class="today-header">
        <div class="today-title">Today</div>
        <div class="today-date">${esc(dl)}</div>
      </div>
      <div class="progress-wrap">
        <div class="progress-row">
          <span class="progress-label">${doneCount} of ${total} done</span>
          <span class="progress-pct">${pct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" id="prog-fill"></div></div>
      </div>
    </div>
    <div class="today-scroll"><div class="task-grid">
  `;

  if (inProgress.length === 0 && done.length === 0) {
    h += `<div class="empty-state">📌 Pin tasks to see them here.<br>Hover a card and press <kbd>T</kbd>, or click 📌.</div>`;
  }
  for (const t of inProgress) h += card(t, false, true);   // celebrating tasks stay in their original position
  h += `</div>`;
  h += doneSection('today', done, false);
  h += `</div>`;
  pane.innerHTML = h;
  // Animate progress bar from 0 → target (CSS transition requires a state change on existing element)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const fill = document.getElementById('prog-fill');
    if (fill) fill.style.width = pct + '%';
  }));
}

// ─── CATEGORY PANEL ───────────────────────────────────────────────

function renderCategory() {
  const pane = document.getElementById('category-pane');
  pane.dataset.atab = S.tab;
  pane.innerHTML = buildCategory(S.tab);  // archive is now its own modal
}

function buildCategory(p) {
  const all    = S.todos.filter(t => t.priority === p);
  const active = sorted(all.filter(t => !t.done), p);
  const done   = all.filter(t => t.done);

  let h = `
    <div class="quick-add">
      <span class="quick-add-plus">+</span>
      <input class="quick-add-input" data-priority="${p}" id="qa-${p}"
        placeholder="Add a task… press Enter to save" autocomplete="off">
      <span class="quick-add-hint">↵ Enter</span>
    </div>
    <div class="task-grid">
  `;

  if (active.length === 0 && done.length === 0) {
    h += `<div class="empty-state" style="padding:28px 0">Nothing here yet.<br>Add your first task above.</div>`;
  }
  for (const t of active) h += card(t);
  h += `</div>`;
  h += doneSection(p, done);
  return h;
}

// ─── DONE SECTION ─────────────────────────────────────────────────

function doneSection(key, tasks, showFocus = true) {
  if (!tasks.length) return '';
  const open = S.doneOpen[key];
  let h = `
    <div class="done-section">
      <div class="done-toggle" data-done="${key}">
        <span class="done-arrow ${open ? 'open' : ''}">▶</span>
        <span>✓ Done</span>
        <span class="done-badge">${tasks.length}</span>
      </div>
      <div class="done-list ${open ? 'open' : ''}">
  `;
  for (const t of tasks) h += card(t, showFocus);
  h += `</div></div>`;
  return h;
}

// ─── TASK CARD ────────────────────────────────────────────────────

function card(task, showFocus = true, showPBadge = false) {
  const exp     = S.expanded.has(task.id);
  const td      = today();
  const overdue = task.dueDate && task.dueDate < td && !task.done;
  const delArm  = !!S.delArmed[task.id];

  const dueChip = task.dueDate
    ? `<span class="chip chip-due${overdue ? ' overdue' : ''}">${esc(task.dueDate)}</span>` : '';
  const recChip = task.recurring
    ? `<span class="chip chip-recur">↻ ${esc(task.recurring)}</span>` : '';

  const focused     = showFocus && task.id === S.focusedTaskId;
  const celebrating = S.celebrating.has(task.id);
  const celebData   = S.celebrating.get(task.id);
  const gifSrc      = celebData?.gif;
  const celebMsg    = celebData?.message ?? 'Yay!';

  const subs   = task.subtasks ?? [];
  const locked = !task.done && subs.length > 0 && !subs.every(st => st.done);

  const cbOrGif = celebrating
    ? `<div class="celebration-inline">
        ${gifSrc
          ? `<img class="chibi-gif" src="${gifSrc}" alt="">`
          : `<div class="chibi-emoji">🎉</div>`}
        <div class="speech-bubble">${esc(celebMsg)}</div>
      </div>`
    : `<div class="task-cb${task.done ? ' checked' : ''}${locked ? ' locked' : ''}" data-a="toggle" data-id="${esc(task.id)}">${task.done ? '✓' : ''}</div>`;

  let h = `
    <div class="task-card${task.done ? ' is-done' : ''}${focused ? ' is-focused' : ''}${celebrating ? ' celebrating' : ''}${task.pinnedToToday && !task.done ? ' is-pinned' : ''}"
         data-id="${esc(task.id)}" data-p="${esc(task.priority)}" draggable="true">
      <div class="task-row">
        <span class="drag-handle">⠿</span>
        ${cbOrGif}
        <div class="task-body">
          <div class="task-text" data-a="edit" data-id="${esc(task.id)}">${showPBadge ? `<span class="task-p-badge" style="background:${(P_META[task.priority] ?? P_META.p3).color}">${task.priority.toUpperCase()}</span>` : ''}${esc(task.text)}</div>
          ${dueChip || recChip ? `<div class="task-chips">${dueChip}${recChip}</div>` : ''}
        </div>
        <div class="task-actions">
          <button class="task-btn${task.pinnedToToday ? ' pinned' : ''}" data-a="pin" data-id="${esc(task.id)}" title="Pin to Today (t)">📌</button>
          <button class="task-btn expand-btn${exp ? ' open' : ''}" data-a="expand" data-id="${esc(task.id)}">▶</button>
          <button class="task-btn${delArm ? ' del-arm' : ''}" data-a="delete" data-id="${esc(task.id)}" title="Delete">🗑</button>
        </div>
      </div>
      ${subs.length ? `<div class="task-inline-subs">
        ${subs.map(st => `<div class="subtask-item subtask-inline">
          <div class="subtask-cb${st.done ? ' checked' : ''}" data-a="st-toggle" data-tid="${esc(task.id)}" data-sid="${esc(st.id)}">${st.done ? '✓' : ''}</div>
          <span class="subtask-text${st.done ? ' done' : ''}">${esc(st.text)}</span>
        </div>`).join('')}
      </div>` : ''}
      <div class="task-exp${exp ? ' open' : ''}">
        <div class="exp-row"><span class="exp-lbl">Notes</span>
          <textarea class="notes-ta" data-a="notes" data-id="${esc(task.id)}"
            placeholder="Add notes…">${esc(task.notes ?? '')}</textarea>
        </div>
        <div class="exp-row"><span class="exp-lbl">Due</span>
          <input type="date" class="exp-inp" data-a="due" data-id="${esc(task.id)}" value="${esc(task.dueDate ?? '')}">
        </div>
        <div class="exp-row"><span class="exp-lbl">Repeat</span>
          <select class="exp-sel" data-a="recur" data-id="${esc(task.id)}">
            <option value=""       ${!task.recurring             ? 'selected' : ''}>None</option>
            <option value="daily"  ${task.recurring === 'daily'  ? 'selected' : ''}>Daily</option>
            <option value="weekly" ${task.recurring === 'weekly' ? 'selected' : ''}>Weekly</option>
          </select>
        </div>
        <div class="exp-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="exp-lbl">Subtasks</span>
  `;

  for (const st of subs) {
    h += `
      <div class="subtask-item">
        <span class="subtask-text${st.done ? ' done' : ''}">${esc(st.text)}</span>
        <button class="subtask-del" data-a="st-del" data-tid="${esc(task.id)}" data-sid="${esc(st.id)}">✕</button>
      </div>`;
  }

  h += `
          <div class="st-add-row">
            <input class="st-add-inp" data-a="st-add" data-tid="${esc(task.id)}" placeholder="+ add subtask…">
          </div>
        </div>
      </div>
    </div>`;
  return h;
}

// ─── ARCHIVE CALENDAR HEATMAP ─────────────────────────────────────

function buildHeatmap(archive, selectedDay, numWeeks = 18) {
  // Count completions per date
  const counts = {};
  for (const t of archive) {
    const ms = t.doneAt || t.archivedAt;
    if (!ms) continue;
    const d = new Date(ms).toISOString().slice(0, 10);
    counts[d] = (counts[d] || 0) + 1;
  }

  const WEEKS = numWeeks;
  const CAP   = 10;

  // Start grid on the Monday that is WEEKS-1 full weeks before this week's Monday
  const todayD = new Date();
  todayD.setHours(0, 0, 0, 0);
  const dowMon = (todayD.getDay() + 6) % 7;   // 0 = Mon
  const start  = new Date(todayD);
  start.setDate(todayD.getDate() - dowMon - (WEEKS - 1) * 7);

  // weeks[w][d]: d=0 Mon … d=6 Sun
  const weeks = [];
  const cur   = new Date(start);
  for (let w = 0; w < WEEKS; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = cur.toISOString().slice(0, 10);
      week.push(cur <= todayD ? { date: dateStr, count: counts[dateStr] || 0 } : null);
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  // Month label: show on the first week that contains the 1st of a month
  const monthFor = weeks.map((week, wi) => {
    for (const cell of week) {
      if (cell && cell.date.slice(8) === '01')
        return new Date(cell.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
    }
    // Always label the very first column
    if (wi === 0 && weeks[0][0])
      return new Date(weeks[0][0].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
    return '';
  });

  const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

  let h = `<div class="cal-wrap">`;

  // Month labels row
  h += `<div class="cal-months-row"><div class="cal-dlbl-pad"></div>`;
  for (let w = 0; w < WEEKS; w++)
    h += `<div class="cal-mlbl">${monthFor[w]}</div>`;
  h += `</div>`;

  // Day rows
  for (let d = 0; d < 7; d++) {
    h += `<div class="cal-row"><div class="cal-dlbl">${DAY_LABELS[d]}</div>`;
    for (let w = 0; w < WEEKS; w++) {
      const cell = weeks[w][d];
      if (!cell) {
        h += `<div class="cal-cell empty"></div>`;
      } else {
        const p   = (Math.min(cell.count, CAP) / CAP).toFixed(2);
        const sel = cell.date === selectedDay;
        h += `<div class="cal-cell${cell.count > 0 ? ' has-data' : ''}${sel ? ' sel' : ''}"
          data-cal="${cell.date}" data-cnt="${cell.count}"
          title="${cell.date} · ${cell.count} task${cell.count !== 1 ? 's' : ''} done"
          style="--p:${p}"></div>`;
      }
    }
    h += `</div>`;
  }

  // Legend
  h += `<div class="cal-legend">
    <span>Less</span>
    ${[0, 0.25, 0.5, 0.75, 1].map(p => `<div class="cal-legend-cell" style="--p:${p}"></div>`).join('')}
    <span>More</span>
  </div>`;

  h += `</div>`;
  return h;
}

// ─── ARCHIVE ──────────────────────────────────────────────────────

export function buildArchiveHTML() {
  let h = `
    <div style="margin-bottom:14px">
      <div style="font-family:'Fraunces',serif;font-size:19px;font-weight:700;color:var(--muted);letter-spacing:-0.3px;margin-bottom:2px">Archive</div>
      <div style="font-size:11px;color:var(--light)">${S.archive.length} archived task${S.archive.length !== 1 ? 's' : ''}</div>
    </div>
  `;

  for (const p of PS) {
    const tasks = S.archive.filter(t => t.priority === p).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    const open  = S.arcOpen[p];
    const armed = !!S.clearArmed[p];

    h += `
      <div class="archive-group">
        <div class="arc-header" data-arc-toggle="${p}">
          <span class="arc-arrow${open ? ' open' : ''}">▶</span>
          <span class="arc-title" style="color:${P_META[p].color}">${esc(P_META[p].label)}</span>
          <span class="done-badge" style="margin-left:4px">${tasks.length}</span>
          ${tasks.length > 0
            ? `<button class="arc-clear${armed ? ' armed' : ''}" data-a="clear-arc" data-p="${p}">${armed ? 'Confirm?' : 'Clear all'}</button>`
            : ''}
        </div>
        <div class="arc-body${open ? ' open' : ''}">
    `;

    if (!tasks.length) {
      h += `<div style="font-size:11px;color:var(--light);padding:4px 0 8px">No archived tasks.</div>`;
    }
    for (const t of tasks) {
      const dt = t.doneAt
        ? new Date(t.doneAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      h += `
        <div class="arc-card">
          <div class="arc-text">${esc(t.text)}</div>
          <div class="arc-meta">
            <span>Completed ${esc(dt)}</span>
            ${t.dueDate ? `<span>Due ${esc(t.dueDate)}</span>` : ''}
            ${t.notes   ? `<span>📝 Notes</span>` : ''}
            ${t.subtasks?.length ? `<span>☑ ${t.subtasks.length} subtask${t.subtasks.length !== 1 ? 's' : ''}</span>` : ''}
          </div>
          <button class="btn-restore" data-a="restore" data-id="${esc(t.id)}">↩ Restore</button>
        </div>`;
    }
    h += `</div></div>`;
  }
  return h;
}

// ─── SIDEBAR ──────────────────────────────────────────────────────

export function renderSidebar() {
  const el = document.getElementById('sidebar-inner');
  if (!el) return;

  let h = '';

  // ── 1. Compact calendar heatmap ──────────────────────────────────
  // Include done-but-not-yet-archived tasks so today's work shows up immediately
  const allDone = [...S.archive, ...S.todos.filter(t => t.done && t.doneAt)];

  h += `<div class="sb-section">
    <div class="sb-section-title">Activity</div>
    <div class="sb-cal">${buildHeatmap(allDone, S.sidebarSelectedDay, 16)}</div>`;

  if (S.sidebarSelectedDay) {
    const dayTasks = allDone.filter(t => {
      const ms = t.doneAt || t.archivedAt;
      return ms && new Date(ms).toISOString().slice(0, 10) === S.sidebarSelectedDay;
    });
    const label = new Date(S.sidebarSelectedDay + 'T12:00:00')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    h += `<div class="sb-day-panel">
      <div class="sb-day-title">${esc(label)} <span class="done-badge">${dayTasks.length}</span></div>`;
    for (const t of dayTasks) {
      h += `<div class="sb-day-task">
        <span class="sb-p-dot" style="background:${(P_META[t.priority] ?? P_META.p3).color}"></span>
        <span class="sb-day-text">${esc(t.text)}</span>
      </div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;

  // ── 2. GIF character stats ────────────────────────────────────────
  const todayStr   = today();
  const isDailyView = S.cheerView === 'daily';
  const cheerSource = isDailyView
    ? allDone.filter(t => {
        const ms = t.doneAt ?? t.archivedAt;
        return ms && new Date(ms).toISOString().slice(0, 10) === todayStr;
      })
    : allDone;

  const gifCounts = {};
  for (const t of cheerSource) {
    if (t.celebrationGif) gifCounts[t.celebrationGif] = (gifCounts[t.celebrationGif] || 0) + 1;
  }
  const gifEntries = Object.entries(gifCounts).sort((a, b) => b[1] - a[1]);

  // Always show cheer squad section so the toggle is accessible
  const maxCount = gifEntries.length ? gifEntries[0][1] : 1;
  h += `<div class="sb-section">
    <div class="sb-section-title">Cheer squad
      <span class="cheer-view-toggle">
        <button class="cheer-tab${isDailyView ? ' active' : ''}" data-cheer-view="daily">Today</button>
        <button class="cheer-tab${!isDailyView ? ' active' : ''}" data-cheer-view="cumulative">All time</button>
      </span>
    </div>
    <div class="sb-gif-stats">`;
  if (gifEntries.length === 0) {
    h += `<div class="sb-cheer-empty">${isDailyView ? 'No cheers yet today.' : 'No cheers yet.'}</div>`;
  }
  for (const [src, count] of gifEntries) {
    const name = gifDisplayName(src);
    const pct  = Math.round(count / maxCount * 100);
    h += `<div class="sb-gif-card" data-gif-src="${esc(src)}">
      <div class="sb-gif-thumb">
        <canvas class="sb-gif-canvas" data-gif-src="${esc(src)}"></canvas>
        <img class="sb-gif-anim" src="${esc(src)}" alt="${esc(name)}" style="display:none">
      </div>
      <div class="sb-gif-info">
        <div class="sb-gif-name">${esc(name)}</div>
        <div class="sb-gif-count">${count} cheer${count !== 1 ? 's' : ''}</div>
        <div class="sb-gif-bar-wrap"><div class="sb-gif-bar" style="width:${pct}%"></div></div>
      </div>
    </div>`;
  }
  h += `</div></div>`;

  // ── 3. Recent activity ────────────────────────────────────────────
  const recent = [...S.archive, ...S.todos.filter(t => t.done && t.doneAt)]
    .sort((a, b) => (b.doneAt ?? b.archivedAt ?? 0) - (a.doneAt ?? a.archivedAt ?? 0))
    .slice(0, 8);

  if (recent.length > 0) {
    h += `<div class="sb-section">
      <div class="sb-section-title">Recent</div>
      <div class="sb-activity">`;
    for (const t of recent) {
      const ms = t.doneAt ?? t.archivedAt;
      h += `<div class="sb-act-item">
        <span class="sb-p-dot" style="background:${(P_META[t.priority] ?? P_META.p3).color}"></span>
        <span class="sb-act-text">${esc(t.text)}</span>
        <span class="sb-act-time">${relTime(ms)}</span>
      </div>`;
    }
    h += `</div></div>`;
  }

  el.innerHTML = h;
  requestAnimationFrame(() => drawGifCanvases());
}

function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (d > 30) return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (d >= 1)  return `${d}d ago`;
  if (h >= 1)  return `${h}h ago`;
  if (m >= 1)  return `${m}m ago`;
  return 'just now';
}

export function drawGifCanvases() {
  document.querySelectorAll('.sb-gif-canvas[data-gif-src]').forEach(canvas => {
    const src = canvas.dataset.gifSrc;
    if (canvas.dataset.drawn === src) return;
    canvas.dataset.drawn = src;
    const img = new Image();
    img.onload = () => {
      canvas.width  = img.naturalWidth  || 36;
      canvas.height = img.naturalHeight || 36;
      canvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = src;
  });

  // Wire hover: canvas ↔ animated img
  document.querySelectorAll('.sb-gif-card').forEach(card => {
    if (card.dataset.hoverWired) return;
    card.dataset.hoverWired = '1';
    const canvas = card.querySelector('.sb-gif-canvas');
    const anim   = card.querySelector('.sb-gif-anim');
    card.addEventListener('mouseenter', () => {
      canvas && (canvas.style.display = 'none');
      anim   && (anim.style.display   = '');
    });
    card.addEventListener('mouseleave', () => {
      canvas && (canvas.style.display = '');
      anim   && (anim.style.display   = 'none');
    });
  });
}
