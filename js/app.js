import { PS, P_META } from './constants.js';
import { S, uid, esc, save, debouncedSave, load, cleanup, sorted, byId, arcById } from './state.js';
import { render, buildArchiveHTML, renderSidebar } from './render.js';
import { SS, loadSettings, saveSettings, randomGif, randomMessage, gifDisplayName, DEFAULT_COLORS, COLOR_LABELS, applyColors } from './settings.js';

// ─── SESSION STATE ────────────────────────────────────────────────

let dragId            = null;
let hoverId           = null;
let searchFocusIdx    = -1;          // which search result is keyboard-highlighted
let searchResultItems = [];          // [{p, id}] in display order
const celebrationTimers = new Map();   // taskId → timer handle

// ─── PANEL WIRING ────────────────────────────────────────────────

function wire(el) {
  el.addEventListener('click',    handleClick);
  el.addEventListener('change',   handleChange);
  el.addEventListener('input',    handleInput);
  el.addEventListener('keydown',  handleKey);
  el.addEventListener('focusout', handleFocusout);

  el.addEventListener('mouseover', e => {
    const c = e.target.closest('.task-card');
    hoverId = c ? c.dataset.id : null;
  });
  el.addEventListener('mouseout', e => {
    const c = e.target.closest('.task-card');
    if (c && !c.contains(e.relatedTarget) && hoverId === c.dataset.id) hoverId = null;
  });

  // Drag: reorder within category
  el.addEventListener('dragstart', e => {
    if (['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target.tagName)) { e.preventDefault(); return; }
    const c = e.target.closest('.task-card');
    if (!c) return;
    dragId = c.dataset.id;
    c.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });

  el.addEventListener('dragend', () => {
    document.querySelectorAll('.task-card').forEach(c => c.classList.remove('is-dragging', 'drop-above', 'drop-below'));
    dragId = null;
  });

  el.addEventListener('dragover', e => {
    const c = e.target.closest('.task-card');
    if (!c || !dragId || c.dataset.id === dragId) return;
    e.preventDefault();
    document.querySelectorAll('.task-card').forEach(x => x.classList.remove('drop-above', 'drop-below'));
    const r = c.getBoundingClientRect();
    c.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
  });

  el.addEventListener('drop', e => {
    const c = e.target.closest('.task-card');
    if (!c || !dragId || c.dataset.id === dragId) return;
    e.preventDefault();
    const src = byId(dragId), tgt = byId(c.dataset.id);
    if (!src || !tgt) return;

    // Today-panel reorder — tasks from different priorities may both be pinned
    if (e.currentTarget.id === 'today-pane') {
      const inProgress = S.todos.filter(t => t.pinnedToToday && !t.done);
      const allIds     = inProgress.map(t => t.id);
      const ordered    = S.todayOrder.filter(id => allIds.includes(id));
      for (const id of allIds) { if (!ordered.includes(id)) ordered.push(id); }
      let si = ordered.indexOf(dragId);
      let ti = ordered.indexOf(tgt.id);
      if (si < 0 || ti < 0) return;
      const r  = c.getBoundingClientRect();
      let ii   = e.clientY < r.top + r.height / 2 ? ti : ti + 1;
      ordered.splice(si, 1);
      if (ii > si) ii--;
      ordered.splice(ii, 0, dragId);
      S.todayOrder = ordered;
      save(); render();
      return;
    }

    if (src.priority !== tgt.priority) return;
    const p     = src.priority;
    const tasks = sorted(S.todos.filter(t => t.priority === p && !t.done), p);
    let si = tasks.findIndex(t => t.id === dragId);
    let ti = tasks.findIndex(t => t.id === tgt.id);
    const r = c.getBoundingClientRect();
    let ii = e.clientY < r.top + r.height / 2 ? ti : ti + 1;
    tasks.splice(si, 1);
    if (ii > si) ii--;
    tasks.splice(ii, 0, src);
    tasks.forEach((t, i) => { t.order = i; });
    save(); render();
  });
}

// ─── CLICK HANDLER ────────────────────────────────────────────────

function handleClick(e) {
  // Done-section toggle
  const dt = e.target.closest('[data-done]');
  if (dt) { const k = dt.dataset.done; S.doneOpen[k] = !S.doneOpen[k]; save(); render(); return; }

  const el = e.target.closest('[data-a]');
  if (!el) return;
  const { a, id } = el.dataset;

  if (a === 'toggle') {
    const t = byId(id);
    if (t) {
      if (!t.done) {
        const locked = (t.subtasks?.length > 0) && !t.subtasks.every(st => st.done);
        if (locked) return;
        triggerCelebration(t);
      } else {
        t.done = false; t.doneAt = null; save(); render();
      }
    }
  }

  if (a === 'pin') {
    const t = byId(id);
    if (t) { t.pinnedToToday = !t.pinnedToToday; save(); render(); }
  }

  if (a === 'expand') {
    S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id);
    render();
  }

  if (a === 'delete') {
    if (S.delArmed[id]) {
      S.todos = S.todos.filter(t => t.id !== id);
      S.expanded.delete(id);
      if (S.focusedTaskId === id) S.focusedTaskId = null;
      delete S.delArmed[id];
      save(); render();
    } else {
      S.delArmed[id] = true; render();
      setTimeout(() => { if (S.delArmed[id]) { delete S.delArmed[id]; render(); } }, 3000);
    }
  }

  if (a === 'edit') {
    const t = byId(id); if (!t) return;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'task-text-input';
    inp.value = t.text; inp.dataset.id = id; inp.dataset.isEdit = '1';
    el.replaceWith(inp); inp.focus(); inp.select();
  }

  if (a === 'st-toggle') {
    const t = byId(el.dataset.tid);
    if (t) { const s = (t.subtasks ?? []).find(s => s.id === el.dataset.sid); if (s) { s.done = !s.done; save(); render(); } }
  }

  if (a === 'st-del') {
    const t = byId(el.dataset.tid);
    if (t) { t.subtasks = (t.subtasks ?? []).filter(s => s.id !== el.dataset.sid); save(); render(); }
  }
}

// ─── OTHER HANDLERS ───────────────────────────────────────────────

function handleChange(e) {
  const { a, id } = e.target.dataset;
  if (a === 'notes') { const t = byId(id); if (t) { t.notes = e.target.value; save(); } }
  if (a === 'due')   { const t = byId(id); if (t) { t.dueDate = e.target.value || null; save(); render(); } }
  if (a === 'recur') { const t = byId(id); if (t) { t.recurring = e.target.value || null; save(); render(); } }
  if (e.target.id === 'sort-select' && PS.includes(S.tab)) { S.sort[S.tab] = e.target.value; save(); render(); }
}

function handleInput(e) {
  const { a, id } = e.target.dataset;
  if (a === 'notes') { const t = byId(id); if (t) { t.notes = e.target.value; debouncedSave(); } }
}

function handleKey(e) {
  const el = e.target;

  if (el.classList.contains('quick-add-input')) {
    if (e.key === 'Enter') {
      const text = el.value.trim();
      if (text) {
        const p = el.dataset.priority;
        addTask(p, text);
        // Refocus the fresh input after render replaces the DOM
        requestAnimationFrame(() => document.getElementById(`qa-${p}`)?.focus());
      }
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();   // prevent global Escape from also firing
      el.blur();
      return;
    }
  }

  if (el.dataset.a === 'st-add' && e.key === 'Enter') {
    const text = el.value.trim();
    const tid  = el.dataset.tid;
    if (text) {
      const t = byId(tid);
      if (t) {
        if (!t.subtasks) t.subtasks = [];
        t.subtasks.push({ id: uid(), text, done: false });
        save(); render();
        // Refocus the add-input for this task so user can keep typing
        requestAnimationFrame(() => {
          const inp = document.querySelector(`.st-add-inp[data-tid="${tid}"]`);
          if (inp) inp.focus();
        });
      }
    }
    return;
  }

  if (el.dataset.isEdit) {
    if (e.key === 'Enter')  commitEdit(el);
    if (e.key === 'Escape') render();
  }
}

function handleFocusout(e) {
  if (e.target.dataset.isEdit) commitEdit(e.target);
}

function commitEdit(inp) {
  const t = byId(inp.dataset.id);
  if (t) { const text = inp.value.trim(); if (text) t.text = text; save(); }
  render();
}

// ─── CELEBRATION ──────────────────────────────────────────────────

function triggerCelebration(task) {
  // Allow re-triggering if already celebrating (shouldn't happen, but be safe)
  if (celebrationTimers.has(task.id)) clearTimeout(celebrationTimers.get(task.id));

  const gif = randomGif();
  S.celebrating.set(task.id, { gif, message: randomMessage() });
  task.celebrationGif = gif;   // stored so it carries into archive
  render();

  const timer = setTimeout(() => {
    const t = byId(task.id);
    if (t) { t.done = true; t.doneAt = Date.now(); }
    S.celebrating.delete(task.id);
    celebrationTimers.delete(task.id);

    // Slide the card out before re-rendering
    const cardEl = document.querySelector(`.task-card[data-id="${task.id}"]`);
    if (cardEl) {
      cardEl.classList.add('is-exiting');
      setTimeout(() => { save(); render(); }, 240);
    } else {
      save(); render();
    }
  }, 2000);

  celebrationTimers.set(task.id, timer);
}

// ─── TASK ACTIONS ─────────────────────────────────────────────────

function addTask(priority, text) {
  const maxOrd = S.todos.filter(t => t.priority === priority)
    .reduce((m, t) => Math.max(m, t.order ?? 0), -1);
  S.todos.push({
    id: uid(), text, priority,
    done: false, doneAt: null,
    createdAt: Date.now(), dueDate: null,
    pinnedToToday: false, notes: '', subtasks: [],
    recurring: null, order: maxOrd + 1,
  });
  save(); render();
}

// ─── TAB BAR ──────────────────────────────────────────────────────

document.getElementById('tab-bar').addEventListener('click', e => {
  const tab = e.target.closest('.folder-tab[data-tab]');   // FIX: was .tab-pill
  if (tab) { S.tab = tab.dataset.tab; S.focusedTaskId = null; save(); render(); }
});

// ─── ARCHIVE MODAL ────────────────────────────────────────────────

function openArchive() {
  refreshArchiveModal();
  document.getElementById('archive-overlay').classList.add('open');
  document.getElementById('archive-btn').classList.add('active');
}
function closeArchive() {
  document.getElementById('archive-overlay').classList.remove('open');
  document.getElementById('archive-btn').classList.remove('active');
}
function refreshArchiveModal() {
  document.getElementById('archive-modal-body').innerHTML = buildArchiveHTML();
}

// Archive modal click delegation (restore, clear, group toggle)
document.getElementById('archive-modal-body').addEventListener('click', e => {
  // Group toggle
  const at = e.target.closest('[data-arc-toggle]');
  if (at && !e.target.closest('[data-a="clear-arc"]')) {
    S.arcOpen[at.dataset.arcToggle] = !S.arcOpen[at.dataset.arcToggle];
    refreshArchiveModal(); return;
  }

  const el = e.target.closest('[data-a]');
  if (!el) return;
  const { a, id } = el.dataset;

  if (a === 'restore') {
    const t = arcById(id);
    if (t) { S.archive = S.archive.filter(x => x.id !== id); S.todos.push({ ...t, done: false, doneAt: null }); save(); render(); refreshArchiveModal(); }
  }

  if (a === 'clear-arc') {
    const p = el.dataset.p;
    if (S.clearArmed[p]) {
      S.archive = S.archive.filter(t => t.priority !== p);
      delete S.clearArmed[p]; save(); render(); refreshArchiveModal();
    } else {
      S.clearArmed[p] = true; refreshArchiveModal();
      setTimeout(() => { if (S.clearArmed[p]) { delete S.clearArmed[p]; refreshArchiveModal(); } }, 3000);
    }
  }
});

// ─── SIDEBAR CLICK DELEGATION ─────────────────────────────────────

document.getElementById('sidebar-inner').addEventListener('click', e => {
  const calCell = e.target.closest('[data-cal]');
  if (calCell && +calCell.dataset.cnt > 0) {
    S.sidebarSelectedDay = S.sidebarSelectedDay === calCell.dataset.cal ? null : calCell.dataset.cal;
    renderSidebar(); return;
  }
  const cheerBtn = e.target.closest('[data-cheer-view]');
  if (cheerBtn) {
    S.cheerView = cheerBtn.dataset.cheerView;
    renderSidebar(); return;
  }
});

document.getElementById('archive-btn').addEventListener('click', () => {
  document.getElementById('archive-overlay').classList.contains('open') ? closeArchive() : openArchive();
});
document.getElementById('archive-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeArchive(); });
document.getElementById('archive-close-btn').addEventListener('click', closeArchive);

// ─── SEARCH ───────────────────────────────────────────────────────

const openSearch = () => {
  searchFocusIdx    = -1;
  searchResultItems = [];
  document.getElementById('search-overlay').classList.add('open');
  const inp = document.getElementById('search-input');
  inp.value = '';
  document.getElementById('search-results').innerHTML = '';
  inp.focus();
};
const closeSearch = () => document.getElementById('search-overlay').classList.remove('open');

function doSearch(q) {
  q = q.toLowerCase().trim();
  searchFocusIdx    = -1;
  searchResultItems = [];
  const out = document.getElementById('search-results');
  if (!q) { out.innerHTML = ''; return; }

  const groups = {};
  for (const p of PS) {
    const hits = S.todos.filter(t => t.priority === p && matchesSearch(t, q));
    if (hits.length) groups[p] = hits;
  }

  const total = Object.values(groups).reduce((s, g) => s + g.length, 0);
  if (!total) { out.innerHTML = `<div class="search-empty">No results for "${esc(q)}"</div>`; return; }

  let h = '';
  for (const p of PS) {
    if (!groups[p]) continue;
    h += `<div class="search-group-lbl">${esc(P_META[p].label)}</div>`;
    for (const t of groups[p]) {
      const idx = searchResultItems.length;
      searchResultItems.push({ p, id: t.id });
      h += `<div class="search-item" data-idx="${idx}" data-np="${p}" data-sid="${t.id}">${highlight(t.text, q)}</div>`;
    }
  }
  out.innerHTML = h;
}

function updateSearchFocus() {
  document.querySelectorAll('.search-item[data-idx]').forEach(el => {
    el.classList.toggle('search-focused', +el.dataset.idx === searchFocusIdx);
  });
  const el = document.querySelector(`.search-item[data-idx="${searchFocusIdx}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

function moveSearchFocus(delta) {
  if (!searchResultItems.length) return;
  const n = searchResultItems.length;
  if (searchFocusIdx < 0) {
    searchFocusIdx = delta > 0 ? 0 : n - 1;
  } else {
    searchFocusIdx = Math.max(0, Math.min(n - 1, searchFocusIdx + delta));
  }
  updateSearchFocus();
}

function selectSearchResult(idx) {
  const item = searchResultItems[idx];
  if (!item) return;
  S.tab = item.p;
  S.focusedTaskId = item.id;
  save(); closeSearch(); render();
  // Scroll to highlighted card after render
  requestAnimationFrame(() => {
    document.querySelector(`.task-card[data-id="${item.id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function matchesSearch(t, q) {
  return t.text.toLowerCase().includes(q) ||
    (t.notes && t.notes.toLowerCase().includes(q)) ||
    (t.subtasks ?? []).some(s => s.text.toLowerCase().includes(q));
}

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + `<mark>${esc(text.slice(i, i + q.length))}</mark>` + esc(text.slice(i + q.length));
}

document.getElementById('search-btn').addEventListener('click', openSearch);
document.getElementById('search-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeSearch(); });
document.getElementById('search-input').addEventListener('input', e => doSearch(e.target.value));
document.getElementById('search-results').addEventListener('click', e => {
  const item = e.target.closest('[data-idx]');
  if (item) selectSearchResult(+item.dataset.idx);
});

// ─── KEYBOARD NAVIGATION ──────────────────────────────────────────

// Returns the ordered list of navigable (active) tasks in the current view
function navTasks() {
  if (!PS.includes(S.tab)) return [];
  return sorted(S.todos.filter(t => t.priority === S.tab && !t.done), S.tab);
}

function moveFocus(dir) {
  const tasks = navTasks();
  if (!tasks.length) return;
  const idx    = tasks.findIndex(t => t.id === S.focusedTaskId);
  const newIdx = dir === 'down'
    ? Math.min(idx + 1, tasks.length - 1)
    : Math.max(idx - 1, 0);
  // If nothing was focused yet, start at top (down) or bottom (up)
  S.focusedTaskId = tasks[idx < 0 ? (dir === 'down' ? 0 : tasks.length - 1) : newIdx].id;
  render();
  document.querySelector(`.task-card[data-id="${S.focusedTaskId}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── GLOBAL KEYBOARD SHORTCUTS ────────────────────────────────────

document.addEventListener('keydown', e => {
  const active       = document.activeElement;
  const typing       = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
  const searchOpen   = document.getElementById('search-overlay').classList.contains('open');
  const archiveOpen  = document.getElementById('archive-overlay').classList.contains('open');
  const settingsOpen = document.getElementById('settings-overlay').classList.contains('open');

  // ── Always-on ──────────────────────────────────────────────────
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }

  if (e.key === 'Escape') {
    if (searchOpen)         { closeSearch();   return; }
    if (archiveOpen)        { closeArchive();  return; }
    if (settingsOpen)       { closeSettings(); return; }
    if (!typing && S.focusedTaskId) { S.focusedTaskId = null; render(); return; }
    return;
  }

  // ── Search overlay: arrow navigation + Enter to select ─────────
  if (searchOpen) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchFocus(+1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveSearchFocus(-1); return; }
    if (e.key === 'Enter' && searchFocusIdx >= 0) { e.preventDefault(); selectSearchResult(searchFocusIdx); return; }
    return; // let all other keys pass through to the text input
  }

  // ── Block shortcuts while typing elsewhere ──────────────────────
  if (typing) return;

  // "/" — focus quick-add input for current tab
  if (e.key === '/') {
    e.preventDefault();
    (document.getElementById(`qa-${S.tab}`) ?? document.querySelector('.quick-add-input'))?.focus();
    return;
  }

  // 1–4 — switch tabs
  const tabKeys = { '1': 'p0', '2': 'p1', '3': 'p2', '4': 'p3' };
  if (tabKeys[e.key]) { S.tab = tabKeys[e.key]; S.focusedTaskId = null; save(); render(); return; }

  // ↑↓ — navigate task list
  if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus('down'); return; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus('up');   return; }

  // ── Focused-task shortcuts ──────────────────────────────────────
  if (S.focusedTaskId) {
    const id = S.focusedTaskId;
    const t  = byId(id);

    if (e.key === 'Enter') {
      e.preventDefault();
      S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id);
      render(); return;
    }
    if (e.key === 't' || e.key === 'T') {
      if (t) { t.pinnedToToday = !t.pinnedToToday; save(); render(); }
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      if (S.delArmed[id]) {
        S.todos = S.todos.filter(x => x.id !== id);
        S.expanded.delete(id);
        S.focusedTaskId = null;
        delete S.delArmed[id];
        save(); render();
      } else {
        S.delArmed[id] = true; render();
        setTimeout(() => { if (S.delArmed[id]) { delete S.delArmed[id]; render(); } }, 3000);
      }
      return;
    }
    if (e.key === 'x' || e.key === 'X') {
      if (t) {
        if (!t.done) { triggerCelebration(t); }
        else { t.done = false; t.doneAt = null; save(); render(); }
      }
      return;
    }
  }

  // t / x / d — also work on hovered task when nothing is focused
  if (e.key === 't' || e.key === 'T') {
    const target = S.focusedTaskId ?? hoverId;
    if (target) { const t = byId(target); if (t) { t.pinnedToToday = !t.pinnedToToday; save(); render(); } }
    return;
  }

  if (e.key === 'x' || e.key === 'X') {
    if (hoverId) {
      const t = byId(hoverId);
      if (t) {
        if (!t.done) { triggerCelebration(t); }
        else { t.done = false; t.doneAt = null; save(); render(); }
      }
    }
    return;
  }

  if (e.key === 'd' || e.key === 'D') {
    if (hoverId) {
      const id = hoverId;
      if (S.delArmed[id]) {
        S.todos = S.todos.filter(x => x.id !== id);
        S.expanded.delete(id);
        if (S.focusedTaskId === id) S.focusedTaskId = null;
        delete S.delArmed[id];
        save(); render();
      } else {
        S.delArmed[id] = true; render();
        setTimeout(() => { if (S.delArmed[id]) { delete S.delArmed[id]; render(); } }, 3000);
      }
    }
    return;
  }
});

// ─── SETTINGS MODAL ───────────────────────────────────────────────

let settingsDraft      = null;
const gifDelArmed      = new Set();   // "g0", "g1" — gif indices pending confirm
const msgDelArmed      = new Set();   // "m0", "m1" — message indices pending confirm
const pendingGifDeletes = [];         // gif paths to delete from disk on Save

function cloneDraft() {
  return {
    gifs:                [...SS.gifs],
    celebrationMessages: [...SS.celebrationMessages],
    colors:              { ...SS.colors },
    gifNames:            { ...SS.gifNames },
  };
}

function isDirty() {
  if (!settingsDraft) return false;
  return JSON.stringify(settingsDraft) !== JSON.stringify({
    gifs:                SS.gifs,
    celebrationMessages: SS.celebrationMessages,
    colors:              SS.colors,
    gifNames:            SS.gifNames,
  });
}

function openSettings() {
  settingsDraft = cloneDraft();
  gifDelArmed.clear();
  msgDelArmed.clear();
  pendingGifDeletes.length = 0;
  renderMessageList();
  renderGifGrid();
  renderColorRows();
  document.getElementById('settings-overlay').classList.add('open');
  document.getElementById('settings-btn').classList.add('active');
}

function closeSettings(force = false) {
  if (!force && isDirty()) {
    if (!confirm('Close without saving? Your changes will be lost.')) return;
    applyColors(SS.colors);
  }
  settingsDraft = null;
  gifDelArmed.clear();
  msgDelArmed.clear();
  pendingGifDeletes.length = 0;
  document.getElementById('settings-overlay').classList.remove('open');
  document.getElementById('settings-btn').classList.remove('active');
}

async function saveAndClose() {
  // Delete files staged for removal from disk
  for (const p of pendingGifDeletes) {
    const filename = p.split('/').pop();
    await fetch(`/api/gifs?name=${encodeURIComponent(filename)}`, { method: 'DELETE' }).catch(() => {});
  }
  SS.gifs                = settingsDraft.gifs;
  SS.celebrationMessages = settingsDraft.celebrationMessages;
  SS.gifNames            = settingsDraft.gifNames;
  Object.assign(SS.colors, settingsDraft.colors);
  applyColors(SS.colors);
  saveSettings();
  settingsDraft = null;
  gifDelArmed.clear();
  msgDelArmed.clear();
  pendingGifDeletes.length = 0;
  document.getElementById('settings-overlay').classList.remove('open');
  document.getElementById('settings-btn').classList.remove('active');
}

function renderMessageList() {
  document.getElementById('message-list').innerHTML =
    settingsDraft.celebrationMessages.map((msg, i) => {
      const key = `m${i}`;
      return `<div class="msg-item">
        <span class="msg-text">${esc(msg)}</span>
        <button class="msg-del${msgDelArmed.has(key) ? ' armed' : ''}" data-md="${i}">${msgDelArmed.has(key) ? 'Delete?' : '✕'}</button>
      </div>`;
    }).join('');
}

function renderGifGrid() {
  const grid = document.getElementById('gif-grid');
  if (!settingsDraft.gifs.length) {
    grid.innerHTML = '<div class="gif-empty">No GIFs yet.</div>';
    return;
  }
  grid.innerHTML = settingsDraft.gifs.map((src, i) => {
    const key  = `g${i}`;
    const name = gifDisplayName(src, settingsDraft.gifNames);
    return `<div class="gif-item">
      <img src="${src}" alt="gif ${i}">
      <button class="gif-del${gifDelArmed.has(key) ? ' armed' : ''}" data-gi="${i}">${gifDelArmed.has(key) ? '?' : '✕'}</button>
      <div class="gif-name" contenteditable="true" spellcheck="false" data-gi="${i}" title="Click to rename">${esc(name)}</div>
    </div>`;
  }).join('');
}

function renderColorRows() {
  document.getElementById('color-rows').innerHTML =
    Object.entries(COLOR_LABELS).map(([key, label]) =>
      `<div class="color-row">
        <span class="color-lbl">${esc(label)}</span>
        <input type="color" class="color-swatch" data-ckey="${key}" value="${settingsDraft.colors[key] ?? DEFAULT_COLORS[key]}">
      </div>`
    ).join('');
}

// ── Settings open/close/save ──────────────────────────────────────
document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.contains('open') ? closeSettings() : openSettings();
});
document.getElementById('settings-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
document.getElementById('settings-close-btn').addEventListener('click', () => closeSettings());
document.getElementById('settings-cancel-btn').addEventListener('click', () => closeSettings());
document.getElementById('settings-save-btn').addEventListener('click', saveAndClose);

// ── Message list ──────────────────────────────────────────────────
document.getElementById('message-list').addEventListener('click', e => {
  const del = e.target.closest('.msg-del');
  if (!del) return;
  const i   = +del.dataset.md;
  const key = `m${i}`;
  if (msgDelArmed.has(key)) {
    msgDelArmed.clear();
    settingsDraft.celebrationMessages.splice(i, 1);
    if (!settingsDraft.celebrationMessages.length) settingsDraft.celebrationMessages.push('Yay!');
    renderMessageList();
  } else {
    msgDelArmed.clear(); msgDelArmed.add(key);
    renderMessageList();
    setTimeout(() => { if (msgDelArmed.has(key)) { msgDelArmed.delete(key); renderMessageList(); } }, 3000);
  }
});

document.getElementById('msg-add-btn').addEventListener('click', () => {
  const inp  = document.getElementById('msg-add-inp');
  const text = inp.value.trim();
  if (!text) return;
  settingsDraft.celebrationMessages.push(text);
  inp.value = '';
  renderMessageList();
});
document.getElementById('msg-add-inp').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('msg-add-btn').click();
});

// ── GIF upload — sends raw binary to server, stores path ──────────
const gifUploadArea = document.getElementById('gif-upload-area');
const gifFileInp    = document.getElementById('gif-file-inp');
gifUploadArea.addEventListener('click', e => {
  if (!e.target.classList.contains('gif-browse-lbl')) gifFileInp.click();
});
gifFileInp.addEventListener('click', e => e.stopPropagation());
gifFileInp.addEventListener('change', () => { handleGifFiles(gifFileInp.files); gifFileInp.value = ''; });
gifUploadArea.addEventListener('dragover', e => { e.preventDefault(); gifUploadArea.classList.add('drag-over'); });
gifUploadArea.addEventListener('dragleave', () => gifUploadArea.classList.remove('drag-over'));
gifUploadArea.addEventListener('drop', e => {
  e.preventDefault(); gifUploadArea.classList.remove('drag-over'); handleGifFiles(e.dataTransfer.files);
});

async function handleGifFiles(files) {
  let changed = false;
  for (const file of files) {
    try {
      if (file.type !== 'image/gif') throw new Error('Not a GIF');
      if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2MB');
      // Prefix timestamp to avoid collisions
      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const res = await fetch(`/api/gifs?name=${encodeURIComponent(safeName)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'image/gif' },
        body:    file,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      settingsDraft.gifs.push(data.path);
      changed = true;
    } catch (err) {
      console.warn('GIF rejected:', err.message);
    }
  }
  if (changed) renderGifGrid();
}

// GIF delete: stage for disk removal on Save (two-step confirm)
document.getElementById('gif-grid').addEventListener('click', e => {
  const btn = e.target.closest('.gif-del');
  if (!btn) return;
  const i   = +btn.dataset.gi;
  const key = `g${i}`;
  if (gifDelArmed.has(key)) {
    gifDelArmed.clear();
    pendingGifDeletes.push(settingsDraft.gifs[i]);
    settingsDraft.gifs.splice(i, 1);
    renderGifGrid();
  } else {
    gifDelArmed.clear(); gifDelArmed.add(key);
    renderGifGrid();
    setTimeout(() => { if (gifDelArmed.has(key)) { gifDelArmed.delete(key); renderGifGrid(); } }, 3000);
  }
});

// ── GIF name editing (contenteditable) ────────────────────────────
document.getElementById('gif-grid').addEventListener('input', e => {
  const el = e.target.closest('.gif-name');
  if (!el || !settingsDraft) return;
  const i   = +el.dataset.gi;
  const src = settingsDraft.gifs[i];
  if (src) settingsDraft.gifNames[src] = el.textContent.trim();
});

// ── Color pickers (live preview of draft) ─────────────────────────
document.getElementById('color-rows').addEventListener('input', e => {
  const inp = e.target.closest('.color-swatch');
  if (inp) { settingsDraft.colors[inp.dataset.ckey] = inp.value; applyColors(settingsDraft.colors); }
});
document.getElementById('reset-colors-btn').addEventListener('click', () => {
  Object.assign(settingsDraft.colors, DEFAULT_COLORS);
  applyColors(settingsDraft.colors);
  renderColorRows();
});


// ─── SIDEBAR RESIZE ───────────────────────────────────────────────

(function initSidebarResize() {
  const sidebar  = document.getElementById('sidebar');
  const resizer  = document.getElementById('sb-resizer');

  // Restore saved width (v2 key resets any stale value from before 30% default)
  const saved = localStorage.getItem('sb-width-v2');
  if (saved) sidebar.style.width = saved + 'px';

  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    resizer.classList.add('is-dragging');
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = e => {
      const w = Math.max(180, Math.min(Math.round(window.innerWidth * 0.5), startW + e.clientX - startX));
      sidebar.style.width = w + 'px';
    };
    const onUp = () => {
      resizer.classList.remove('is-dragging');
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sb-width-v2', sidebar.offsetWidth);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
})();

// ─── INIT ─────────────────────────────────────────────────────────

async function init() {
  await Promise.all([load(), loadSettings()]);
  // Guard: S.tab must be a valid priority (old data may have saved 'archive')
  if (!PS.includes(S.tab)) S.tab = 'p0';
  cleanup();
  wire(document.getElementById('today-pane'));
  wire(document.getElementById('category-pane'));
  render();
}

init();
