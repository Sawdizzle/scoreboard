// Reading a lineup from a photo: a lineup card, a scorebook page, a phone
// screenshot. Claude reads it into rows; the rows become the same lines the
// paste box takes ("7 Ava Reyes SS"), so the scorer sees and fixes them before
// anything is added, and lib/roster-parse does the rest as it always has.
import { z } from 'zod';

export const LINEUP_MODEL = 'claude-sonnet-5-5';
const POS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'EH', 'UT'];

export const LineupRead = z.object({
  players: z.array(z.object({
    number: z.string().describe('Jersey number exactly as written, digits only; empty if none.'),
    name: z.string().describe('The name as written; empty if only a number is given.'),
    position: z.string().describe(`One of ${POS.join(', ')}, or empty.`),
  })).describe('In batting order, top to bottom.'),
  unsure: z.array(z.string()).describe('Anything that could not be read for certain, in a few words each ("#2 name smudged").'),
});
export type LineupRead = z.infer<typeof LineupRead>;

export const LINEUP_SYSTEM = `You read youth baseball and softball lineups from photos: a lineup card, a dugout sheet, a scorebook page or a screenshot.
- List the batters in batting order, top to bottom. Substitutes and the bench only if they are in the order.
- Copy jersey numbers and names exactly as written. Never guess a name you cannot read: leave it empty and say so in "unsure".
- Positions as scorebook codes (P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH, EH). A number 1-9 in a position column is that position (1 = P, 6 = SS, 8 = CF).
- If the photo is not a lineup, return no players and say what it shows in "unsure".`;

export const lineupPrompt = (side: 'us' | 'them', team: string) =>
  `Read the batting order for ${team} (${side === 'us' ? 'our team' : 'the other team'}) from this photo.`;

const NUM_NAMES: Record<string, string> = { '1': 'P', '2': 'C', '3': '1B', '4': '2B', '5': '3B', '6': 'SS', '7': 'LF', '8': 'CF', '9': 'RF' };

// The rows as paste-box lines, cleaned: digits-only numbers, known positions.
export function lineupLines(r: LineupRead): string[] {
  return r.players.map((p) => {
    const num = (p.number.match(/\d{1,3}/) ?? [''])[0];
    const name = p.name.replace(/\s+/g, ' ').replace(/^[#\d.\s-]+(?=\D)/, '').trim();
    const raw = p.position.trim().toUpperCase();
    const pos = POS.includes(raw) ? raw : NUM_NAMES[raw] ?? '';
    return [num, name, pos === 'EH' || pos === 'UT' ? '' : pos].filter(Boolean).join(' ');
  }).filter(Boolean);
}

export function checkLineup(r: LineupRead): string[] {
  if (!r.players.length) return [];
  const nums = r.players.map((p) => p.number.trim()).filter(Boolean);
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
  return [
    ...(dup.length ? [`Number ${[...new Set(dup)].join(', ')} appears twice: check the photo.`] : []),
    ...(r.players.length > 15 ? ['More than 15 batters: the bench may have been read in.'] : []),
  ];
}
