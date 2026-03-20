// ─── DEFAULT COLORS (used for Reset) ─────────────────────────────

export const DEFAULT_COLORS = {
  bg:         '#eef6fc',
  surface:    '#ffffff',
  border:     '#d0e6f4',
  borderSoft: '#e5f1fa',
  text:       '#1F232F',
  muted:      '#6b8fa3',
  light:      '#a4c3d5',
  today:      '#0ea5e9',
  p0:         '#27254C',
  p1:         '#564A94',
  p2:         '#9B8AB4',
  p3:         '#C5B8D9',
};

export const COLOR_LABELS = {
  bg:      'Background',
  surface: 'Cards / Surface',
  border:  'Border',
  text:    'Text',
  today:   'Today accent',
  p0:      'P0 · Urgent & Important',
  p1:      'P1 · Important',
  p2:      'P2 · Urgent',
  p3:      'P3 · Someday',
};

// ─── SETTINGS STATE ───────────────────────────────────────────────
// SS.gifs stores server paths like '/data/gifs/pikachu.gif'

export const SS = {
  gifs:                [],
  celebrationMessages: ['Yay!'],
  colors:              { ...DEFAULT_COLORS },
  fontScale:           1,
  gifNames:            {},   // path → custom display name
};

// ─── APPLY COLORS TO CSS CUSTOM PROPERTIES ────────────────────────

function toKebab(key) {
  return key.replace(/([A-Z])/g, m => '-' + m.toLowerCase());
}

export function applyColors(colors) {
  const root = document.documentElement;
  for (const [key, val] of Object.entries(colors)) {
    root.style.setProperty(`--${toKebab(key)}`, val);
  }
}

export function applyFontScale(scale) {
  document.body.style.fontSize = (scale && scale !== 1) ? `${13 * scale}px` : '';
}

// ─── PERSISTENCE ──────────────────────────────────────────────────

export function saveSettings() {
  fetch('/api/settings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(SS),
  }).catch(() => {});
}

export async function loadSettings() {
  try {
    const res  = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.gifs)) SS.gifs = data.gifs;
    // Support new array format; migrate old single-string format
    if (Array.isArray(data.celebrationMessages) && data.celebrationMessages.length) {
      SS.celebrationMessages = data.celebrationMessages;
    } else if (typeof data.celebrationMessage === 'string') {
      SS.celebrationMessages = [data.celebrationMessage];
    }
    if (data.colors) Object.assign(SS.colors, data.colors);
    if (typeof data.fontScale === 'number') SS.fontScale = data.fontScale;
    if (data.gifNames && typeof data.gifNames === 'object') SS.gifNames = data.gifNames;
    applyColors(SS.colors);
    applyFontScale(SS.fontScale);
  } catch (e) {
    console.warn('Settings load error:', e);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────

export function gifDisplayName(src, names = SS.gifNames) {
  if (names?.[src]) return names[src];
  return src.split('/').pop()
    .replace(/\.[^.]+$/, '').replace(/^\d+_/, '').replace(/_/g, ' ');
}

export function randomGif() {
  if (!SS.gifs.length) return null;
  return SS.gifs[Math.floor(Math.random() * SS.gifs.length)];
}

export function randomMessage() {
  if (!SS.celebrationMessages.length) return 'Yay!';
  return SS.celebrationMessages[Math.floor(Math.random() * SS.celebrationMessages.length)];
}
