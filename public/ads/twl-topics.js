// What the Two-Way Lab spot (ads/twowaylab.html) rotates through: one of the
// checks Two-Way Lab runs on every swing, shown on one real swing. Shared with
// the pad, which deals the next topic on each tap.
//
// The swing is the one on twowaylab.com (ads/twl/swing-data.js: a real rep,
// score 98, no names). Every number below is that swing's own analysis
// (SWING.a); the targets are the ones the site lists for each check.
//
//   q        the question, as [text, highlighted?] parts; ['|'] breaks the line
//   answer   the payoff (' | ' breaks it); why = the line under it (<b> marks key words)
//   look     which measurement the stage draws: foot, drift, drop or speed
//   metric   the readout: label, value, unit, target line, pill

export const TWL_TOPICS = [
  {
    id: 'foot-down', label: 'Foot down on time', look: 'foot',
    q: [['Is the front foot'], ['|'], ['down'], ['on time?', true]],
    answer: 'Right on | time.',
    why: 'The front foot landed <b>0.27 s</b> before contact, inside the 0.12–0.50 s window, so the swing starts ready.',
    metric: { label: 'Foot down', value: '0.27', unit: 's', target: 'Target 0.12–0.50 s', pill: 'On time' },
  },
  {
    id: 'head-still', label: 'Head still', look: 'drift',
    q: [['Does the head'], ['|'], ['stay'], ['still?', true]],
    answer: 'Eyes on | the ball.',
    why: 'The head moved just <b>1.7 in</b> from stance to contact, under the 4 in limit. No lunging at the pitch.',
    metric: { label: 'Head drift', value: '1.7', unit: 'in', target: 'Limit 4 in', pill: 'Still' },
  },
  {
    id: 'stays-tall', label: 'Stays tall', look: 'drop',
    q: [['Does your hitter'], ['|'], ['stay'], ['tall?', true]],
    answer: 'No | dipping.',
    why: 'The head dropped only <b>1.9 in</b> through the swing, under the 4 in limit. Tall and balanced.',
    metric: { label: 'Head drop', value: '1.9', unit: 'in', target: 'Limit 4 in', pill: 'Tall' },
  },
  {
    id: 'hand-speed', label: 'Hand speed', look: 'speed',
    q: [['How fast are'], ['|'], ['the'], ['hands?', true]],
    answer: '12.6 mph | at contact.',
    why: 'Peak hand speed is measured on <b>every swing</b> and tracked over time, so you can watch it climb.',
    metric: { label: 'Peak hand speed', value: '12.6', unit: 'mph', target: 'Tracked over time', pill: 'Peak' },
  },
];
