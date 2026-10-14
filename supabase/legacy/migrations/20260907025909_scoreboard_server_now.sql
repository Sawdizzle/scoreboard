-- BUG-5. Everything transient in this app is ordered by a nonce that is just
-- Date.now() on the pad, and both game clocks are absolute instants the pad
-- writes and the overlay reads. Phone clocks drift, and an iPhone in the stands
-- and an OBS machine on a venue network share no time source. A 40s-fast phone
-- hands the overlay nonces from the future: hand off to a second pad and every
-- stinger, clip, scene cut and OBS command it sends is dropped in silence,
-- because the overlay only acts on a strictly newer nonce. The same offset lands
-- on air directly, as a wrong game clock.
--
-- One shared reference fixes both. Not SECURITY DEFINER: now() needs no
-- elevated rights, and the anonymous overlay must be able to ask too.
create or replace function scoreboard.server_now()
returns timestamptz
language sql
stable
set search_path = scoreboard, pg_temp
as $$ select now() $$;

comment on function scoreboard.server_now() is
  'Shared clock reference. The pad and the overlay each measure their offset from this once at load, so nonces stay monotonic across devices and a game clock written on one device reads correctly on another.';
