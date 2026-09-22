// The Starting Soon takeover: markup and name fitting. Its own module so it can
// be previewed without a live game (the overlay itself needs a game id to load).
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escapeAttr = (t) => String(t).replace(/"/g, '&quot;');

// ---- Starting Soon ----------------------------------------------------------
// The pre-game scene can sit on air for half an hour, so it carries its own
// motion: the sport's field drawing itself behind, the ball turning in the
// middle, team colours sweeping in from each side. Everything is transform /
// opacity / stroke animation — no layout work on the tick.
const SS_SPORT = {
  baseball:   { label: 'Baseball',   start: 'First pitch' },
  football:   { label: 'Football',   start: 'Kickoff' },
  soccer:     { label: 'Soccer',     start: 'Kickoff' },
  basketball: { label: 'Basketball', start: 'Tip-off' },
  volleyball: { label: 'Volleyball', start: 'First serve' },
};
// Faint field markings, 1920×1080, drawn with stroke-dash so they trace in.
const SS_FIELD = {
  baseball: `<path class="ln" d="M960 980 L1330 610 L960 240 L590 610 Z"/>
    <path class="ln" d="M960 980 L260 280 M960 980 L1660 280"/>
    <path class="ln" d="M470 470 Q960 -40 1450 470"/>
    <circle class="ln" cx="960" cy="640" r="52"/>
    <rect class="base" x="1312" y="592" width="36" height="36" transform="rotate(45 1330 610)"/>
    <rect class="base" x="942" y="222" width="36" height="36" transform="rotate(45 960 240)"/>
    <rect class="base" x="572" y="592" width="36" height="36" transform="rotate(45 590 610)"/>`,
  football: `<g class="yards">${Array.from({ length: 13 }, (_, i) => `<path class="ln" d="M${i * 160} 150 L${i * 160} 930"/>`).join('')}</g>
    <path class="ln" d="M0 150 H1920 M0 930 H1920"/>`,
  soccer: `<path class="ln" d="M960 90 V990"/><circle class="ln" cx="960" cy="540" r="190"/>
    <path class="ln" d="M60 90 H1860 V990 H60 Z"/><path class="ln" d="M60 330 H330 V750 H60 M1860 330 H1590 V750 H1860"/>`,
  basketball: `<path class="ln" d="M960 90 V990"/><circle class="ln" cx="960" cy="540" r="150"/>
    <path class="ln" d="M60 90 H1860 V990 H60 Z"/><path class="ln" d="M60 190 Q700 540 60 890 M1860 190 Q1220 540 1860 890"/>
    <path class="ln" d="M60 390 H440 V690 H60 M1860 390 H1480 V690 H1860"/>`,
  volleyball: `<path class="ln" d="M160 140 H1760 V940 H160 Z"/><path class="ln" d="M160 400 H1760 M160 680 H1760"/>
    <g class="net">${Array.from({ length: 25 }, (_, i) => `<path class="ln thin" d="M${160 + i * 66.7} 510 V570"/>`).join('')}
    <path class="ln" d="M160 510 H1760 M160 570 H1760"/></g>`,
};
// The ball that turns in the middle, behind VS.
const SS_BALL = {
  baseball: `<circle cx="50" cy="50" r="46" fill="#f5f2ea"/>
    <path d="M22 16 Q40 50 22 84 M78 16 Q60 50 78 84" fill="none" stroke="#c8322b" stroke-width="3.2" stroke-dasharray="4 4"/>`,
  football: `<ellipse cx="50" cy="50" rx="46" ry="28" fill="#7a3f1c"/>
    <path d="M30 50 H70" stroke="#fff" stroke-width="3"/>${[36, 43, 50, 57, 64].map((x) => `<path d="M${x} 45 V55" stroke="#fff" stroke-width="3"/>`).join('')}
    <path d="M12 38 Q16 50 12 62 M88 38 Q84 50 88 62" fill="none" stroke="#fff" stroke-width="3"/>`,
  soccer: `<circle cx="50" cy="50" r="46" fill="#f5f5f5"/>
    <path d="M50 32 L67 44 L60 64 H40 L33 44 Z" fill="#1b1f27"/>
    <path d="M50 32 V8 M67 44 L90 36 M60 64 L74 86 M40 64 L26 86 M33 44 L10 36" stroke="#1b1f27" stroke-width="2.5"/>`,
  basketball: `<circle cx="50" cy="50" r="46" fill="#e0782c"/>
    <path d="M4 50 H96 M50 4 V96 M18 16 Q42 50 18 84 M82 16 Q58 50 82 84" fill="none" stroke="#2a150a" stroke-width="3"/>`,
  volleyball: `<circle cx="50" cy="50" r="46" fill="#f4f1e6"/>
    <path d="M50 4 Q30 40 50 50 Q74 40 94 58 M50 50 Q52 76 22 88 M50 50 Q20 58 8 36" fill="none" stroke="#1f4fa3" stroke-width="3.5"/>`,
};
function ssTeam(side, s) {
  const name = s[side + '_name'] || (side === 'home' ? 'Home' : 'Visitor');
  const abbr = s[side + '_abbr'] || name.slice(0, 3).toUpperCase();
  const logo = s[side + '_logo_url']
    ? `<img src="${escapeAttr(s[side + '_logo_url'])}" alt="">`
    : `<span class="ss-mono" style="font-size:${abbr.length >= 5 ? 58 : abbr.length === 4 ? 72 : 92}px">${escapeHtml(abbr)}</span>`;   // no logo: a monogram in the team colour
  return `<div class="ss-team ${side}"><div class="ss-logo">${logo}</div>
    <div class="cname">${escapeHtml(name)}</div><div class="ss-bar"></div></div>`;
}
export function startingCard(meta, s) {
  const sport = SS_SPORT[s.sport] ? s.sport : 'baseball';
  const info = SS_SPORT[sport];
  const t = s.starts_at ? new Date(s.starts_at) : null;
  const when = t ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return `<div class="card takeover-card starting ss ss-${sport}">
    <svg class="ss-field" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${SS_FIELD[sport]}</svg>
    <div class="ss-kicker"><span class="ss-sport">${info.label}</span><span class="ss-sub">${escapeHtml(meta.text || 'Game starting soon')}</span></div>
    <div class="ss-main">
      ${ssTeam('away', s)}
      <div class="ss-mid"><svg class="ss-ball" viewBox="0 0 100 100" aria-hidden="true">${SS_BALL[sport]}</svg><span class="ss-vs">VS</span></div>
      ${ssTeam('home', s)}
    </div>
    <div class="ss-wx" id="ss-wx" hidden></div>
    ${t ? `<div class="ss-clock"><div class="cd" id="card-cd">--:--</div><div class="cd-when">${info.start} · ${escapeHtml(when)}</div></div>` : ''}
  </div>`;
}
// Long names ("Wildcats Baseball - Owens") step down until they fit two lines,
// so both sides stay the same height and VS stays dead centre.
export function fitStartingNames(root) {
  const names = [...root.querySelectorAll('.ss .cname')];
  let size = 72;
  for (const el of names) {
    el.style.fontSize = size + 'px';
    while (size > 36 && el.scrollHeight > size * 1.08 * 2 + 4) { size -= 2; el.style.fontSize = size + 'px'; }
  }
  // One size for both, so the sides mirror each other.
  names.forEach((el) => { el.style.fontSize = size + 'px'; });
}

// The weather line under the countdown. Filled in after the card is up, and
// again on every forecast refresh, without rebuilding the card around it.
export function weatherHtml(w, venue) {
  if (!w) return '';
  const bits = [`<b class="wx-t">${w.temp}°</b>`, `<span>${escapeHtml(w.text)}</span>`];
  if (w.wind) bits.push(`<span>Wind ${escapeHtml(w.dir)} ${w.wind} mph</span>`);
  if (w.pop != null) bits.push(`<span>${w.pop}% rain</span>`);
  return `<span class="wx-i" aria-hidden="true">${w.icon}</span>${bits.join('<i class="wx-dot">·</i>')}`
    + (venue && venue.label ? `<span class="wx-where">${escapeHtml(venue.label)}</span>` : '');
}
