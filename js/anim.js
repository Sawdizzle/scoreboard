// Overlay animation engine. playAnimation() builds self-removing transient DOM
// inside #fx; setRally() toggles the ambient state. GPU-friendly (transform/opacity),
// alpha-transparent, each effect <= ~4.8s. Safe to fire mid-play.

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
  switch (anim && anim.type) {
    case 'run':        return runFlash();
    case 'homerun':    return homerun();
    case 'strikeout':  return stamp('K', 'fx-k');
    case 'doubleplay': return lowerThird('DOUBLE PLAY', '6 · 4 · 3');
    case 'webgem':     return lowerThird('WEB GEM', 'WHAT A PLAY', 'gem');
    case 'stolenbase': return stolen();
    case 'walkoff':    return walkoff();
    case 'touchdown':  return touchdown();
    case 'fieldgoal':  return lowerThird('FIELD GOAL', '3 POINTS');
    case 'turnover':   return lowerThird('TURNOVER', 'CHANGE OF POSSESSION', 'turn');
    case 'bigplay':    return lowerThird('BIG PLAY', '');
  }
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

function stamp(text, cls) {
  return mount('fx-stamp ' + cls, `<span>${text}</span>`, 1800);
}

function lowerThird(title, sub, cls = '') {
  return mount('fx-lower ' + cls, `<div class="lt-bar"><b>${title}</b><i>${sub}</i></div>`, 3000);
}

function stolen() {
  return mount('fx-stolen', `<div class="sb-dust"></div><div class="sb-text">STOLEN BASE</div>`, 2200);
}

function walkoff() {
  const el = mount('fx-walkoff', `<div class="wo-text">WALK-OFF!</div><div class="wo-particles"></div>`, 4800);
  burst(el.querySelector('.wo-particles'), 40, 'confetti', 0.15, ['#8fb6de', '#e8b23a', '#f4f7fb', '#3b6fd6', '#d1483f']);
}
