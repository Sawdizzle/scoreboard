// Overlay animation engine. playAnimation() builds self-removing transient DOM
// inside #fx; setRally() toggles the ambient state. GPU-friendly (transform/opacity),
// alpha-transparent, each effect <= ~4.8s. Safe to fire mid-play.

// Titles now come off the game row (a play's text), not only from literals here.
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FX = () => document.getElementById('fx');
const BUG = () => document.getElementById('bug');

function mount(className, html, ms) {
  const el = document.createElement('div');
  el.className = 'fx-item ' + className;
  if (html) el.innerHTML = html;
  FX().appendChild(el);
  window.setTimeout(() => el.remove(), ms);
  return el;
}

// Radial particle burst from a host anchor point.
function burst(host, count, cls, baseDelay, colors) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = cls;
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = 120 + Math.random() * 240;
    p.style.setProperty('--dx', Math.round(Math.cos(ang) * dist) + 'px');
    p.style.setProperty('--dy', Math.round(Math.sin(ang) * dist) + 'px');
    p.style.setProperty('--r', Math.round(Math.random() * 720 - 360) + 'deg');
    p.style.animationDelay = (baseDelay + Math.random() * 0.2).toFixed(2) + 's';
    if (colors) p.style.background = colors[i % colors.length];
    host.appendChild(p);
  }
}

export function setRally(on) {
  document.body.classList.toggle('rally', !!on);
}

export function playAnimation(anim) {
  const meta = (anim && anim.meta) || {};
  switch (anim && anim.type) {
    case 'run':             return runFlash();
    case 'homerun':         return homerun();          // stays centered
    case 'touchdown':       return touchdown();        // stays centered
    case 'walkoff':         return walkoff();          // stays centered
    case 'goal':            return goalCelebration();  // stays centered
    // These slide out from behind the bug:
    // A play from the pad: "Groundout 6-3", with the hitter's name under it.
    case 'play':       if (meta.runs) runFlash(); return reveal(meta.text || 'PLAY', meta.sub);
    // A strikeout is a play like any other, not a full-frame moment: it happens
    // several times an inning, and a stamp over the whole picture every time was
    // more than the play is worth. The K rides in front of the title, reversed
    // for a called third strike, the way the scorebook writes it.
    case 'strikeout':        return reveal('STRIKEOUT', meta.sub, 'K');
    case 'strikeoutlooking': return reveal('STRIKEOUT LOOKING', meta.sub, 'K', 'backwards');
    case 'doubleplay': return reveal(meta.text || 'DOUBLE PLAY', meta.sub);
    case 'webgem':     return reveal('WALK');
    case 'stolenbase': return reveal('STOLEN BASE');
    case 'fieldgoal':  return reveal('FIELD GOAL');
    case 'turnover':   return reveal('TURNOVER');
    case 'bigplay':    return reveal(meta.text || 'BIG PLAY', meta.sub);
    case 'ace':        return reveal('ACE!');
    // The score that won it, since the scorebug has already reset to 0-0 for
    // the next set by the time this plays.
    case 'setwin':     return reveal(meta.away != null && meta.home != null
                                       ? `SET WON ${meta.away}\u2013${meta.home}`
                                       : 'SET WON');
    case 'three':      return reveal('THREE!');
  }
}

// A same-size card that slides out from behind the bug — up if the bug sits low,
// down if it's anchored at the top. Ends hidden behind the bug again.
function reveal(title, sub, glyph, glyphCls = '') {
  const layer = document.getElementById('reveal');
  if (!layer) return;
  const down = (document.body.dataset.pos || 'bottom-center').startsWith('top');
  layer.className = down ? 'from-top' : 'from-bottom';
  const g = glyph ? `<span class="rv-glyph ${glyphCls}" aria-hidden="true">${esc(glyph)}</span>` : '';
  layer.innerHTML = `<div class="reveal-card"><span class="rv-title">${g}${esc(title)}</span>${sub ? `<span class="rv-sub">${esc(sub)}</span>` : ''}</div>`;
  const card = layer.querySelector('.reveal-card');
  card.style.animation = `${down ? 'reveal-down' : 'reveal-up'} 2.6s cubic-bezier(.2, .8, .2, 1) both`;
  clearTimeout(layer._t);
  layer._t = window.setTimeout(() => { layer.className = ''; layer.innerHTML = ''; }, 2700);
}

function goalCelebration() {
  const el = mount('fx-walkoff', `<div class="wo-text">GOAL!</div><div class="wo-particles"></div>`, 4200);
  burst(el.querySelector('.wo-particles'), 40, 'confetti', 0.15, ['#8fb6de', '#e8b23a', '#f4f7fb', '#3b6fd6', '#d1483f']);
}

function touchdown() {
  const el = mount('fx-hr', `
    <div class="hr-rays"></div>
    <div class="hr-plate"><span class="hr-l1">TOUCH</span><span class="hr-l2">DOWN</span></div>
    <div class="hr-particles"></div>`, 4800);
  burst(el.querySelector('.hr-particles'), 30, 'chalk', 0.4);
}

function runFlash() {
  const b = BUG();
  if (b) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); window.setTimeout(() => b.classList.remove('pulse'), 950); }
  mount('fx-run-flash', '', 850);
}

function homerun() {
  const el = mount('fx-hr', `
    <div class="hr-ball"></div>
    <div class="hr-rays"></div>
    <div class="hr-plate"><span class="hr-l1">HOME</span><span class="hr-l2">RUN</span></div>
    <div class="hr-particles"></div>`, 4800);
  burst(el.querySelector('.hr-particles'), 30, 'chalk', 0.85);
}

function walkoff() {
  const el = mount('fx-walkoff', `<div class="wo-text">WALK-OFF!</div><div class="wo-particles"></div>`, 4800);
  burst(el.querySelector('.wo-particles'), 40, 'confetti', 0.15, ['#8fb6de', '#e8b23a', '#f4f7fb', '#3b6fd6', '#d1483f']);
}
