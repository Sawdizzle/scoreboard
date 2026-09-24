// Elevated scenes: the full-frame cards (Starting Soon, Mid-Inning, Final,
// Game paused) redrawn in the network-TV look of the Prime Time scorebug —
// glass rails, team-colour slabs, rolling numerals, wipes and gleams.
//
// The markup keeps every hook the overlay already drives, so the countdown
// (#card-cd), the weather line (.ss-wx), the half replay (.rp-strip), Due Up
// (.md-due), the Final line score and winner wash, and the storm on a pause
// card all work exactly as they do on the simple scenes. Only the look and the
// motion change. Entrances are gated on .enter (css/scenes-elevated.css), so a
// live refresh of Mid-Inning or Final never replays them.

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const attr = (t) => String(t ?? '').replace(/"/g, '&quot;');

const START_WORD = { baseball: 'First pitch', football: 'Kickoff', soccer: 'Kickoff', basketball: 'Tip-off', volleyball: 'First serve' };
const SPORT_WORD = { baseball: 'Baseball', football: 'Football', soccer: 'Soccer', basketball: 'Basketball', volleyball: 'Volleyball' };

// How long the entrance runs, so the overlay keeps .enter on until it's done.
export const ENTER_MS = 2800;

// The ambient layer every elevated scene sits on: two team-colour light pools
// that drift, a slow ray, and a gleam that crosses now and then. Transform and
// opacity only, so a scene can sit on air for half an hour without cost.
const BACKDROP = `<div class="el-bg" aria-hidden="true"><i class="el-pool a"></i><i class="el-pool h"></i><i class="el-ray"></i><i class="el-lines"></i><i class="el-gleam"></i></div>`;

function team(s, side) {
  const name = s[side + '_name'] || (side === 'home' ? 'Home' : 'Visitor');
  const abbr = s[side + '_abbr'] || name.slice(0, 4).toUpperCase();
  const color = s[side + '_color'] || (side === 'home' ? '#1b2a41' : '#7a8794');
  const logo = s[side + '_logo_url'];
  return { side, name, abbr, color, logo };
}
function crest(t, big) {
  if (t.logo) return `<span class="el-crest"><img src="${attr(t.logo)}" alt=""></span>`;
  const size = big ? (t.abbr.length >= 5 ? 64 : t.abbr.length === 4 ? 80 : 104) : (t.abbr.length >= 5 ? 26 : 32);
  return `<span class="el-crest mono"><b style="font-size:${size}px">${esc(t.abbr)}</b></span>`;
}
// A scoreboard row: colour slab (crest, abbreviation, name) and a score well.
function row(t, score, cls = '', i = 0) {
  return `<div class="el-row ${t.side}${cls}" style="--tc:${attr(t.color)};--i:${i}">
    <div class="el-slab">${t.logo ? crest(t) : ''}<span class="el-id"><b>${esc(t.abbr)}</b><small>${esc(t.name)}</small></span></div>
    <div class="el-well"><b style="--to:${score | 0}">${score | 0}</b></div></div>`;
}
function head(tag, kick, cls = '') {
  return `<div class="el-head${cls}"><span class="el-tag">${tag}</span>${kick ? `<span class="el-kick">${kick}</span>` : ''}</div>`;
}

// ---- Starting Soon ----------------------------------------------------------
function starting(c, s) {
  const meta = c.meta || {};
  const sport = SPORT_WORD[s.sport] ? s.sport : 'baseball';
  const a = team(s, 'away'), h = team(s, 'home');
  const t = s.starts_at ? new Date(s.starts_at) : null;
  const when = t ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const side = (x) => `<div class="el-side ${x.side}" style="--tc:${attr(x.color)}">
      <div class="el-card-t">${crest(x, true)}<i class="el-sheen"></i></div>
      <div class="el-nm"><b>${esc(x.name)}</b><span>${x.side === 'home' ? 'Home' : 'Visitors'}</span></div></div>`;
  return `<div class="card takeover-card el el-start" data-enter-ms="${ENTER_MS}">${BACKDROP}
    ${head(esc(SPORT_WORD[sport]), esc(meta.text || 'Game starting soon'))}
    <div class="el-match">${side(a)}<div class="el-vs"><i class="el-ring"></i><span>VS</span></div>${side(h)}</div>
    ${t ? `<div class="el-clock"><span class="el-lab">${START_WORD[sport]} in</span><div class="cd el-cd" id="card-cd" data-roll>--:--</div><span class="el-when">${esc(when)}</span></div>` : ''}
    <div class="ss-wx el-wx" hidden></div>
  </div>`;
}

// ---- Mid-Inning -------------------------------------------------------------
// The tag says it the way a booth does: MID 4 / END 4.
function breakTag(s, label) {
  if ((s.sport || 'baseball') !== 'baseball') return esc(label);
  const inn = s.inning | 0;
  if (s.half === 'bottom') return `MID ${inn}`;
  return inn > 1 ? `END ${inn - 1}` : `TOP ${inn || 1}`;
}
function midinning(c, s, h) {
  const meta = c.meta || {};
  const a = team(s, 'away'), hm = team(s, 'home');
  const label = meta.text || h.breakLabel(s);
  const baseball = (s.sport || 'baseball') === 'baseball';
  return `<div class="card takeover-card el el-mid" data-enter-ms="${ENTER_MS}">${BACKDROP}
    ${head(breakTag(s, label), esc(label))}
    <div class="el-board">${row(a, s.away_score, '', 0)}${row(hm, s.home_score, '', 1)}</div>
    ${h.lineScoreHtml(s, baseball ? h.finishedHalf(s) : null)}
    ${baseball ? h.recapStripHtml(s) : ''}
    ${baseball ? h.midDueUpHtml(s) : ''}
  </div>`;
}

// ---- Final ------------------------------------------------------------------
function final(c, s, h) {
  const meta = c.meta || {};
  const a = team(s, 'away'), hm = team(s, 'home');
  const story = h.finalStory(s);
  const w = story && story.winner;
  const cls = (x) => (w ? (w === x ? ' win' : ' lose') : '');
  const winColor = w ? (w === 'home' ? hm.color : a.color) : '';
  const tag = story && (story.walkoff ? 'Walk-off' : story.runRule ? `Run rule · ${story.innings} inn` : '');
  return `<div class="card takeover-card el el-final${w ? ' has-win win-' + w : ''}"${w ? ` data-win-color="${attr(winColor)}"` : ''} data-enter-ms="${ENTER_MS}">${BACKDROP}
    <div class="el-head fin"><span class="el-tag gold">${esc(meta.text || 'Final')}</span>${tag ? `<span class="el-kick fin-tag">${esc(tag)}</span>` : ''}</div>
    <div class="el-board">${row(a, s.away_score, cls('away'), 0)}${row(hm, s.home_score, cls('home'), 1)}</div>
    ${h.lineScoreHtml(s, null, true)}
  </div>`;
}

// ---- Game paused ------------------------------------------------------------
// Keeps .pz, .pz-title and .pz-clock: the storm (js/storm.js) finds the card
// by those and lights the headline on a strike.
function paused(c, s, h) {
  const meta = c.meta || {};
  const reason = h.PAUSE[meta.reason] ? meta.reason : 'weather';
  const r = h.PAUSE[reason];
  const until = !h.NO_CLOCK.has(reason) && meta.until ? new Date(meta.until) : null;
  const at = until ? until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const a = team(s, 'away'), hm = team(s, 'home');
  const where = reason === 'called' ? 'Final' : h.standsLabel(s);
  const mini = (t, score) => `<div class="el-mini-t" style="--tc:${attr(t.color)}"><b>${esc(t.abbr)}</b><span>${score | 0}</span></div>`;
  return `<div class="card takeover-card pz pz-${reason} el el-pause" data-enter-ms="${ENTER_MS}">${BACKDROP}<i class="el-hazard" aria-hidden="true"></i>
    ${head(`<i aria-hidden="true">${r.icon}</i>${esc(r.tag)}`, '', ' warn')}
    <div class="pz-title el-title">${esc(r.title)}</div>
    <div class="el-sub">${esc(meta.text || r.sub)}</div>
    <div class="el-mini">${mini(a, s.away_score)}${mini(hm, s.home_score)}${where ? `<span class="el-where">${esc(where)}</span>` : ''}</div>
    ${until ? `<div class="pz-clock el-clock"><span class="el-lab">${reason === 'lightning' ? 'Earliest restart' : 'Back at'} · ${esc(at)}</span><div class="cd el-cd" id="card-cd" data-roll>--:--</div></div>` : ''}
    <div class="ss-wx pz-wx el-wx" hidden></div>
  </div>`;
}

const SCENES = { starting, midinning, finalfull: final, paused };

// The elevated markup for a card, or null when the card has no elevated
// version (the overlay then builds its simple one).
export function elevatedScene(c, s, helpers) {
  const build = c && SCENES[c.type];
  return build ? build(c, s, helpers) : null;
}

// The countdown, digit by digit: only the digits that changed roll, so a clock
// counting down reads like a broadcast clock, not a repainted label.
export function rollDigits(el, txt) {
  const chars = [...txt];
  const cells = [...el.children];
  if (!el.dataset.v || cells.length !== chars.length) {
    el.innerHTML = chars.map((ch) => `<span class="rd"><b>${esc(ch)}</b></span>`).join('');
    el.dataset.v = txt;
    return;
  }
  chars.forEach((ch, i) => {
    const cell = cells[i], cur = cell.lastElementChild;
    if (!cur || cur.textContent === ch) return;
    const nu = document.createElement('b');
    nu.textContent = ch;
    cell.appendChild(nu);
    cur.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(70%)', opacity: 0 }],
      { duration: 260, easing: 'cubic-bezier(.7,0,.84,0)', fill: 'forwards' }).onfinish = () => cur.remove();
    nu.animate([{ transform: 'translateY(-70%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: 380, delay: 60, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
  });
  el.dataset.v = txt;
}
