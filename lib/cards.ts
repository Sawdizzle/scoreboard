// End-of-season player cards: a short, warm write-up of each player's season
// for their family, from their own numbers. Players are named the way the
// public may see them (their public-name setting under the team's format),
// since cards are made to be shared.
import { z } from 'zod';
import { publicName } from './format.ts';
import { batting, innings, pitching, rate2, rate3, type SeasonLine } from './stats.ts';
import type { NameFormat, Player } from './types.ts';

export const CARDS_MODEL = 'claude-sonnet-5-5';

export const Cards = z.object({
  cards: z.array(z.object({
    key: z.string().describe('The player key from the data, unchanged.'),
    headline: z.string().describe('Five to ten words, the heart of their season.'),
    body: z.string().describe('Three or four sentences: what they did well and one thing they grew in, from their numbers.'),
    highlights: z.array(z.string()).describe('Two or three stat lines from the data, like "11 hits, .367 average".'),
  })),
});
export type Cards = z.infer<typeof Cards>;

export const CARDS_SYSTEM = `You write end-of-season player cards for a youth baseball team, one per player, for their families. The data is JSON: each player's season line with rates already worked out.
- Warm, specific and honest: lead with what each player did well, from their own numbers. Never compare a player unfavorably with a teammate, never mention a weakness as a weakness: say what they grew in or worked at.
- Use only the numbers given, as written. Never invent a game, a play, a quote or a stat.
- Name each player exactly as given ("name"); some are shown only by number.
- A player with very little playing time gets a short, kind card about being part of the team, not about stats.
- One card per player key in the data, in the same order.`;

export type CardPlayer = { key: string; name: string; batting: Record<string, string | number> | null; pitching: Record<string, string | number> | null };

export function cardData(o: { players: Player[]; lines: SeasonLine[]; fmt: NameFormat; gameInnings: number }): CardPlayer[] {
  const line = new Map(o.lines.map((l) => [l.player_id, l]));
  return o.players.filter((p) => p.active || line.has(p.id)).map((p, i) => {
    const l = line.get(p.id);
    const b = l && l.b_pa ? batting(l) : null, pi = l && (l.p_outs || l.p_bf) ? pitching(l, o.gameInnings) : null;
    return {
      key: `p${i + 1}`,
      name: publicName(p, p.public_name, o.fmt),
      batting: l && b ? { G: l.b_g, PA: l.b_pa, H: l.b_h, '2B': l.b_2b, '3B': l.b_3b, HR: l.b_hr, R: l.b_r, RBI: l.b_rbi, BB: l.b_bb, SB: l.b_sb, AVG: rate3(b.avg), OBP: rate3(b.obp) } : null,
      pitching: l && pi ? { G: l.p_g, IP: innings(l.p_outs), SO: l.p_so, BB: l.p_bb, ERA: rate2(pi.era), W: l.p_w } : null,
    };
  });
}

export const cardsPrompt = (season: string, team: string, players: CardPlayer[]) =>
  `Write the ${season} player cards for ${team}.\n\n<players>\n${JSON.stringify(players)}\n</players>`;

// Every player gets exactly one card, and every number a card uses is one of that player's.
export function checkCards(c: Cards, players: CardPlayer[], context: string[] = []): string[] {
  const out: string[] = [];
  // Numbers anyone may use: the season's and team's names ("Fall 2026", "14U").
  const shared = new Set(context.join(' ').match(/\d+/g) ?? []);
  const keys = new Set(players.map((p) => p.key));
  const got = new Set(c.cards.map((x) => x.key));
  for (const k of keys) if (!got.has(k)) out.push(`${players.find((p) => p.key === k)?.name} has no card.`);
  for (const x of c.cards) {
    const p = players.find((q) => q.key === x.key);
    if (!p) { out.push(`A card for an unknown player (${x.key}).`); continue; }
    const mine = new Set([...Object.values({ ...p.batting, ...p.pitching }).map(String), ...(p.name.match(/\d+/g) ?? []), ...shared]);
    // Ordinals ("4th inning") are not stats; the roster's size may be named.
    const said = `${x.headline} ${x.body} ${x.highlights.join(' ')}`.replace(/\b\d+(st|nd|rd|th)\b/gi, '');
    const nums = said.match(/\.\d{3}|\d+\.\d+|\d+/g) ?? [];
    const stray = nums.filter((n) => !mine.has(n) && !(Number(n) <= 3 && !n.includes('.')) && Number(n) !== players.length);
    if (stray.length) out.push(`${p.name}'s card uses ${[...new Set(stray)].join(', ')}, not in their numbers.`);
  }
  return out;
}
