// On-air spots for our own apps (ads/spots.js lists them; each page is built on
// ads/kit.js). The pad's On Air sheet fires one as a one-shot moment,
// current_animation { type: 'spot', meta: { cut: 'pitch' | 'inning', app, topic } },
// so it rides the same nonce rules as every stinger: it plays once, and a reload
// or an undo never replays it. The older { type: 'rtp', meta: { cut, play } }
// still plays, as Run the Play.
//
// Each app's page runs in its own transparent iframe. The frames load a few
// seconds after the overlay, one after another, and each says 'spot:ready' once
// its type and images are in, so the first spot of the night starts on the tap
// rather than after a download.

import { SPOT_APPS, KIT_FILES } from '../ads/spots.js';

const STALE_MS = 6000;     // a spot that could not start within this is dropped, not played late
const LONGEST_MS = 15000;  // a frame hides itself after this even if 'done' never arrives

// The banner sits top right, unless the scorebug is already up there.
const CUT_POS = { 'top-right': 'bl', 'top-center': 'bl', 'top-bar': 'bl' };

const frames = new Map();   // app id -> { el, ready, pending, hideTimer }

function ensure(app) {
  if (frames.has(app.id)) return frames.get(app.id);
  const el = document.createElement('iframe');
  el.className = 'app-spot';
  el.title = `${app.name} spot`;
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  el.src = `${app.page}?embed=1`;
  document.body.appendChild(el);
  const f = { el, ready: false, pending: null, hideTimer: 0 };
  frames.set(app.id, f);
  return f;
}
const post = (f, m) => f.el.contentWindow.postMessage(m, location.origin);
function hide(f) { clearTimeout(f.hideTimer); f.el.classList.remove('on'); }

addEventListener('message', (e) => {
  const f = [...frames.values()].find((x) => e.source === x.el.contentWindow);
  if (!f) return;
  const m = e.data || {};
  if (m.type === 'spot:ready') {
    f.ready = true;
    if (f.pending && Date.now() - f.pending.at < STALE_MS) post(f, f.pending.msg);
    else if (f.pending) hide(f);
    f.pending = null;
  }
  if (m.type === 'spot:done') hide(f);
});

// Called once at start-up: load the frames in the background, a little apart.
export function preloadSpots() {
  SPOT_APPS.forEach((app, i) => setTimeout(() => ensure(app), 4000 + i * 1500));
}

export function playSpot(anim, s) {
  const meta = anim.meta || {};
  const app = SPOT_APPS.find((a) => a.id === (anim.type === 'rtp' ? 'rtp' : meta.app));
  if (!app) return;
  const cut = meta.cut === 'inning' ? 'inning' : 'pitch';
  const topic = typeof meta.topic === 'string' ? meta.topic : typeof meta.play === 'string' ? meta.play : null;
  // Clear the announcement ticker when it is up, the way a bottom scorebug does.
  const t = s.ticker;
  const lift = t && t.on && typeof t.text === 'string' && t.text.trim() ? 60 : 0;
  const msg = { type: 'spot:play', cut, topic, pos: CUT_POS[s.scorebug_position] || 'tr', lift };
  for (const [id, other] of frames) if (id !== app.id) { post(other, { type: 'spot:stop' }); hide(other); }
  const f = ensure(app);
  f.el.classList.add('on');
  clearTimeout(f.hideTimer);
  f.hideTimer = setTimeout(() => hide(f), LONGEST_MS);
  if (f.ready) post(f, msg); else f.pending = { msg, at: Date.now() };
}

// The files the loaded spots use, for the release check before a reload (overlay.js).
export const spotFiles = () => (frames.size
  ? [...KIT_FILES, ...SPOT_APPS.filter((a) => frames.has(a.id)).flatMap((a) => [a.page, ...a.files])]
  : []);
