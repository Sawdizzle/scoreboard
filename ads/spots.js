// The apps with an on-air spot, for the pad (js/control.js), which deals the
// next app and topic on each tap, and the overlay (js/app-spots.js), which
// loads each app's page in its own frame and plays it. Every page is built on
// ads/kit.js and speaks the kit's spot:* messages.
//
//   on      false keeps a built spot out of the rotation (the pad never deals
//           it and the overlay never loads it); its page still works on its own
//   page    the spot page, loaded with ?embed=1
//   topics  what the spot rotates through ({ id, label } at least)
//   files   what the page loads beyond itself and the kit, for the overlay's
//           check that a release has fully arrived before it reloads

import { RTP_PLAYS } from './rtp-plays.js';
import { YBT_TOPICS } from './ybt-topics.js';
import { TWL_TOPICS } from './twl-topics.js';

const APPS = [
  {
    id: 'rtp', name: 'Run the Play', page: '/ads/runtheplay', topics: RTP_PLAYS,
    files: ['/ads/rtp-plays.js', '/ads/img/rtp-mark.png', '/fonts/ads/teko-500.woff2', '/fonts/ads/teko-600.woff2'],
  },
  {
    id: 'ybt', name: 'Baseball Time', page: '/ads/baseballtime', topics: YBT_TOPICS,
    files: ['/ads/ybt-topics.js', '/ads/img/ybt-mark.png', '/fonts/ads/barlow-condensed-800.woff2',
      '/fonts/ads/barlow-semi-condensed-400.woff2', '/fonts/ads/barlow-semi-condensed-600.woff2'],
  },
  {
    id: 'twl', name: 'Two-Way Lab', on: false, page: '/ads/twowaylab', topics: TWL_TOPICS,   // off for now (Shawn, 2026-09-28)
    files: ['/ads/twl-topics.js', '/ads/twl/swing-data.js', '/ads/twl/skeleton.js', '/fonts/ads/inter-400.woff2', '/fonts/ads/inter-600.woff2',
      '/fonts/ads/inter-800.woff2', '/fonts/ads/barlow-semi-condensed-600.woff2', '/fonts/bugs/jetbrains-mono-var.woff2'],
  },
];

export const SPOT_APPS = APPS.filter((a) => a.on !== false);

export const KIT_FILES = ['/ads/kit.js', '/ads/spots.js'];
