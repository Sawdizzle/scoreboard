// OBS, driven from the pad: the device switch that hides it, the permission
// tier the overlay reports, stream/record/buffer, scene cuts and replay clips.
// The pad has no window.obsstudio; every command is a nonce stamped on the
// games row, and the overlay browser source (which is inside OBS) carries it
// out and reports back on the same row.
//
// ctx is control.js's side: $, db, game() (a getter — the open game is
// replaced on every write), haptic, nextNonce, showToast, openSheet,
// closeSheet, writeField.
export function createObs(ctx) {
  const { $, db, haptic, nextNonce, showToast, openSheet, closeSheet, writeField } = ctx;
  const game = () => ctx.game();

  // ---- Show/hide the OBS controls ------------------------------------------
  // Plenty of people want the scorebug and nothing else — a browser source in
  // other software, or a scoreboard on a TV. Clip, Cameras and Stream & record
  // are dead weight for them, so the whole group slides away. A device
  // preference, not a game one: the same game may be run from an OBS laptop and a
  // phone that has never seen OBS.
  const OBS_UI = 'sb:obsUi';
  function applyObsUi(on) {
    document.body.classList.toggle('no-obs', !on);
    const box = $('obs-ui');
    if (box) box.checked = on;
  }
  $('obs-ui').onchange = (e) => {
    applyObsUi(e.target.checked);
    try { localStorage.setItem(OBS_UI, e.target.checked ? '1' : '0'); } catch {}
    showToast(e.target.checked ? '🎛️ OBS controls shown' : '🎛️ OBS controls hidden');
  };
  try { applyObsUi(localStorage.getItem(OBS_UI) !== '0'); } catch { applyObsUi(true); }

  // ---- OBS permission tiers -------------------------------------------------
  // The overlay's page permissions decide how much of OBS the pad may drive. Every
  // tier is a legitimate way to run the app: at "no access" the scorebug, cards,
  // takeovers, moments and sound all work exactly the same — that's the whole
  // product for most people. So a feature you haven't unlocked reads as muted
  // information, never as a warning; amber is kept for things that are actually
  // misconfigured, like a replay buffer that isn't running.
  const OBS_TIER = { 3: 'Basic', 4: 'Advanced', 5: 'Full' };
  // Any of the three reporters carries the level; take the freshest one we have.
  function obsLevel() {
    if (!game()) return null;
    const src = [game().obs_status, game().obs_scenes, game().replay_ack]
      .filter((o) => o && typeof o.level === 'number')
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
    return src ? src.level | 0 : null;
  }
  // The one sentence explaining why a locked feature is locked.
  function needNote(need) {
    const lvl = obsLevel();
    if (lvl === null) return { tone: 'off', text: 'Open the overlay in OBS to use this.' };
    return { tone: 'off', text: `Needs Page permissions “${OBS_TIER[need]} access to OBS” on the overlay source — you're on “${OBS_TIER[lvl] || 'No access'}”. Everything else keeps working.` };
  }
  // The OBS tab leads with the tier it is actually running at, so a disabled
  // control reads as "not unlocked" rather than "broken".
  function renderObsTier() {
    const lvl = obsLevel();
    $('obs-tier').textContent = lvl === null ? 'Not connected' : (OBS_TIER[lvl] || 'No access');
  }
  $('obs-tier-help').onclick = () => {
    const n = $('obs-tier-note');
    n.textContent = obsLevel() === null
      ? 'Add the overlay to OBS as a Browser Source and open it — the pad reads its permission level from there. No access runs the scorebug, cards, moments and sound; Basic adds replay clips; Advanced adds camera switching and the replay buffer; Full adds going live and recording.'
      : 'Set it on the Browser Source: Page permissions → No access runs the scorebug, cards, moments and sound; Basic adds replay clips; Advanced adds camera switching and the replay buffer; Full adds going live and recording. Everything below your level keeps working.';
    n.hidden = !n.hidden;
  };

  // ---- OBS stream / record / replay buffer ----------------------------------
  // Ending a stream from a phone in your pocket has to be hard to do by accident,
  // but a modal would freeze the pad mid-broadcast (the same reason commit() never
  // alerts). So stopping arms on the first tap and fires on the second, and the
  // arm expires on its own.
  const OBS_BTN = {
    stream: { el: 'obs-stream', need: 5, on: 'streaming', start: 'stream_start', stop: 'stream_stop',
              idle: '🔴 Go Live', live: '⏹ End Stream', arm: 'Tap again to end', danger: true },
    record: { el: 'obs-record', need: 5, on: 'recording', start: 'record_start', stop: 'record_stop',
              idle: '⏺ Record', live: '⏹ Stop Rec', arm: 'Tap again to stop', danger: true },
    buffer: { el: 'obs-buffer', need: 4, on: 'buffer', start: 'buffer_start', stop: 'buffer_stop',
              idle: '🎞️ Buffer On', live: '🎞️ Buffer Off', arm: null, danger: false },
  };
  let obsArmed = null;      // key of the button waiting for its second tap
  let obsArmTimer = null;
  let obsWaiting = null;    // {key, at} — command sent, watching for OBS to actually change
  let obsNote = null;

  function disarmObs() { obsArmed = null; clearTimeout(obsArmTimer); obsArmTimer = null; }

  async function sendObsCmd(action) {
    if (!game()) return;
    const obs_cmd = { nonce: nextNonce(), action };
    const { error } = await db.from('games').update({ obs_cmd }).eq('id', game().id);
    if (error) { obsWaiting = null; obsNote = `⚠️ ${error.message}`; renderObs(); }
  }
  function tapObs(key) {
    const cfg = OBS_BTN[key], st = (game() && game().obs_status) || {};
    if (!game() || (st.level | 0) < cfg.need) return;
    haptic();
    const running = !!st[cfg.on];
    if (running && cfg.arm && obsArmed !== key) { // first tap on a stop: arm only
      disarmObs();
      obsArmed = key;
      obsArmTimer = setTimeout(() => { disarmObs(); renderObs(); }, 5000);
      return renderObs();
    }
    disarmObs();
    obsWaiting = { key, at: Date.now() };
    obsNote = null;
    renderObs();
    setTimeout(() => { if (obsWaiting && obsWaiting.key === key) { obsWaiting = null; obsNote = '⚠️ OBS didn\'t respond.'; renderObs(); } }, 8000);
    sendObsCmd(running ? cfg.stop : cfg.start);
  }
  for (const key of Object.keys(OBS_BTN)) $(OBS_BTN[key].el).onclick = () => tapObs(key);

  let lastObsStatusAt = null;
  function renderObs() {
    renderObsTier();
    if (!game()) return;
    const st = game().obs_status || {};
    const level = st.level | 0;
    // A fresh report from OBS is the answer to whatever we sent.
    if (st.at && st.at !== lastObsStatusAt) { lastObsStatusAt = st.at; obsWaiting = null; obsNote = null; }
    for (const [key, cfg] of Object.entries(OBS_BTN)) {
      const b = $(cfg.el); if (!b) continue;
      const running = !!st[cfg.on];
      b.disabled = !game().obs_status || level < cfg.need;
      b.textContent = obsArmed === key ? cfg.arm : obsWaiting && obsWaiting.key === key ? '…' : running ? cfg.live : cfg.idle;
      b.classList.toggle('on', running && !cfg.danger);
      b.classList.toggle('live', running && cfg.danger);
      b.classList.toggle('armed', obsArmed === key);
    }
    const hint = $('obs-hint'); if (!hint) return;
    if (obsNote) { hint.dataset.tone = 'warn'; hint.textContent = obsNote; return; }
    if (level < 5) {
      const note = needNote(5);
      hint.dataset.tone = note.tone;
      hint.textContent = level >= 4 ? `Replay buffer only. ${note.text}` : note.text;
      return;
    }
    const bits = [st.streaming ? 'live' : 'off air', st.recording ? (st.paused ? 'recording paused' : 'recording') : null,
                  st.buffer ? 'buffer on' : 'buffer off'].filter(Boolean);
    hint.dataset.tone = st.streaming ? 'ok' : 'off';
    hint.textContent = `OBS: ${bits.join(' · ')}`;
  }

  // ---- OBS scenes (camera switching) ----------------------------------------
  // One scene per camera in OBS, the scorebug source shared into each; tapping a
  // name cuts to it through whatever transition OBS is set to. The list is
  // whatever the overlay reports seeing, so it can't drift from reality.
  async function switchScene(name) {
    if (!game()) return;
    haptic();
    const scene_cmd = { nonce: nextNonce(), name };
    const { error } = await db.from('games').update({ scene_cmd }).eq('id', game().id);
    if (error) showToast(`⚠️ ${error.message}`, 3000);
  }
  function renderScenes() {
    if (!game()) return;
    const obs = game().obs_scenes;
    const names = (obs && Array.isArray(obs.list) ? obs.list : []).filter((n) => typeof n === 'string');
    const level = obs ? obs.level | 0 : -1;
    for (const [l, h] of [[$('cam-list'), $('cam-hint')]]) {
      l.innerHTML = '';
      for (const name of names) {
        const b = document.createElement('button');
        b.className = 'fxbtn scene' + (name === obs.current ? ' on' : '');
        b.textContent = name;
        b.onclick = () => switchScene(name);
        b.disabled = level < 4;
        l.appendChild(b);
      }
      if (level < 4) {
        const note = needNote(4);
        h.dataset.tone = note.tone; h.textContent = note.text;
      } else if (!names.length) {
        h.dataset.tone = 'off'; h.textContent = 'OBS reported no scenes.';
      } else {
        h.dataset.tone = 'ok'; h.textContent = `On air: ${obs.current || '—'}`;
      }
    }
    // Only a door worth having once OBS has told us what there is to cut to.
    $('cam-open').hidden = !names.length;
  }
  $('cam-open').onclick = () => openSheet('cam-sheet');
  $('cam-done').onclick = () => closeSheet('cam-sheet');

  // ---- OBS replay buffer ----------------------------------------------------
  // This pad has no window.obsstudio, so we can't clip directly: we stamp a nonce
  // and the overlay browser source (which IS inside OBS) calls saveReplayBuffer()
  // and acks back. Everything shown here comes from that ack — including whether
  // the buffer is even running, which is the thing you want to know before first
  // pitch rather than after the play.
  const REPLAY_FAIL = {
    noperm: { tone: 'off', text: 'Clips need Page permissions “Basic access to OBS” on the overlay source.' },
    nobuffer: { tone: 'bad', text: '⚠️ Replay buffer isn’t running in OBS.' },
    failed: { tone: 'bad', text: '⚠️ OBS refused the clip.' },
    noconfirm: { tone: 'warn', text: '🎞️ Sent, but OBS didn’t confirm — check your replay folder.' },
  };
  // The buffer is retroactive: saving captures the N seconds BEFORE the save, and
  // nothing after. So a home run clip taken at the swing ends while he's rounding
  // second. We wait out the trot and the celebration, then save — the buffer
  // reaches back and picks up the pitch. Needs an OBS buffer at least
  // delay + ~20s (90s covers everything here).
  const CLIP_DELAY_MS = {
    homerun: 40000,     // trot plus the mob at the plate
    walkoff: 60000,     // dogpiles run long
    touchdown: 30000,
    goal: 30000,
    doubleplay: 10000,  // the play is already over
    bigplay: 12000,
  };

  let replayPending = new Map(); // nonce -> {deadline, timer} for clips in flight
  let replayNote = null;         // {tone, text} verdict from the last clip
  let replayTick = null;
  let lastHelloAt = null;        // 'at' of the last status report we folded in

  const soonestDeadline = () => Math.min(...[...replayPending.values()].map((p) => p.deadline));

  async function saveReplay(auto = false, delayMs = 0) {
    if (!game()) return;
    if (!auto) haptic();
    const replay_cmd = { nonce: nextNonce(), at: new Date().toISOString(), auto, delay_ms: delayMs };
    // The overlay answers late by design, so allow delay + slack before giving up.
    replayPending.set(replay_cmd.nonce, {
      deadline: Date.now() + delayMs,
      timer: setTimeout(() => {
        if (!replayPending.delete(replay_cmd.nonce)) return;
        replayNote = { tone: 'bad', text: '⚠️ No answer from the overlay — is the browser source loaded in OBS?' };
        renderReplay();
      }, delayMs + 10000),
    });
    renderReplay();
    const { error } = await db.from('games').update({ replay_cmd }).eq('id', game().id);
    if (error) {
      dropPending(replay_cmd.nonce);
      replayNote = { tone: 'bad', text: `⚠️ ${error.message}` };
      return renderReplay();
    }
    if (delayMs) showToast(`🎞️ Clip in ${Math.round(delayMs / 1000)}s`, 2200);
  }
  function dropPending(nonce) {
    const p = replayPending.get(nonce);
    if (p) { clearTimeout(p.timer); replayPending.delete(nonce); }
  }
  // Tapping the button while a delayed clip is waiting means "don't wait, take it
  // now" — the overlay fires everything it has scheduled instead of queuing more.
  async function flushReplay() {
    const replay_cmd = { nonce: nextNonce(), at: new Date().toISOString(), flush: true };
    const { error } = await db.from('games').update({ replay_cmd }).eq('id', game().id);
    if (error) showToast(`⚠️ ${error.message}`, 3000);
  }
  $('fx-replay').onclick = () => {
    if (!game()) return;
    haptic();
    if (replayPending.size && soonestDeadline() > Date.now()) return flushReplay();
    saveReplay(false, 0);
  };

  // Auto-clip: opt-in per game, so a big play lands on disk while both your thumbs
  // are still on the scoring pad.
  $('replay-auto').onchange = async (e) => {
    const auto_clip = e.target.checked;
    await writeField({ auto_clip });   // queued: no need to roll back on a blip
    showToast(auto_clip ? '🎞️ Auto-clip on for big plays' : 'Auto-clip off');
  };

  function renderReplay() {
    const b = $('fx-replay'); if (!b) return;
    const ack = game() && game().replay_ack;
    const nonce = ack && Number(ack.nonce);
    if (ack && replayPending.has(nonce)) {
      if (ack.code === 'armed') {
        // Not an outcome — the overlay is holding it. Keep waiting, keep counting.
      } else {
        dropPending(nonce);
        replayNote = ack.ok
          ? { tone: 'ok', text: '🎞️ Clip saved to your replay folder.' }
          : (REPLAY_FAIL[ack.code] || { tone: 'bad', text: '⚠️ Clip failed.' });
        showToast(ack.ok ? '🎞️ Clip saved' : replayNote.text, ack.ok ? 1600 : 4000);
        // Successes fade back to the live status line; anything else stays put,
        // since it's the only place you'd read what to go fix in OBS.
        if (ack.ok) setTimeout(() => { if (replayNote && replayNote.tone === 'ok') { replayNote = null; renderReplay(); } }, 12000);
      }
    }
    // A fresh status report (overlay reloaded, or the buffer started/stopped)
    // clears a stale verdict so the line reflects OBS as it is right now.
    if (ack && ack.code === 'hello' && ack.at !== lastHelloAt) { lastHelloAt = ack.at; replayNote = null; }

    const waiting = replayPending.size ? Math.round((soonestDeadline() - Date.now()) / 1000) : 0;
    // Short enough for a quarter of the bottom bar on a 375pt phone.
    b.innerHTML = '<i aria-hidden="true">🎞️</i>' + (!replayPending.size ? 'Replay' : waiting > 0 ? `${waiting}s` : 'Saving…');
    b.classList.toggle('busy', !!replayPending.size);
    const auto = $('replay-auto');
    if (auto) auto.checked = !!(game() && game().auto_clip);
    // A 1Hz tick only while something is in flight — the pad idles the rest of the game.
    if (replayPending.size && !replayTick) replayTick = setInterval(renderReplay, 1000);
    if (!replayPending.size && replayTick) { clearInterval(replayTick); replayTick = null; }

    const hint = $('replay-hint');
    if (!hint) return;
    const note = replayPending.size
      ? (waiting > 0 ? { tone: 'ok', text: 'Waiting out the celebration — tap Clip to take it now.' } : null)
      : (replayNote || replayStatus(ack));
    hint.hidden = !note;
    if (note) { hint.textContent = note.text; hint.dataset.tone = note.tone; }
  }
  // Idle line: what the overlay last told us about itself.
  function replayStatus(ack) {
    if (!ack) return { tone: 'off', text: 'Open the overlay in OBS to enable clips.' };
    if (!ack.ok && ack.code === 'hello') return REPLAY_FAIL.noperm;
    if (ack.buffering === false) return REPLAY_FAIL.nobuffer;
    return { tone: 'ok', text: '🎞️ OBS link ready.' };
  }
  function resetReplayUi() {
    for (const nonce of [...replayPending.keys()]) dropPending(nonce);
    replayNote = null; lastHelloAt = null;
    if (replayTick) { clearInterval(replayTick); replayTick = null; }
  }

  return { OBS_TIER, CLIP_DELAY_MS, obsLevel, renderObs, renderScenes, renderReplay, resetReplayUi, disarmObs, saveReplay };
}
