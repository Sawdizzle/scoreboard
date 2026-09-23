// The four sports that are not baseball, each in one place: how a new game
// starts, what the lobby says about it, its pad buttons and Situation rows, how
// it paints, its demo, and its stingers. control.js asks SPORTS[sport] for any
// of these instead of branching on the sport name wherever it needs one.
//
// Baseball is not in here. Its pad is most of control.js — sheets, the field,
// the lineup — and it stays there; every lookup falls back to it.
import * as F from './football.js';
import * as S from './soccer.js';
import * as V from './volleyball.js';
import * as B from './basketball.js';

const coin = () => (Math.random() < 0.5 ? 'home' : 'away');
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ctx is control.js's side of the boundary:
//   $, esc, ordinal, setSitLabel — DOM and text helpers
//   game()                       — the open game (reassigned on every write, so a getter)
//   commit(res), fireAnim(type)  — record a play, fire a stinger
//   commitOrAsk(res, msg)        — commit, or say what is missing when res is null
export function createSports(ctx) {
  const { $, esc, ordinal, setSitLabel, commit, commitOrAsk, fireAnim } = ctx;
  const game = () => ctx.game();
  // One line per button: [id, what it does]. Wired once, at load.
  const wire = (rows) => { for (const [id, run] of rows) $(id).onclick = () => { if (game()) run(game()); }; };
  const NEED_BALL = 'Set possession first — tap Away ball or Home ball';
  const abbr = (g, t) => (t === 'home' ? (g.home_abbr || 'HOME') : (g.away_abbr || 'AWAY'));
  const scores = (g, a, h) => { $(a).textContent = g.away_score | 0; $(h).textContent = g.home_score | 0; };

  const SPORTS = {
    football: {
      init: (from) => F.fbState(from || {}),
      started: (st) => !!(st && st.quarter),
      lobby: (st) => `Q${st.quarter || 1}`,
      timeLabel: 'Quarter length — minutes (0 = none)',
      fx: ['touchdown', 'fieldgoal', 'turnover', 'bigplay', 'charge'],
      bind: () => wire([
        ['fb-poss-away', (g) => commit(F.setPossession(g, 'away'))],
        ['fb-poss-home', (g) => commit(F.setPossession(g, 'home'))],
        ['fb-down-1', (g) => commit(F.setDown(g, 1))],
        ['fb-down-2', (g) => commit(F.setDown(g, 2))],
        ['fb-down-3', (g) => commit(F.setDown(g, 3))],
        ['fb-down-4', (g) => commit(F.setDown(g, 4))],
        ['fb-dist-dn', (g) => commit(F.distanceDelta(g, -1))],
        ['fb-dist-up', (g) => commit(F.distanceDelta(g, 1))],
        ['fb-goal', (g) => commit(F.setGoal(g))],
        ['fb-firstdown', (g) => commit(F.firstDown(g))],
        ['fb-td', (g) => commitOrAsk(F.touchdown(g), NEED_BALL)],
        ['fb-fg', (g) => commitOrAsk(F.fieldGoal(g), NEED_BALL)],
        ['fb-xp', (g) => commitOrAsk(F.extraPoint(g), NEED_BALL)],
        ['fb-2pt', (g) => commitOrAsk(F.twoPoint(g), NEED_BALL)],
        ['fb-safety', (g) => commitOrAsk(F.safety(g), NEED_BALL)],
        ['fb-nextq', (g) => commit(F.nextQuarter(g))],
        ['fb-away-dn', (g) => commit(F.manualScore(g, 'away', -1))],
        ['fb-away-up', (g) => commit(F.manualScore(g, 'away', 1))],
        ['fb-home-dn', (g) => commit(F.manualScore(g, 'home', -1))],
        ['fb-home-up', (g) => commit(F.manualScore(g, 'home', 1))],
        ['fb-to-away', (g) => commit(F.timeout(g, 'away'))],
        ['fb-to-home', (g) => commit(F.timeout(g, 'home'))],
        ['fb-to-reset', (g) => commit(F.resetTimeouts(g))],
        ['fb-to-away-up', (g) => commit(F.adjustTimeouts(g, 'away', 1))],
        ['fb-to-home-up', (g) => commit(F.adjustTimeouts(g, 'home', 1))],
        ['fb-q-dn', (g) => commit(F.adjustQuarter(g, -1))],
        ['fb-q-up', (g) => commit(F.adjustQuarter(g, 1))],
        ['fb-kickoff', (g) => commit(F.kickoff(g))],
        ['fx-turnover', (g) => commit(F.turnover(g))],
        ['fx-bigplay', () => fireAnim('bigplay')],
      ]),
      render(g) {
        const st = F.fbState(g);
        const dd = st.distance === 'goal' ? `${ordinal(st.down)} & Goal` : `${ordinal(st.down)} & ${st.distance}`;
        const poss = st.possession === 'away' ? `◄ ${esc(abbr(g, 'away'))} ball` : st.possession === 'home' ? `${esc(abbr(g, 'home'))} ball ►` : 'no ball set';
        $('sc-mid').innerHTML = `<span class="sc-inning">Q${st.quarter}</span><span class="sc-count">${dd}</span><span class="sc-outs">${poss}</span>`;
        setSitLabel(`Quarter ${st.quarter}, ${dd}` +
          (st.possession ? `, ${st.possession === 'home' ? g.home_name : g.away_name} ball` : ', possession not set'));
        $('fb-dist-val').textContent = st.distance === 'goal' ? 'Goal' : st.distance;
        scores(g, 'fbs-away', 'fbs-home');
        $('fb-q-val').textContent = st.quarter;
        $('fb-to-away-val').textContent = st.away_timeouts; $('fb-to-home-val').textContent = st.home_timeouts;
        $('fb-poss-away').classList.toggle('on', st.possession === 'away');
        $('fb-poss-home').classList.toggle('on', st.possession === 'home');
        for (const d of [1, 2, 3, 4]) $('fb-down-' + d).classList.toggle('on', st.down === d);
      },
      demo(g) {
        // Nothing scores until somebody has the ball, so give it to one of them first.
        if (!F.fbState(g).possession) return commit(F.setPossession(g, coin()));
        const r = Math.random();
        if (r < 0.14) return fireAnim(pick(['touchdown', 'fieldgoal', 'turnover', 'bigplay']));
        if (r < 0.28) return commit(F.touchdown(g));
        if (r < 0.38) return commit(F.fieldGoal(g));
        if (r < 0.54) return commit(F.setDown(g, (F.fbState(g).down % 4) + 1));
        if (r < 0.70) return commit(F.distanceDelta(g, Math.random() < 0.5 ? -3 : 3));
        if (r < 0.82) return commit(F.firstDown(g));
        if (r < 0.93) return commit(F.setPossession(g, coin()));
        return commit(F.nextQuarter(g));
      },
    },

    soccer: {
      init: (from) => S.scState(from || {}),
      started: (st) => !!(st && st.half),
      lobby: (st) => ((st.half || 1) === 1 ? '1st half' : '2nd half'),
      timeLabel: 'Half length — minutes (blank = 45)',
      fx: ['goal', 'charge'],
      bind: () => wire([
        ['sc-goal-away', (g) => commit(S.goal(g, 'away'))],
        ['sc-goal-home', (g) => commit(S.goal(g, 'home'))],
        ['sc-half-1', (g) => commit(S.setHalf(g, 1))],
        ['sc-half-2', (g) => commit(S.setHalf(g, 2))],
        ['sc-stop-dn', (g) => commit(S.stoppageDelta(g, -1))],
        ['sc-stop-up', (g) => commit(S.stoppageDelta(g, 1))],
        ['sc-yc-away', (g) => commit(S.card(g, 'away', 'y'))],
        ['sc-rc-away', (g) => commit(S.card(g, 'away', 'r'))],
        ['sc-yc-home', (g) => commit(S.card(g, 'home', 'y'))],
        ['sc-rc-home', (g) => commit(S.card(g, 'home', 'r'))],
        ['sc-away-dn', (g) => commit(S.manualScore(g, 'away', -1))],
        ['sc-away-up', (g) => commit(S.manualScore(g, 'away', 1))],
        ['sc-home-dn', (g) => commit(S.manualScore(g, 'home', -1))],
        ['sc-home-up', (g) => commit(S.manualScore(g, 'home', 1))],
      ]),
      render(g) {
        const st = S.scState(g);
        $('sc-mid').innerHTML = `<span class="sc-inning">${st.half === 2 ? '2nd' : '1st'} Half</span>` +
          `<span class="sc-count">⚽</span><span class="sc-outs">${st.stoppage ? '+' + st.stoppage : ''}</span>`;
        setSitLabel(`${st.half === 2 ? 'Second' : 'First'} half` + (st.stoppage ? `, plus ${st.stoppage} minutes stoppage` : ''));
        $('sc-stop-val').textContent = '+' + st.stoppage;
        scores(g, 'scs-away', 'scs-home');
        $('sc-half-1').classList.toggle('on', st.half === 1);
        $('sc-half-2').classList.toggle('on', st.half === 2);
      },
      demo(g) {
        const r = Math.random();
        if (r < 0.14) return fireAnim('goal');
        if (r < 0.22) return commit(S.goal(g, coin()));
        if (r < 0.36) return commit(S.card(g, coin(), Math.random() < 0.85 ? 'y' : 'r'));
        if (r < 0.52) return commit(S.stoppageDelta(g, Math.random() < 0.5 ? -1 : 1));
        if (r < 0.58) return commit(S.setHalf(g, S.scState(g).half === 1 ? 2 : 1));
        // otherwise idle; the match clock keeps ticking if running
      },
    },

    volleyball: {
      init: (from) => V.vbState(from || {}),
      started: (st) => !!(st && st.sets),
      lobby: (st) => `Set ${st.set || 1}`,
      timeLabel: 'Time limit — minutes (0 = none)',
      fx: ['ace', 'setwin', 'charge'],
      bind: () => wire([
        ['vb-point-away', (g) => commit(V.point(g, 'away'))],
        ['vb-point-home', (g) => commit(V.point(g, 'home'))],
        ['vb-serve-away', (g) => commit(V.setServe(g, 'away'))],
        ['vb-serve-home', (g) => commit(V.setServe(g, 'home'))],
        ['vb-target', (g) => commit(V.cycleTarget(g))],
        ['vb-endset', (g) => commitOrAsk(V.endSet(g), 'Tied — score the deciding point first')],
        ['vb-set-dn', (g) => commit(V.adjustSet(g, -1))],
        ['vb-set-up', (g) => commit(V.adjustSet(g, 1))],
        ['vb-sets-away-dn', (g) => commit(V.adjustSets(g, 'away', -1))],
        ['vb-sets-away-up', (g) => commit(V.adjustSets(g, 'away', 1))],
        ['vb-sets-home-dn', (g) => commit(V.adjustSets(g, 'home', -1))],
        ['vb-sets-home-up', (g) => commit(V.adjustSets(g, 'home', 1))],
        ['vb-away-dn', (g) => commit(V.manualScore(g, 'away', -1))],
        ['vb-home-dn', (g) => commit(V.manualScore(g, 'home', -1))],
        ['vb-away-up', (g) => commit(V.manualScore(g, 'away', 1))],
        ['vb-home-up', (g) => commit(V.manualScore(g, 'home', 1))],
        ['fx-ace', (g) => commitOrAsk(V.ace(g), 'Set the serving team first')],
      ]),
      render(g) {
        const st = V.vbState(g);
        const serve = st.serve === 'away' ? '◄ serve' : st.serve === 'home' ? 'serve ►' : 'serve: —';
        $('sc-mid').innerHTML = `<span class="sc-inning">SET ${st.set}</span>` +
          `<span class="sc-count">${st.sets.away}–${st.sets.home}</span><span class="sc-outs">${serve}</span>`;
        setSitLabel(`Set ${st.set}, sets ${st.sets.away} to ${st.sets.home}` +
          (st.serve ? `, ${st.serve === 'home' ? g.home_name : g.away_name} serving` : ', server not set'));
        $('vb-set-val').textContent = st.set;
        scores(g, 'vbs-away', 'vbs-home');
        $('vb-sets-away-val').textContent = st.sets.away; $('vb-sets-home-val').textContent = st.sets.home;
        $('vb-target').textContent = 'To ' + st.target;
        $('vb-serve-away').classList.toggle('on', st.serve === 'away');
        $('vb-serve-home').classList.toggle('on', st.serve === 'home');
      },
      demo(g) {
        const r = Math.random();
        if (r < 0.10) { const a = V.ace(g); return a && commit(a); }
        if (r < 0.85) return commit(V.point(g, coin()));
        return commit(V.setServe(g, coin()));
      },
    },

    basketball: {
      init: (from) => B.bkState(from || {}),
      started: (st) => !!(st && st.period),
      lobby: (st) => `Q${st.period || 1}`,
      timeLabel: 'Period length — minutes (0 = none)',
      fx: ['three', 'bigplay', 'charge'],
      bind: () => wire([
        ['bk-away-1', (g) => commit(B.score(g, 'away', 1))],
        ['bk-away-2', (g) => commit(B.score(g, 'away', 2))],
        ['bk-away-3', (g) => commit(B.score(g, 'away', 3))],
        ['bk-home-1', (g) => commit(B.score(g, 'home', 1))],
        ['bk-home-2', (g) => commit(B.score(g, 'home', 2))],
        ['bk-home-3', (g) => commit(B.score(g, 'home', 3))],
        ['bk-away-dn', (g) => commit(B.score(g, 'away', -1))],
        ['bk-home-dn', (g) => commit(B.score(g, 'home', -1))],
        ['bk-period-dn', (g) => commit(B.adjustPeriod(g, -1))],
        ['bk-period-up', (g) => commit(B.adjustPeriod(g, 1))],
        ['bk-nextperiod', (g) => commit(B.nextPeriod(g))],
        ['bk-foul-away', (g) => commit(B.foul(g, 'away', 1))],
        ['bk-foul-away-dn', (g) => commit(B.foul(g, 'away', -1))],
        ['bk-foul-home', (g) => commit(B.foul(g, 'home', 1))],
        ['bk-foul-home-dn', (g) => commit(B.foul(g, 'home', -1))],
        ['bk-to-away', (g) => commit(B.timeout(g, 'away'))],
        ['bk-to-home', (g) => commit(B.timeout(g, 'home'))],
        ['bk-to-reset', (g) => commit(B.resetTimeouts(g))],
        // The sheet's + are corrections: one point or one foul (only +3 has a stinger).
        ['bk-away-up', (g) => commit(B.score(g, 'away', 1))],
        ['bk-home-up', (g) => commit(B.score(g, 'home', 1))],
        ['bk-foul-away-up', (g) => commit(B.foul(g, 'away', 1))],
        ['bk-foul-home-up', (g) => commit(B.foul(g, 'home', 1))],
        ['bk-to-away-up', (g) => commit(B.adjustTimeouts(g, 'away', 1))],
        ['bk-to-home-up', (g) => commit(B.adjustTimeouts(g, 'home', 1))],
        ['fx-bigplay-bk', () => fireAnim('bigplay')],
      ]),
      render(g) {
        const st = B.bkState(g);
        const bonus = [B.bonusOf(st, 'away') && 'AWAY ' + B.bonusOf(st, 'away'), B.bonusOf(st, 'home') && 'HOME ' + B.bonusOf(st, 'home')].filter(Boolean).join(' · ');
        $('sc-mid').innerHTML = `<span class="sc-inning">Q${st.period}</span>` +
          `<span class="sc-count">Fouls ${st.fouls.away}–${st.fouls.home}</span><span class="sc-outs">${bonus}</span>`;
        setSitLabel(`Quarter ${st.period}, fouls ${st.fouls.away} to ${st.fouls.home}` + (bonus ? `, ${bonus}` : ''));
        $('bk-period-val').textContent = st.period;
        scores(g, 'bks-away', 'bks-home');
        $('bk-foul-away-val').textContent = st.fouls.away; $('bk-foul-home-val').textContent = st.fouls.home;
        $('bk-to-away-val').textContent = st.timeouts.away; $('bk-to-home-val').textContent = st.timeouts.home;
      },
      demo(g) {
        const r = Math.random();
        if (r < 0.45) return commit(B.score(g, coin(), 2));
        if (r < 0.62) return commit(B.score(g, coin(), 3));
        if (r < 0.74) return commit(B.score(g, coin(), 1));
        if (r < 0.92) return commit(B.foul(g, coin(), 1));
        return commit(B.timeout(g, coin()));
      },
    },
  };
  for (const sp of Object.values(SPORTS)) sp.bind();
  return SPORTS;
}
