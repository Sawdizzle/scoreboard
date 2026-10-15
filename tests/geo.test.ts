import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionsUrl, fallbackQuery, tournamentUrl } from '../lib/geo.ts';
import { skyOf } from '../lib/forecast.ts';

test('a tournament link is a web address, made https', () => {
  assert.equal(tournamentUrl(''), null);
  assert.equal(tournamentUrl('playtgs.com/events/123'), 'https://playtgs.com/events/123');
  assert.equal(tournamentUrl('http://usssa.com/x'), 'https://usssa.com/x');
  assert.equal(tournamentUrl('https://www.perfectgame.org/Events/Default.aspx?event=1'), 'https://www.perfectgame.org/Events/Default.aspx?event=1');
  assert.equal(tournamentUrl('see the bracket'), false);
  assert.equal(tournamentUrl('javascript:alert(1)'), false);
});

test('an address the street lookup misses falls back to its ZIP, else its town', () => {
  assert.equal(fallbackQuery('2600 Railyard Rd, Aubrey, TX 76227'), '76227');
  assert.equal(fallbackQuery('Railyard Park, Aubrey, TX'), 'Aubrey TX');
  assert.equal(fallbackQuery('76266'), '76266');
});

test('directions go to the address as typed', () => {
  assert.equal(directionsUrl('2600 Railyard Rd, Aubrey'), 'https://www.google.com/maps/search/?api=1&query=2600%20Railyard%20Rd%2C%20Aubrey');
});

test('weather codes become a sky to draw', () => {
  assert.equal(skyOf(0).sky, 'clear');
  assert.equal(skyOf(2).sky, 'partly');
  assert.equal(skyOf(63).sky, 'rain');
  assert.equal(skyOf(95).sky, 'storm');
  assert.equal(skyOf(73).sky, 'snow');
});
