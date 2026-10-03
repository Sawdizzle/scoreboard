// The quiz plays the Run the Play spot rotates through (ads/runtheplay.html),
// shared with the pad (js/control.js), which picks the next one on each tap.
//
// Every number here comes out of Run the Play's own engine (computePlay in the
// RunThePlay repo, baseball), exported 2026-09-28, so the spot teaches exactly
// what the app teaches. Points are the app's 800x800 field space: home plate at
// (400, 740), 1st (590, 550), 2nd (400, 360), 3rd (210, 550).
//
//   kind     how the ball travels: 'fly' (a hit through the air), 'ground', 'bunt'
//   bases    runners on [1st, 2nd, 3rd] before the pitch
//   focus    the position the question is about; second = the other callout
//   jobs     where each fielder ends up
//   throws   [from, to, fromPoint, toPoint], in order
//   runners  [runner, fromBase, toBase, outcome]; base 0 is home, so 2 -> 0 scores
//   why      the answer's reason, for the full cut (<b> marks the key words)
//   whyShort the same, short enough for the quick cut's top line

export const RTP_PLAYS = [
  {
    id: 'single-left', label: 'Single to left, runner on 2nd',
    kind: 'fly', hit: 'Single to <b>left</b>', bases: [false, true, false], outs: 1,
    land: [140, 230],
    focus: 'SS', answer: 'Covers 3rd.', second: ['3B', 'Cutoff'],
    why: 'The 3rd baseman charges in to be the <b>cutoff</b>, so the shortstop takes the bag.',
    whyShort: 'The 3B charges in to be the <b>cutoff</b>',
    jobs: { P: [418, 776], C: [400, 702], '1B': [552, 550], '2B': [400, 398], '3B': [339, 621], SS: [248, 550], LF: [140, 230], CF: [152, 185], RF: [400, 288] },
    throws: [['LF', '3B', [140, 230], [339, 621]], ['3B', 'C', [339, 621], [400, 702]]],
    runners: [['R2', 2, 0, 'scores'], ['B', 0, 1, 'safe']],
  },
  {
    id: 'single-center', label: 'Single to center, runner on 2nd',
    kind: 'fly', hit: 'Single to <b>center</b>', bases: [false, true, false], outs: 1,
    land: [400, 130],
    focus: '1B', answer: 'Is the cutoff.', second: ['C', 'Covers home'],
    why: 'On a throw home from center, the first baseman lines up about <b>45 feet in front of the plate</b> and listens for the catcher\'s call.',
    whyShort: 'Lines up <b>45 feet</b> in front of home',
    jobs: { P: [400, 780], C: [400, 702], '1B': [400, 606], '2B': [552, 550], '3B': [248, 550], SS: [400, 398], LF: [360, 80], CF: [400, 130], RF: [440, 80] },
    throws: [['CF', '1B', [400, 130], [400, 606]], ['1B', 'C', [400, 606], [400, 702]]],
    runners: [['R2', 2, 0, 'scores'], ['B', 0, 1, 'safe']],
  },
  {
    id: 'single-right', label: 'Single to right, runner on 1st',
    kind: 'fly', hit: 'Single to <b>right</b>', bases: [true, false, false], outs: 0,
    land: [660, 230],
    focus: 'P', answer: 'Backs up 3rd.', second: ['SS', 'Cutoff'],
    why: 'First to third means the long throw goes to 3rd, so the pitcher sprints behind the bag, <b>in line with the throw</b>.',
    whyShort: 'Behind 3rd, <b>in line with the throw</b>',
    jobs: { P: [163, 578], C: [400, 702], '1B': [552, 550], '2B': [400, 398], '3B': [248, 550], SS: [372, 454], LF: [115, 606], CF: [648, 185], RF: [660, 230] },
    throws: [['RF', 'SS', [660, 230], [372, 454]], ['SS', '3B', [372, 454], [248, 550]]],
    runners: [['R1', 1, 3, 'safe'], ['B', 0, 1, 'safe']],
  },
  {
    id: 'bunt-1b', label: 'Bunt down the 1st-base line, runner on 1st',
    kind: 'bunt', hit: 'Bunt down <b>1st</b>', bases: [true, false, false], outs: 0,
    land: [460, 665],
    focus: '2B', answer: 'Covers 1st.', second: ['1B', 'Fields it'],
    why: 'The first baseman charges the bunt, so the second baseman <b>sprints to cover 1st</b> for the sure out.',
    whyShort: 'The <b>1B charges</b> in on the bunt',
    jobs: { P: [400, 615], C: [627, 517], '1B': [460, 665], '2B': [552, 550], '3B': [248, 550], SS: [400, 398], LF: [178, 550], CF: [400, 288], RF: [672, 477] },
    throws: [['1B', '2B', [460, 665], [552, 550]]],
    runners: [['R1', 1, 2, 'safe'], ['B', 0, 1, 'out']],
  },
  {
    id: 'gb-1b', label: 'Ground ball to 1st, bases empty',
    kind: 'ground', hit: 'Grounder to <b>1st</b>', bases: [false, false, false], outs: 1,
    land: [550, 505],
    focus: 'C', answer: 'Backs up 1st.', second: ['P', 'Covers 1st'],
    why: 'Nobody on 2nd or 3rd, so the catcher sprints down the <b>1st-base line</b> to back up the throw.',
    whyShort: 'Nobody on, so he <b>backs up the throw</b>',
    jobs: { P: [552, 550], C: [623, 587], '1B': [550, 505], '2B': [511, 480], '3B': [248, 550], SS: [400, 398], LF: [178, 550], CF: [400, 288], RF: [663, 632] },
    throws: [['1B', 'P', [550, 505], [552, 550]]],
    runners: [['B', 0, 1, 'out']],
  },
  {
    id: 'gap-lc', label: 'Double to the left-center gap',
    kind: 'gap', hit: 'Double, <b>left-center</b>', bases: [false, false, false], outs: 0,
    land: [260, 150],
    focus: '2B', answer: 'Trails the relay.', second: ['SS', 'Relay'],
    why: 'The shortstop goes out as the relay. The second baseman trails <b>15 to 20 feet behind</b> in case the throw is off-line.',
    whyShort: '<b>15 to 20 feet</b> behind the relay',
    jobs: { P: [200, 604], C: [400, 702], '1B': [400, 398], '2B': [254, 340], '3B': [248, 550], SS: [256, 290], LF: [213, 101], CF: [260, 150], RF: [400, 288] },
    throws: [['CF', 'SS', [260, 150], [256, 290]], ['SS', '3B', [256, 290], [248, 550]]],
    runners: [['B', 0, 2, 'safe']],
  },
];

export const POS_NAME = {
  P: 'pitcher', C: 'catcher', '1B': 'first baseman', '2B': 'second baseman', '3B': 'third baseman',
  SS: 'shortstop', LF: 'left fielder', CF: 'center fielder', RF: 'right fielder',
};
