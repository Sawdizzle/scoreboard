// A team's monthly AI writes: off, used up, or free to go ahead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiOn, refusal } from '../lib/ai-limit.ts';

const resets = '2026-11-01T05:00:00.000Z'; // November 1, midnight Central

test('no plan, or a limit of 0, is AI off: refused before any call', () => {
  assert.equal(aiOn(null), false);
  assert.deepEqual(refusal(null), { status: 403, error: 'AI writing is off for this team.' });
  assert.deepEqual(refusal({ limit: 0, used: 0, remaining: 0, resets }), { status: 403, error: 'AI writing is off for this team.' });
});

test('a used-up month says how many, which month, and when it resets', () => {
  assert.deepEqual(refusal({ limit: 100, used: 100, remaining: 0, resets }),
    { status: 429, error: 'Your team has used its 100 AI writes for October. They reset November 1.' });
});

test('writes left: go ahead', () => {
  assert.equal(refusal({ limit: 100, used: 4, remaining: 96, resets }), null);
  assert.equal(aiOn({ limit: 100, used: 4, remaining: 96, resets }), true);
});
