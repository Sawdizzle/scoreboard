// What the Baseball Time spot (ads/baseballtime.html) rotates through: one age
// group and one reason to use the board per topic. Shared with the pad, which
// deals the next topic on each tap.
//
// This is a showcase, not live data: the tournaments are samples in the
// board's own format (date, name, town, class split, teams signed up, and the
// trend of sign-ups). The dates are always the coming weekend, worked out when
// the spot plays, so the board never looks stale.
//
//   q        the question, as [text, highlighted?] parts; ['|'] breaks the line
//   answer   the payoff line (' | ' breaks it); why = the sentence under it (<b> marks key words)
//   rows     the sample board; hl = the row the answer points at
//   tone     how the flag on that row reads: up (filling), low (thin), new, far
//   trend    sign-ups over the last days, for the row's sparkline

export const YBT_TOPICS = [
  {
    id: '12u-filling', label: '12U · is it filling?', age: '12U',
    q: [['Looking for a'], ['12U', true], ['|'], ['tournament?']],
    answer: 'See who\'s | signed up.',
    why: 'Team counts for every age, <b>split by class</b>, so you know a bracket is filling before you pay the entry.',
    flag: '+5 this week', tone: 'up', hl: 1,
    rows: [
      { name: 'Fall Classic', town: 'Waco, TX', extra: 'Turf', split: 'AA 3 · AAA 4', n: 7, trend: [1, 2, 4, 5, 7] },
      { name: 'Turf Wars NIT', town: 'Frisco, TX', extra: 'Turf', split: 'AA 6 · AAA 8', n: 14, trend: [4, 6, 9, 11, 14] },
      { name: 'Harvest Moon Classic', town: 'Round Rock, TX', extra: '', split: 'Open 9', n: 9, trend: [5, 6, 7, 8, 9] },
      { name: 'Leaves & Lumber', town: 'Tyler, TX', extra: '', split: 'AA 2', n: 2, trend: [0, 1, 1, 2, 2] },
    ],
  },
  {
    id: '10u-thin', label: '10U · will it make?', age: '10U',
    q: [['Will that'], ['10U', true], ['|'], ['bracket even make?']],
    answer: 'Know before | you enter.',
    why: 'A bracket with two teams gets <b>combined or cancelled</b>. The count tells you before you drive.',
    flag: 'Only 2 teams so far', tone: 'low', hl: 2,
    rows: [
      { name: 'Pumpkin Bash', town: 'Denton, TX', extra: 'Turf', split: 'Open 11', n: 11, trend: [3, 5, 8, 9, 11] },
      { name: 'Friday Night Lights', town: 'McKinney, TX', extra: '', split: 'AA 5 · AAA 3', n: 8, trend: [2, 4, 5, 7, 8] },
      { name: 'Gobbler Classic', town: 'Temple, TX', extra: '', split: 'AA 2', n: 2, trend: [1, 2, 2, 2, 2] },
      { name: 'Red River Rumble', town: 'Wichita Falls, TX', extra: 'Turf', split: 'Open 6', n: 6, trend: [1, 2, 3, 5, 6] },
    ],
  },
  {
    id: '14u-drive', label: '14U · worth the drive?', age: '14U',
    q: [['How far would you'], ['|'], ['drive for'], ['14U?', true]],
    answer: 'Worth the | drive.',
    why: 'Set where you\'re driving from and every tournament shows <b>its distance</b>, soonest weekend first.',
    flag: '16 teams · 42 mi', tone: 'far', hl: 0,
    rows: [
      { name: 'Veterans Day Slam', town: 'Mansfield, TX', extra: '42 mi', split: 'AA 7 · AAA 9', n: 16, trend: [6, 9, 12, 14, 16] },
      { name: 'Hill Country Showdown', town: 'Kerrville, TX', extra: '214 mi', split: 'Open 10', n: 10, trend: [4, 6, 7, 9, 10] },
      { name: 'Border Battle', town: 'Texarkana, TX', extra: '178 mi', split: 'AA 4', n: 4, trend: [1, 2, 3, 3, 4] },
      { name: 'Coastal Classic', town: 'Corpus Christi, TX', extra: '361 mi', split: 'AAA 12', n: 12, trend: [5, 7, 9, 11, 12] },
    ],
  },
  {
    id: '9u-new', label: '9U · new ones by email', age: '9U',
    q: [['Still checking'], ['|'], ['for new'], ['9U', true], ['|'], ['tournaments?']],
    answer: 'Get an email | when one opens.',
    why: 'Save a search and hear about <b>new tournaments</b> that match it, or keep them in your calendar.',
    flag: 'New today', tone: 'new', hl: 3,
    rows: [
      { name: 'Little Legends Cup', town: 'Abilene, TX', extra: '', split: 'Open 8', n: 8, trend: [2, 4, 5, 7, 8] },
      { name: 'First Frost Invitational', town: 'Amarillo, TX', extra: 'Turf', split: 'AA 3 · AAA 2', n: 5, trend: [1, 2, 3, 4, 5] },
      { name: 'Mesquite Madness', town: 'Mesquite, TX', extra: '', split: 'Open 6', n: 6, trend: [0, 2, 3, 5, 6] },
      { name: 'Sanger Showdown', town: 'Sanger, TX', extra: 'Turf', split: 'Open 1', n: 1, trend: [0, 0, 0, 0, 1] },
    ],
  },
];
