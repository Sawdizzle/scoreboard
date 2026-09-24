// Animated scorebugs. A game whose style is 'anim-<slug>' swaps the overlay's
// own bug for one of the /bugs pages, loaded in a transparent frame over the
// stage. Each render hands the frame the game (in the bug's shape) and the
// stinger that came with it; the bug's kit (bugs/kit.js) works out the moment.
// Baseball only — any other sport keeps the regular bug.
import { safeBases, currentBatter, currentPitcher, pitchCount, strikeoutsFor } from './logic.js';

export const ANIM_BUGS = ['primetime', 'classic-green', 'pinball-dmd', 'chalkboard', 'comic', 'split-flap', 'receipt', 'pixel-rpg'];

// Stingers the animated bug plays itself. The overlay's own version of these
// slides out from behind a bug that is no longer on screen. A walk-off, a rally
// or a card still plays over the top as usual.
const OWN = new Set(['run', 'homerun', 'play', 'strikeout', 'strikeoutlooking', 'doubleplay', 'bigplay', 'stolenbase', 'webgem']);
// Bugs with a walk-off of their own. For the rest the overlay's celebration plays.
const OWN_WALKOFF = new Set(['primetime']);
const plays = (type) => OWN.has(type) || (type === 'walkoff' && OWN_WALKOFF.has(slug));

const POS = {
  'top-left': 'tl', 'top-center': 'tc', 'top-right': 'tr', 'top-bar': 'tc',
  'mid-left': 'ml', 'mid-center': 'mc', 'mid-right': 'mr',
  'bottom-left': 'bl', 'bottom-center': 'bc', 'bottom-right': 'br', 'bottom-bar': 'bc',
};

let frame = null, slug = null, ready = false, pending = null;

export function animBugSlug(s) {
  const st = String((s && s.style) || '');
  const name = st.startsWith('anim-') ? st.slice(5) : '';
  return (s.sport || 'baseball') === 'baseball' && ANIM_BUGS.includes(name) ? name : null;
}

function team(s, side) {
  const name = s[side + '_name'] || (side === 'home' ? 'Home' : 'Visitor');
  return {
    name, abbr: s[side + '_abbr'] || name, color: s[side + '_color'] || '#888',
    r: s[side + '_score'] | 0, h: s[side + '_hits'] | 0, e: s[side + '_errors'] | 0, line: [],
    k: strikeoutsFor(s, side),   // strikeouts by this side's pitcher on the mound
  };
}

// The game row in the bug's shape. An animated bug is built around the at-bat,
// so it always names the batter (just "Batter" without a lineup); the pitch
// count follows its Show on overlay switch.
function bugState(s) {
  const b = safeBases(s.bases);
  const lb = currentBatter(s), lp = currentPitcher(s);
  return {
    away: team(s, 'away'), home: team(s, 'home'),
    inning: s.inning | 0 || 1, half: s.half === 'bottom' ? 'bot' : 'top',
    balls: s.balls | 0, strikes: s.strikes | 0, outs: s.outs | 0,
    bases: [!!b.first, !!b.second, !!b.third],
    batter: (lb && lb.name) || 'Batter',
    pitcher: (lp && lp.name) || '',
    pitchCount: s.show_pitchcount ? pitchCount(s) : 0,
  };
}

function post(msg) {
  if (ready) frame.contentWindow.postMessage(msg, location.origin);
  else pending = msg.anim || !pending ? msg : { ...msg, anim: pending.anim }; // keep a queued stinger
}

// Paint the animated bug for this render. Returns true when it is on screen,
// so the caller can leave out the stingers it plays itself.
export function syncAnimBug(s, anim) {
  const want = animBugSlug(s);
  document.body.classList.toggle('anim', !!want);
  if (!want) {
    if (frame) { frame.remove(); frame = null; slug = null; ready = false; pending = null; }
    return false;
  }
  if (want !== slug) {
    if (frame) frame.remove();
    slug = want; ready = false; pending = null;
    frame = document.createElement('iframe');
    frame.id = 'anim-bug';
    frame.title = 'Animated scorebug';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.addEventListener('load', () => { ready = true; if (pending) post(pending); pending = null; });
    frame.src = `/bugs/${want}?embed=1`;
    document.body.appendChild(frame);
    anim = null; // a fresh bug paints the game as it stands
  }
  // Lift a bottom bug over the ticker, read off the row: the ticker paints after this.
  const t = s.ticker;
  const lift = t && t.on && typeof t.text === 'string' && t.text.trim() ? 60 : 0;
  post({
    type: 'scoreboard:live',
    state: bugState(s),
    anim: anim && plays(anim.type) ? { type: anim.type, meta: anim.meta || {} } : null,
    view: { pos: POS[s.scorebug_position] || 'bc', scale: +s.scorebug_scale || 1, lift, rally: !!s.rally_mode },
  });
  return true;
}

// The files the animated bug on screen loads, for the release check before a
// reload (overlay.js). None when no animated bug is up.
export const animBugFiles = () => (slug ? [`/bugs/${slug}`, '/bugs/kit.js'] : []);

// Whether the overlay should still play this stinger itself.
export const overlayPlays = (anim, onScreen) => !onScreen || !plays(anim && anim.type);
