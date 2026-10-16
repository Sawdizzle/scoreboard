// Spanish recaps: every number and hashtag must come through unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecapContent } from '../lib/recap.ts';
import { checkTranslation } from '../lib/translate.ts';

const en: RecapContent = {
  headline: 'Blue Steel beat Krum 10-2', recap: 'Four runs in the 1st.\n\nA single drove in three in the 3rd.',
  social: { instagram: 'Big win! #BlueSteel #14u', facebook: 'We won 10-2.', x: 'Final 10-2 #BlueSteel' },
  website_post: { title: 'Steel 10, Krum 2', body_markdown: '| | 1 | 2 |\n|-|-|-|' }, player_of_the_game: { name_or_number: '#7', reason: '2 hits' },
};
const es: RecapContent = {
  headline: 'Blue Steel vence a Krum 10-2', recap: 'Cuatro carreras en la 1st.\n\nUn sencillo impulsó tres en la 3rd.',
  social: { instagram: '¡Gran victoria! #BlueSteel #14u', facebook: 'Ganamos 10-2.', x: 'Final 10-2 #BlueSteel' },
  website_post: { title: 'Steel 10, Krum 2', body_markdown: '| | 1 | 2 |\n|-|-|-|' }, player_of_the_game: { name_or_number: '#7', reason: '2 hits' },
};

test('a faithful translation passes', () => {
  assert.deepEqual(checkTranslation(en, es), []);
});

test('Spanish separators and number marks are the same numbers', () => {
  const es2 = { ...es, headline: 'Blue Steel vence a Krum 10–2', player_of_the_game: { name_or_number: 'N.º 7', reason: '2 hits' } };
  const en2 = { ...en, player_of_the_game: { name_or_number: 'No. 7', reason: '2 hits' } };
  assert.deepEqual(checkTranslation(en2, es2), []);
  assert.deepEqual(checkTranslation({ ...en, recap: 'ERA 2.50.\n\nWon.' }, { ...es, recap: 'ERA 2,50.\n\nGanamos.' }), []);
});

test('a changed score, a dropped hashtag, an empty field, a renamed player: all caught', () => {
  const bad = { ...es, headline: 'Blue Steel vence a Krum 10-3', social: { ...es.social, instagram: '¡Gran victoria! #BlueSteel', facebook: '' }, player_of_the_game: { name_or_number: 'Número 7', reason: '2 hits' } };
  assert.deepEqual(checkTranslation(en, bad), [
    'The headline lost or changed a number (10-2 → 10-3).',
    'The instagram changed its hashtags.',
    'The facebook lost or changed a number (10-2 → none).',
    'The facebook came back empty.',
    'The player of the game must keep their name as written.',
  ]);
});
