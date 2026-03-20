import { PS } from './constants.js';

// ─── HELPERS ──────────────────────────────────────────────────────

export const uid   = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);
export const esc   = s  => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ─── STATE ────────────────────────────────────────────────────────
// S.expanded, S.delArmed, S.clearArmed are session-only (not saved to disk)

export const S = {
  todos:       [],
  archive:     [],
  lastCleanup: null,
  tab:         'p0',
  sort:        { p0: 'manual', p1: 'manual', p2: 'manual', p3: 'manual' },
  doneOpen:    { today: false, p0: false, p1: false, p2: false, p3: false },
  arcOpen:     { p0: true, p1: true, p2: true, p3: true },
  expanded:       new Set(),
  delArmed:       {},
  clearArmed:     {},
  todayOrder:        [],           // persisted: ordered task IDs for today panel
  focusedTaskId:     null,        // session-only
  celebrating:       new Map(),   // session-only: taskId → { gif, message }
  sidebarSelectedDay: null,       // session-only: clicked calendar day
  cheerView:         'daily',     // session-only: 'daily' | 'cumulative'
};

export const byId    = id => S.todos.find(t => t.id === id) ?? null;
export const arcById = id => S.archive.find(t => t.id === id) ?? null;

// ─── PERSISTENCE ──────────────────────────────────────────────────

function serialise() {
  return JSON.stringify({
    todos:       S.todos,
    archive:     S.archive,
    lastCleanup: S.lastCleanup,
    sort:        S.sort,
    doneOpen:    S.doneOpen,
    arcOpen:     S.arcOpen,
    tab:         S.tab,
    todayOrder:  S.todayOrder,
  });
}

export function save() {
  // Fire-and-forget — keepalive ensures it completes even if tab closes
  fetch('/api/data', {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      serialise(),
    keepalive: true,
  }).catch(() => {});
}

export const debouncedSave = debounce(save, 400);

export async function load() {
  try {
    const res  = await fetch('/api/data');
    if (!res.ok) return;
    const data = await res.json();
    S.todos       = data.todos       ?? [];
    S.archive     = data.archive     ?? [];
    S.lastCleanup = data.lastCleanup ?? null;
    S.tab         = data.tab         ?? 'p0';
    Object.assign(S.sort,     data.sort     ?? {});
    Object.assign(S.doneOpen, data.doneOpen ?? {});
    Object.assign(S.arcOpen,  data.arcOpen  ?? {});
    S.todayOrder = data.todayOrder ?? [];
  } catch (e) {
    console.warn('Load error:', e);
  }
}

// ─── MIDNIGHT CLEANUP ─────────────────────────────────────────────

export function cleanup() {
  const t = today();
  if (S.lastCleanup === t) return;

  const kept = [];
  for (const task of S.todos) {
    if (task.done) {
      if (task.recurring) {
        kept.push({ ...task, done: false, doneAt: null, pinnedToToday: false, createdAt: Date.now() });
      } else {
        S.archive.unshift({ ...task, archivedAt: task.doneAt ?? Date.now() });
      }
    } else {
      kept.push(task);
    }
  }
  S.todos = kept;
  S.lastCleanup = t;
  save();
}

// ─── SORTING ──────────────────────────────────────────────────────

export function sorted(tasks, p) {
  const pref = S.sort[p] ?? 'manual';
  const arr  = [...tasks];
  if (pref === 'manual') {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  } else if (pref === 'due') {
    arr.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  } else if (pref === 'created') {
    arr.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }
  return arr;
}
