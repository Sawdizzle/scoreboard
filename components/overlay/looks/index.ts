import type { ComponentType } from 'react';
import { BlueSteelBug } from '@/components/overlay/looks/BlueSteelBug';
import { ChalkboardBug } from '@/components/overlay/looks/ChalkboardBug';
import { ClassicBug } from '@/components/overlay/looks/ClassicBug';
import { ClassicGreenBug } from '@/components/overlay/looks/ClassicGreenBug';
import { ComicBug } from '@/components/overlay/looks/ComicBug';
import { Forever20Bug } from '@/components/overlay/looks/Forever20Bug';
import { MidnightBug } from '@/components/overlay/looks/MidnightBug';
import { PinballBug } from '@/components/overlay/looks/PinballBug';
import { PixelRpgBug } from '@/components/overlay/looks/PixelRpgBug';
import { PrimeTimeBug } from '@/components/overlay/looks/PrimeTimeBug';
import { ReceiptBug } from '@/components/overlay/looks/ReceiptBug';
import { SplitFlapBug } from '@/components/overlay/looks/SplitFlapBug';
import type { BugProps } from '@/components/overlay/looks/types';
import type { Look } from '@/lib/onair';

// Every look but Pressbox's own (which Stage draws itself) is a component
// here: drawn in the page, so the stat cards can slide out from behind it.
// Eleven of them are native rebuilds of Scoreboard's animated bugs
// (public/bugs/<slug>.html, kept for reference and for their thumbnails).
export const LOOK_BUGS: Partial<Record<Look, ComponentType<BugProps>>> = {
  classic: ClassicBug, bluesteel: BlueSteelBug, primetime: PrimeTimeBug, forever20: Forever20Bug, midnight: MidnightBug,
  'classic-green': ClassicGreenBug, 'pinball-dmd': PinballBug, chalkboard: ChalkboardBug, comic: ComicBug,
  'split-flap': SplitFlapBug, receipt: ReceiptBug, 'pixel-rpg': PixelRpgBug,
};
