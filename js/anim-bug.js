// Animated scorebugs. A game whose style is 'anim-<slug>' swaps the overlay's
// own bug for one of the /bugs pages, loaded in a transparent frame over the
// stage. Each render hands the frame the game (in the bug's shape) and the
// stinger that came with it; the bug's kit (bugs/kit.js) works out the moment.
// Baseball bugs, plus Prime Time for every sport (SPORTS_OF); a sport a bug
// doesn't cover keeps the regular bug.
import { safeBases, currentBatter, currentPitcher, pitchCount, strikeoutsFor } from './logic.js';

export const ANIM_BUGS = ['primetime', 'classic-green', 'pinball-dmd', 'chalkboard', 'comic', 'split-flap', 'receipt', 'pixel-rpg'];

// Stingers the animated bug plays itself. The overlay's own version of these
// slides out from behind a bug that is no longer on screen. A walk-off, a rally
// or a card still plays over the top as usual.
const OWN = new Set(['run', 'homerun', 'play', 'strikeout', 'strikeoutlooking', 'doubleplay', 'bigplay', 'stolenbase', 'webgem']);
// The other sports' stingers, for a bug that covers the sport. The overlay's
// charge (rally) still plays over the top.
const OWN_SPORT = new Set(['touchdown', 'fieldgoal', 'turnover', 'bigplay', 'goal', 'three', 'ace', 'setwin']);
// Which sports each bug covers. Everything else is baseball only.
const SPORTS_OF = { primetime: ['baseball', 'football', 'soccer', 'basketball', 'volleyball'] };
export const bugCovers = (name, sport) => (SPORTS_OF[name] || ['baseball']).includes(sport || 'baseball');
// Bugs with a walk-off of their own (all of them, since v4.31). One left out of
// this list gets the overlay's own celebration instead.
const OWN_WALKOFF = new Set(ANIM_BUGS);
const plays = (type) => sport === 'baseball'
  ? OWN.has(type) || (type === 'walkoff' && OWN_WALKOFF.has(slug))
  : OWN_SPORT.has(type);

const POS = {
  'top-left': 'tl', 'top-center': 'tc', 'top-right': 'tr', 'top-bar': 'tc',
  'mid-left': 'ml', 'mid-center': 'mc', 'mid-right': 'mr',
  'bottom-left': 'bl', 'bottom-center': 'bc', 'bottom-right': 'br', 'bottom-bar': 'bc',
};

let frame = null, slug = null, ready = false, pending = null, sport = 'baseball', clock = null;

export function animBugSlug(s) {
  const st = String((s && s.style) || '');
  const name = st.startsWith('anim-') ? st.slice(5) : '';
  return ANIM_BUGS.includes(name) && bugCovers(name, s.sport) ? name : null;
}

function team(s, side) {
  const name = s[side + '_name'] || (side === 'home' ? 'Home' : 'Visitor');
  return {
    name, abbr: s[side + '_abbr'] || name, color: s[side + '_color'] || '#888',
    r: s[side + '_score'] | 0, h: s[side + '_hits'] | 0, e: s[side + '_errors'] | 0, line: [],
    k: strikeoutsFor(s, side),   // strikeouts by this side's pitcher on the mound
  };
}

// The game row in the bug's shape. The batter is named whenever the lineup
// knows him and left empty otherwise — each bug has a way to say a play
// without a name. The pitch count follows its Show on overlay switch.
export function bugState(s) {
  const b = safeBases(s.bases);
  const lb = currentBatter(s), lp = currentPitcher(s);
  return {
    away: team(s, 'away'), home: team(s, 'home'),
    inning: s.inning | 0 || 1, half: s.half === 'bottom' ? 'bot' : 'top',
    balls: s.balls | 0, strikes: s.strikes | 0, outs: s.outs | 0,
    bases: [!!b.first, !!b.second, !!b.third],
    batter: (lb && lb.name) || '',
    pitcher: (lp && lp.name) || '',
    pitchCount: s.show_pitchcount ? pitchCount(s) : 0,
    sport: s.sport || 'baseball',
    sit: sitFor(s),
  };
}

// Every other sport in one shape, so a bug can draw any of them the same way:
// the period and its number, a line under it (down and distance, stoppage,
// bonus, a set's target), who has the ball or the serve, and a small mark per
// team with its label (timeouts, cards, fouls, sets won).
const ORD = { 1: '1ST', 2: '2ND', 3: '3RD', 4: '4TH' };
const dots = (n, max) => '●'.repeat(Math.max(0, Math.min(max, n | 0))) + '○'.repeat(Math.max(0, max - (n | 0)));
export function sitFor(s) {
  const st = s.state || {};
  switch (s.sport) {
    case 'football': {
      const q = st.quarter || 1, dist = st.distance;
      return { period: q > 4 ? 'OT' : `${ORD[q]} QTR`, periodNo: q,
        line: `${ORD[st.down || 1] || (st.down || 1) + 'TH'} & ${dist === 'goal' ? 'GOAL' : dist == null ? 10 : dist}`,
        poss: st.possession || null, markLabel: 'TO',
        marks: { away: dots(st.away_timeouts ?? 3, 3), home: dots(st.home_timeouts ?? 3, 3) } };
    }
    case 'soccer': {
      const h = st.half || 1, c = st.cards || {};
      const card = (x) => [x && x.y ? `${x.y}Y` : '', x && x.r ? `${x.r}R` : ''].filter(Boolean).join(' ') || '—';
      return { period: h === 1 ? '1ST HALF' : h === 2 ? '2ND HALF' : 'EXTRA', periodNo: h,
        line: st.stoppage ? `+${st.stoppage}` : '', poss: null, markLabel: 'CARDS',
        marks: { away: card(c.away), home: card(c.home) } };
    }
    case 'basketball': {
      const p = st.period || 1, f = st.fouls || {};
      const bonus = [(f.home | 0) >= 7 ? s.away_abbr || 'AWAY' : '', (f.away | 0) >= 7 ? s.home_abbr || 'HOME' : ''].filter(Boolean);
      return { period: p > 4 ? 'OT' : `${ORD[p]} QTR`, periodNo: p,
        line: bonus.length ? `BONUS · ${bonus.join(' · ')}` : '', poss: null, markLabel: 'FOULS',
        marks: { away: String(f.away | 0), home: String(f.home | 0) } };
    }
    case 'volleyball': {
      const set = st.set || 1, sets = st.sets || {};
      return { period: `SET ${set}`, periodNo: set,
        line: st.target && st.target !== 25 ? `TO ${st.target}` : '', poss: st.serve || null, markLabel: 'SETS',
        marks: { away: String(sets.away | 0), home: String(sets.home | 0) } };
    }
    default: return null;
  }
}

// The clock, as the overlay paints it (paintClock), for a bug that shows one.
export function animBugClock(c) {
  clock = c;
  if (frame && ready && sport !== 'baseball') frame.contentWindow.postMessage({ type: 'scoreboard:clock', clock: c }, location.origin);
}

function post(msg) {
  if (ready) frame.contentWindow.postMessage(msg, location.origin);
  else pending = msg.anim || !pending ? msg : { ...msg, anim: pending.anim }; // keep a queued stinger
}

// Paint the animated bug for this render. Returns true when it is on screen,
// so the caller can leave out the stingers it plays itself.
export function syncAnimBug(s, anim) {
  const want = animBugSlug(s);
  sport = s.sport || 'baseball';
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
    frame.addEventListener('load', () => { ready = true; if (pending) post(pending); pending = null; if (clock) animBugClock(clock); });
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
