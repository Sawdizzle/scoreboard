// Which of our apps' spots goes up next (the pad's Quick spot / Full spot).
// Pure: the apps list (ads/spots.js) and a store (localStorage) come in, so the
// tests can run it without a browser (scripts/spot-deck.test.mjs).
//
// Each tap deals the next app, then that app's next topic, each from its own
// shuffled deck: everything shows once before any repeats, and a fresh deck
// never opens with what was just shown. The decks live in the store, so they
// carry on across a reload; a store that throws (private browsing) just means
// a fresh deck each time.

export function deal(store, key, ids, rand = Math.random) {
  let deck = [], last = null;
  try {
    deck = JSON.parse(store.getItem(`${key}-deck`) || '[]').filter((id) => ids.includes(id));
    last = store.getItem(`${key}-last`);
  } catch {}
  if (!deck.length) {
    deck = [...ids];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    if (deck.length > 1 && deck[0] === last) deck.push(deck.shift());
  }
  const id = deck.shift();
  try { store.setItem(`${key}-deck`, JSON.stringify(deck)); store.setItem(`${key}-last`, id); } catch {}
  return id;
}

// The next spot: { app, topic }. Deal once, then look the answer up — dealing
// inside a find() would deal again for every item it checks.
export function nextSpot(store, apps, rand = Math.random) {
  const appId = deal(store, 'spot-app', apps.map((a) => a.id), rand);
  const app = apps.find((a) => a.id === appId);
  const topicId = deal(store, `spot-${app.id}`, app.topics.map((t) => t.id), rand);
  return { app, topic: app.topics.find((t) => t.id === topicId) };
}
