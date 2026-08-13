import { supabase, db } from './supabase.js';
import { safeBases } from './logic.js';
import { playAnimation, setRally } from './anim.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('game');
if (params.get('debug')) document.body.classList.add('debug');

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

  // Ambient rally state (persistent).
  setRally(s.rally_mode);

  // Transient animation trigger: play only if the nonce is strictly newer than
  // the last one we saw. On first paint we just record it (no replay on load),
  // and because nonces are timestamps, an undo restoring an older one won't fire.
  const a = s.current_animation;
  const nonce = a && Number(a.nonce);
  if (nonce) {
    if (lastAnimNonce === 0) lastAnimNonce = nonce;      // first paint: adopt, don't play
    else if (nonce > lastAnimNonce) { lastAnimNonce = nonce; playAnimation(a); }
  }
}

async function fetchState() {
  if (!gameId) return;
  const { data, error } = await db.from('games').select('*').eq('id', gameId).single();
  if (!error && data) render(data);
}

// ---- Realtime with auto-reconnect + exponential backoff -------------------
let channel = null;
let backoff = 1000;

function subscribe() {
  if (!gameId) return;
  channel = supabase.channel(`overlay:${gameId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'scoreboard', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => render(payload.new))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { backoff = 1000; fetchState(); }
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) reconnect();
    });
}
function reconnect() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
  setTimeout(subscribe, backoff);
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
