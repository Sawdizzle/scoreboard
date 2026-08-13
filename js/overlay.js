import { supabase, db } from './supabase.js';
import { safeBases } from './logic.js';
import { playAnimation, setRally } from './anim.js';
import * as audio from './audio.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('game');
if (params.get('debug')) { document.body.classList.add('debug'); window.__audio = audio; }

const el = {
  bug: document.getElementById('bug'),
  awayAbbr: document.getElementById('away-abbr'),
  homeAbbr: document.getElementById('home-abbr'),
  awayRuns: document.getElementById('away-runs'),
  homeRuns: document.getElementById('home-runs'),
  inning: document.getElementById('inning'),
  balls: document.getElementById('balls'),
  strikes: document.getElementById('strikes'),
  outs: document.getElementById('outs'),
};

let last = null; // keep last-known state; never blank on disconnect
let lastAnimNonce = 0; // only play strictly-newer triggers (reload/undo never replay)

function render(s) {
  if (!s) return;
  last = s;
  el.awayAbbr.textContent = s.away_abbr || s.away_name;
  el.homeAbbr.textContent = s.home_abbr || s.home_name;
  el.awayRuns.textContent = s.away_runs;
  el.homeRuns.textContent = s.home_runs;
  el.inning.textContent = `${s.half === 'top' ? '▲' : '▼'}${s.inning}`;
  el.balls.textContent = s.balls;
  el.strikes.textContent = s.strikes;
  el.outs.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i < (s.outs | 0)));
  const b = safeBases(s.bases);
  document.getElementById('b1').classList.toggle('on', b.first);
  document.getElementById('b2').classList.toggle('on', b.second);
  document.getElementById('b3').classList.toggle('on', b.third);
  el.bug.dataset.ready = '1';

  // Theme, position, and scale (live).
  document.body.dataset.theme = s.theme || 'nightgame';
  document.body.dataset.pos = s.scorebug_position || 'bottom-bar';
  document.body.style.setProperty('--scale', s.scorebug_scale || 1);

  // Ambient rally state (persistent) + audio settings/pack.
  setRally(s.rally_mode);
  audio.setPack(s.sound_pack);
  audio.setSettings(s.audio);

  // Transient animation trigger: play only if the nonce is strictly newer than
  // the last one we saw. On first paint we just record it (no replay on load),
  // and because nonces are timestamps, an undo restoring an older one won't fire.
  const a = s.current_animation;
  const nonce = a && Number(a.nonce);
  if (nonce) {
    if (lastAnimNonce === 0) lastAnimNonce = nonce;      // first paint: adopt, don't play
    else if (nonce > lastAnimNonce) { lastAnimNonce = nonce; playAnimation(a); audio.play(a.type); }
  }
}

// Audio needs one gesture in a normal browser; OBS browser sources autoplay.
audio.resume();
document.addEventListener('pointerdown', () => { audio.resume(); setTimeout(refreshSoundHint, 60); });
function refreshSoundHint() { const h = document.getElementById('sound-hint'); if (h) h.hidden = !audio.isSuspended(); }
window.setTimeout(refreshSoundHint, 600);
document.getElementById('sound-hint')?.addEventListener('click', () => { Promise.resolve(audio.resume()).then(() => setTimeout(refreshSoundHint, 60)); });

async function fetchState() {
  if (!gameId) return;
  const { data, error } = await db.from('games').select('*').eq('id', gameId).single();
  if (!error && data) render(data);
}

// ---- Realtime with auto-reconnect + exponential backoff -------------------
// Robust against flaky LTE: each attempt uses a UNIQUE channel name (so a not-yet
// removed channel can't collide and throw), callbacks from stale channels are
// ignored, and only one reconnect is ever pending at a time.
let channel = null;
let backoff = 1000;
let reconnectTimer = null;
let subGen = 0;

function teardown() {
  if (channel) { const c = channel; channel = null; supabase.removeChannel(c); }
}

function subscribe() {
  if (!gameId) return;
  teardown();
  const myGen = ++subGen;
  channel = supabase.channel(`overlay:${gameId}:${myGen}`);
  channel
    .on('postgres_changes', { event: 'UPDATE', schema: 'scoreboard', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => render(payload.new))
    .subscribe((status) => {
      if (myGen !== subGen) return; // ignore callbacks from a superseded channel
      if (status === 'SUBSCRIBED') { backoff = 1000; fetchState(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') scheduleReconnect();
    });
}

function scheduleReconnect() {
  if (reconnectTimer) return; // one pending reconnect only
  teardown();
  reconnectTimer = window.setTimeout(() => { reconnectTimer = null; subscribe(); }, backoff);
  backoff = Math.min(backoff * 2, 15000);
}

// Flaky-LTE guards: re-pull fresh state when the network or tab comes back.
addEventListener('online', fetchState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchState(); });

if (!gameId) {
  el.bug.innerHTML = '<div class="err">Add ?game=&lt;id&gt; to the URL</div>';
  el.bug.dataset.ready = '1';
} else {
  fetchState();
  subscribe();
}
