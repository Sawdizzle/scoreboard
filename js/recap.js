import { supabase, db } from './supabase.js';

// A public scoreboard page for parents: the link the operator shares. It reads
// the same row the overlay does, minus anything private — the roster is not on
// this row at all, so there is nothing here to leak. Stays live while the game
// is on, so a shared link is useful during the game and after it.
const gameId = new URLSearchParams(location.search).get('game');
const el = document.getElementById('recap');
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// These go inside a style attribute, where esc() is the wrong tool: it stops you
// breaking out of the attribute but not out of the declaration, so a value with
// a semicolon in it could set whatever else it liked on that element. They come
// from <input type="color"> today; that is one hand-written API write away from
// not being true, on a page handed to parents.
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const color = (v, fallback) => (HEX.test(String(v ?? '')) ? String(v) : fallback);

const ORD = { 1: '1st', 2: '2nd', 3: '3rd' };
const ordinal = (n) => ORD[n] || `${n}th`;

function stateLine(g) {
  if (g.status === 'final') return 'Final';
  if (g.status === 'setup') return 'Not started';
  const st = g.state || {};
  switch (g.sport || 'baseball') {
    case 'football': return `Q${st.quarter || 1}`;
    case 'basketball': return `Q${st.period || 1}`;
    case 'soccer': return (st.half || 1) === 1 ? '1st half' : '2nd half';
    case 'volleyball': return `Set ${st.set || 1}`;
    default: return `${g.half === 'bottom' ? 'Bottom' : 'Top'} ${ordinal(g.inning || 1)}`;
  }
}

function lineScore(g) {
  if ((g.sport || 'baseball') !== 'baseball' || !Array.isArray(g.line_score) || !g.line_score.length) return '';
  const cells = (side) => g.line_score.map((x) => `<td>${x?.[side] ?? 0}</td>`).join('');
  const heads = g.line_score.map((_, i) => `<th>${i + 1}</th>`).join('');
  return `<div class="ls-wrap"><table class="ls">
    <tr><th></th>${heads}<th class="rhe">R</th><th class="rhe">H</th><th class="rhe">E</th></tr>
    <tr><th>${esc(g.away_abbr || g.away_name)}</th>${cells('top')}<td class="rhe">${g.away_score | 0}</td><td class="rhe">${g.away_hits | 0}</td><td class="rhe">${g.away_errors | 0}</td></tr>
    <tr><th>${esc(g.home_abbr || g.home_name)}</th>${cells('bottom')}<td class="rhe">${g.home_score | 0}</td><td class="rhe">${g.home_hits | 0}</td><td class="rhe">${g.home_errors | 0}</td></tr>
  </table></div>`;
}

const logo = (url) => (url ? `<img class="logo" src="${esc(url)}" alt="" />` : '<div class="logo ph"></div>');

function render(g) {
  const live = g.status === 'live';
  const done = g.status === 'final';
  const winner = done && g.away_score !== g.home_score ? (g.away_score > g.home_score ? 'away' : 'home') : null;
  const when = g.starts_at ? new Date(g.starts_at) : new Date(g.created_at);
  el.innerHTML = `
    <div class="status ${done ? 'final' : live ? 'live' : ''}">${live ? '<span class="dot"></span>' : ''}${esc(stateLine(g))}</div>
    <div class="score" style="--away:${color(g.away_color, '#7a8794')};--home:${color(g.home_color, '#1b2a41')}">
      <div class="side ${winner === 'away' ? 'win' : ''}">
        ${logo(g.away_logo_url)}
        <div class="name">${esc(g.away_name || 'Visitor')}</div>
        <div class="runs">${g.away_score | 0}</div>
      </div>
      <div class="at">at</div>
      <div class="side ${winner === 'home' ? 'win' : ''}">
        ${logo(g.home_logo_url)}
        <div class="name">${esc(g.home_name || 'Home')}</div>
        <div class="runs">${g.home_score | 0}</div>
      </div>
    </div>
    ${lineScore(g)}
    <p class="when">${when.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    <p class="foot">Scoreboard${live ? ' · updating live' : ''}</p>`;
  document.title = `${g.away_abbr || g.away_name} ${g.away_score}–${g.home_score} ${g.home_abbr || g.home_name}`;
}

async function load() {
  const { data, error } = await db.from('games').select('*').eq('id', gameId).maybeSingle();
  if (error || !data) { el.innerHTML = '<p class="loading">That game isn\'t available.</p>'; return; }
  render(data);
}

if (!gameId) {
  el.innerHTML = '<p class="loading">No game in this link.</p>';
} else {
  load();
  // Same realtime path as the overlay, so a link shared at first pitch keeps up.
  supabase.channel(`recap:${gameId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'scoreboard', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => render(payload.new))
    .subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
