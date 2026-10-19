import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRefield, pitchCounts, playList, type LogEvent, type LogStat } from '../lib/plays.ts';

const E = (id: number, type: string, inning: number, half: 'top' | 'bottom', play?: Record<string, unknown>, field?: Record<string, string>): LogEvent =>
  ({ id, seq: id, type, prev_live: { inning, half }, payload: { ...(play ? { play: { inning, half, ...play } } : {}), ...(field ? { field } : {}) } });

test('pitch counts: by pitcher and inning, strikes being everything not called a ball', () => {
  const events = [E(1, 'ball', 1, 'top'), E(2, 'strike', 1, 'top'), E(3, 'foul', 1, 'top'), E(4, 'play', 1, 'top', { kind: 'GB', code: '6-3', outs: 1 }),
    E(5, 'walk', 2, 'top'), E(6, 'ball', 2, 'bottom')];
  const stats: LogStat[] = [
    { event_id: 1, side: 'us', bid: 'p1', p_pitches: 1 }, { event_id: 2, side: 'us', bid: 'p1', p_pitches: 1 },
    { event_id: 3, side: 'us', bid: 'p1', p_pitches: 1 }, { event_id: 4, side: 'us', bid: 'p1', p_pitches: 1, p_outs: 1, p_bf: 1 },
    { event_id: 5, side: 'us', bid: 'p2', p_pitches: 1 }, { event_id: 6, side: 'them', bid: 'x9', p_pitches: 1 },
  ];
  assert.deepEqual(pitchCounts(events, stats), [
    { side: 'us', bid: 'p1', total: 4, strikes: 3, innings: { 1: 4 } },
    { side: 'us', bid: 'p2', total: 1, strikes: 0, innings: { 2: 1 } },
    { side: 'them', bid: 'x9', total: 1, strikes: 0, innings: { 2: 1 } },
  ]);
});

test('the plays: newest first, each with its batter, runners, pitcher and fielders', () => {
  // Us at home: they bat in the top.
  const bat = (h: 'top' | 'bottom') => (h === 'top' ? 'them' : 'us') as 'us' | 'them';
  const events = [E(1, 'ball', 1, 'top'), E(2, 'play', 1, 'top', { kind: 'GB', code: '6-3', outs: 1 }, { SS: 'a6', '1B': 'a3' }),
    E(3, 'runner', 1, 'top', { kind: 'PO', code: '2-5', outs: 1 })];
  const stats: LogStat[] = [
    { event_id: 2, side: 'them', bid: 'h1', b_pa: 1 }, { event_id: 2, side: 'us', bid: 'a9', p_pitches: 1, p_bf: 1, p_outs: 1 },
    { event_id: 2, side: 'us', bid: 'a6', f_a: 1 }, { event_id: 2, side: 'us', bid: 'a3', f_po: 1 },
    { event_id: 3, side: 'them', bid: 'h2', b_pik: 1 }, { event_id: 3, side: 'us', bid: 'a2', f_a: 1, c_pik: 1 }, { event_id: 3, side: 'us', bid: 'a5', f_po: 1 },
  ];
  const rows = playList(events, stats, bat);
  assert.deepEqual(rows.map((r) => r.text), ['Picked off 2-5', 'Groundout 6-3']);
  assert.deepEqual([rows[1].batter, rows[1].pitcher, rows[1].fielders, rows[1].field], ['h1', 'a9', ['a6', 'a3'], { SS: 'a6', '1B': 'a3' }]);
  assert.deepEqual([rows[0].batter, rows[0].runners, rows[0].fielders], [null, ['h2'], ['a2', 'a5']]);
  assert.equal(canRefield('PO'), true);
  assert.equal(canRefield('H1'), false);
});
