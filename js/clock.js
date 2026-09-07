// A clock the pad and the overlay agree on.
//
// Two things in this app are absolute instants that one device writes and
// another reads, and both used the writing device's raw `Date.now()`:
//
//   - Nonces. Every transient trigger (stinger, clip, scene cut, OBS command)
//     is ordered by one, and the overlay acts only on a strictly newer nonce.
//     A phone 40s fast hands the overlay nonces from the future — hand off to a
//     second pad and everything it sends is dropped in silence, with nothing on
//     screen to say why, until real time catches up.
//   - The game clocks. `clock_ends_at` and soccer's `state.clock.since` are
//     written on the pad and read in the overlay, so a device offset lands on
//     air as exactly that much wrong clock.
//
// Phone clocks drift, and an iPhone in the stands and an OBS machine on a venue
// network share no time source. So ask Postgres what time it is, keep the
// delta, and put everything that has to mean the same thing on two devices
// through serverNow().
//
// Degrades to local time: if the RPC fails (offline, or not yet migrated) the
// offset stays 0 and behaviour is exactly what it was before.
import { db } from './supabase.js';

let skew = 0;        // serverNow - Date.now()
let synced = false;

// The shared reading. Use this anywhere a timestamp crosses a device boundary;
// plain Date.now() is still right for purely local elapsed-time measurements.
export const serverNow = () => Date.now() + skew;
export const clockSkewMs = () => skew;
export const clockSynced = () => synced;

export async function syncClock() {
  try {
    const t0 = Date.now();
    const { data, error } = await db.rpc('server_now');
    const t1 = Date.now();
    if (error || !data) return synced;
    const server = new Date(data).getTime();
    if (!Number.isFinite(server)) return synced;
    // The server took its reading somewhere inside the round trip; the midpoint
    // is the best guess, which puts the residual error at half the latency —
    // milliseconds, against the seconds-to-minutes of drift this exists to fix.
    skew = server - (t0 + t1) / 2;
    synced = true;
    // Worth knowing about: at this size the device clock is wrong enough that
    // anything the operator types by hand (first pitch time) will be off too.
    if (Math.abs(skew) > 30000) {
      console.warn(`Scoreboard: this device's clock is ${Math.round(skew / 1000)}s ` +
        'from the server. Times are corrected automatically, but the clock itself is worth fixing.');
    }
  } catch { /* keep whatever offset we had; 0 means plain local time */ }
  return synced;
}
