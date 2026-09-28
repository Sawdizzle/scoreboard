// Dealing our apps' spots — js/spot-deck.js.
//
// v4.37 shipped with the deal inside a find(): it dealt again for every app it
// checked, usually matched nothing, and the pad's Quick spot / Full spot threw
// before anything was sent. These run the whole path a tap takes.
//
// Run: node --test scripts/spot-deck.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load-module.mjs';

const { deal, nextSpot } = await loadModule('js/spot-deck.js');

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const broken = { getItem() { throw new Error('no storage'); }, setItem() { throw new Error('no storage'); } };
const topics = (n, p) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, label: `${p} ${i}` }));
const APPS = [{ id: 'rtp', name: 'Run the Play', topics: topics(6, 'r') }, { id: 'ybt', name: 'Baseball Time', topics: topics(4, 'y') }];

test('every tap gets a real app and topic', () => {
  const store = memory();
  for (let i = 0; i < 300; i++) {
    const { app, topic } = nextSpot(store, APPS);
    assert.ok(app && APPS.includes(app), `tap ${i}: app`);
    assert.ok(topic && app.topics.includes(topic), `tap ${i}: topic`);
  }
});

test('apps take turns, and each app shows every topic before repeating one', () => {
  const store = memory(), seen = { rtp: [], ybt: [] };
  let prev = null;
  for (let i = 0; i < 240; i++) {
    const { app, topic } = nextSpot(store, APPS);
    assert.notEqual(app.id, prev, `tap ${i}: same app twice`);
    prev = app.id;
    seen[app.id].push(topic.id);
  }
  for (const app of APPS) {
    const ids = seen[app.id], n = app.topics.length;
    for (let i = 0; i + n <= ids.length; i += n) assert.equal(new Set(ids.slice(i, i + n)).size, n, `${app.id} deck ${i / n}`);
    for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1], `${app.id}: same topic twice`);
  }
});

test('a store that throws still deals', () => {
  for (let i = 0; i < 50; i++) {
    const { app, topic } = nextSpot(broken, APPS);
    assert.ok(app && topic);
  }
});

test('a topic dropped from the list is never dealt from an old deck', () => {
  const store = memory();
  store.setItem('spot-rtp-deck', JSON.stringify(['gone', 'r1']));
  assert.equal(deal(store, 'spot-rtp', APPS[0].topics.map((t) => t.id)), 'r1');
});

test('a single app still works', () => {
  const store = memory();
  for (let i = 0; i < 20; i++) assert.equal(nextSpot(store, [APPS[1]]).app.id, 'ybt');
});
