// Run the Play spot: an on-air ad for our other app (the page is /ads/runtheplay).
// The pad's On Air sheet fires it as a one-shot moment, current_animation
// { type: 'rtp', meta: { cut: 'pitch' | 'inning' } }, so it rides the same nonce
// rules as every stinger: it plays once, and a reload or an undo never replays it.
//
// The spot runs in its own transparent iframe. The frame loads a few seconds
// after the overlay and says 'rtp:ready' once its type and logo are in, so the
// first spot of the night starts on the tap rather than after a download.

const SRC = '/ads/runtheplay?embed=1';
const STALE_MS = 6000;     // a spot that could not start within this is dropped, not played late
const LONGEST_MS = 15000;  // the frame hides itself after this even if 'done' never arrives

// The quick cut is a lower third, so it goes on the edge away from the scorebug.
const CUT_POS = {
  'bottom-left': 'br', 'bottom-right': 'bl', 'bottom-center': 'tc', 'bottom-bar': 'tc',
  'mid-left': 'br', 'mid-center': 'bl', 'mid-right': 'bl',
  'top-left': 'bl', 'top-center': 'bl', 'top-right': 'bl', 'top-bar': 'bl',
};

let frame = null, ready = false, pending = null, hideTimer = 0;

function ensure() {
  if (frame) return;
  frame = document.createElement('iframe');
  frame.id = 'rtp-spot';
  frame.title = 'Run the Play spot';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.src = SRC;
  document.body.appendChild(frame);
}
const post = (m) => frame.contentWindow.postMessage(m, location.origin);
function hide() { clearTimeout(hideTimer); if (frame) frame.classList.remove('on'); }

addEventListener('message', (e) => {
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data || {};
  if (m.type === 'rtp:ready') {
    ready = true;
    if (pending && Date.now() - pending.at < STALE_MS) post(pending.msg);
    else if (pending) hide();
    pending = null;
  }
  if (m.type === 'rtp:done') hide();
});

// Called once at start-up: load the frame in the background.
export function preloadSpot() { setTimeout(ensure, 4000); }

export function playSpot(anim, s) {
  ensure();
  const cut = anim.meta && anim.meta.cut === 'inning' ? 'inning' : 'pitch';
  // Clear the announcement ticker when it is up, the way a bottom scorebug does.
  const t = s.ticker;
  const lift = t && t.on && typeof t.text === 'string' && t.text.trim() ? 60 : 0;
  const msg = { type: 'rtp:play', spot: cut, pos: CUT_POS[s.scorebug_position] || 'bl', lift };
  frame.classList.add('on');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, LONGEST_MS);
  if (ready) post(msg); else pending = { msg, at: Date.now() };
}

// The files the spot loads, for the release check before a reload (overlay.js).
export const spotFiles = () => (frame
  ? ['/ads/runtheplay', '/ads/img/rtp-mark.png', '/fonts/ads/teko-500.woff2', '/fonts/ads/teko-600.woff2']
  : []);
