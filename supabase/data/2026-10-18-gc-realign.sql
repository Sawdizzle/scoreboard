-- =============================================================================
-- Blue Steel Baseball 14U, Fall 2026: season stats realigned to GameChanger.
-- =============================================================================
-- The pad mis-scored the first game on 2026-10-17 (vs The Express Baseball
-- Club) and part of the second (at Lonestar Baseball Club DFW). GameChanger
-- scored every game, and its season export of 2026-10-18 (10 games) is the
-- record. The export only has season totals, not per-game lines, so the season
-- is realigned as a whole rather than game by game:
--
--   season_stats = stat_imports (gamechanger) + every pad-scored game,
--
-- so the gamechanger row for each player is rewritten as the export minus what
-- the pad games already add. Every player's season line then equals the export
-- exactly, and later pad games add on top as usual.
--
-- Three play rows in the Express game recorded things GameChanger has none of
-- all season (#7's double, #14's caught stealing, one of #34's
-- strikeouts); the import cannot go below zero, so those cells are cleared on
-- the play rows themselves. That game's box score was wrong anyway.
--
-- Not taken from the export: W, L and SV (GameChanger has none recorded; the
-- pad works them out for final games), and FC (GameChanger has 0 for everyone;
-- the pad's one FC today stays, FC is not shown anywhere).
--
-- Re-runnable: run again after a pad game in this season changes (for
-- instance when the Calvary game of 2026-10-18 is ended and gains its start
-- and decision) and the season goes back to matching the export.
-- =============================================================================

begin;

update public.game_stats set b_2b = 0 where id = 48 and game_id = 'c6718758-aeff-4917-9d81-785e614638eb'; -- #7: double -> single
update public.game_stats set b_so = 0 where id = 50 and game_id = 'c6718758-aeff-4917-9d81-785e614638eb'; -- #34: strikeout -> out
update public.game_stats set b_cs = 0 where id = 52 and game_id = 'c6718758-aeff-4917-9d81-785e614638eb'; -- #14: caught stealing removed

delete from public.stat_imports
 where season_id = 'b8f868cc-e795-4cf5-ad05-ec424cb5adc2' and source = 'gamechanger';

with gc as (select * from (values ('4',9,13,8,0,0,0,0,0,3,5,3,0,0,0,0,0,0,6,1,6,2,38,146,0,0,0,11,13,13,9,6,3,1,1,17),
('5',9,11,8,2,1,0,0,0,1,3,3,2,0,0,0,0,0,5,2,2,0,12,48,0,0,0,3,3,3,4,2,1,0,1,4),
('7',10,15,11,6,0,1,0,1,5,4,3,1,0,0,0,0,0,8,2,1,0,11,39,0,0,0,2,4,4,2,1,0,0,0,5),
('9',3,5,3,0,0,0,0,0,0,2,1,0,0,0,0,0,0,1,0,2,1,11,40,0,0,0,2,4,4,5,0,0,0,0,4),
('12',10,15,11,8,3,0,0,3,9,4,2,0,0,0,0,0,0,14,2,2,1,9,34,0,0,0,1,3,3,3,1,2,2,0,3),
('14',9,11,5,0,0,0,0,0,5,6,4,2,0,0,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0),
('16',10,12,9,1,0,0,0,1,0,3,4,2,0,0,0,0,0,3,2,7,1,33,137,0,0,0,7,12,10,12,6,1,3,2,15),
('21',10,11,8,1,0,0,0,3,1,3,5,1,0,0,0,0,0,4,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0),
('24',10,12,8,0,0,0,0,0,2,4,7,3,0,0,0,0,0,6,2,7,4,45,168,0,0,0,18,21,19,15,4,1,0,0,17),
('34',8,9,4,2,1,0,0,1,4,5,2,2,0,0,0,0,0,7,1,4,1,28,129,0,0,0,4,11,11,10,10,1,1,0,13),
('37',9,11,4,2,1,0,1,3,6,7,2,1,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0),
('99',8,11,7,1,1,0,0,1,4,4,2,0,0,0,0,0,0,7,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)) as gc(number,b_g,b_pa,b_ab,b_h,b_2b,b_3b,b_hr,b_rbi,b_r,b_bb,b_so,b_kl,b_hbp,b_sac,b_sf,b_roe,b_fc,b_sb,b_cs,p_g,p_gs,p_bf,p_pitches,p_w,p_l,p_sv,p_h,p_r,p_er,p_bb,p_so,p_hbp,p_wp,p_bk,p_outs)),
per_game as (
  select s.game_id, s.player_id,
         sum(s.b_pa) b_pa, sum(s.b_ab) b_ab, sum(s.b_h) b_h, sum(s.b_2b) b_2b, sum(s.b_3b) b_3b, sum(s.b_hr) b_hr, sum(s.b_rbi) b_rbi, sum(s.b_r) b_r, sum(s.b_bb) b_bb, sum(s.b_so) b_so, sum(s.b_kl) b_kl, sum(s.b_hbp) b_hbp, sum(s.b_sac) b_sac, sum(s.b_sf) b_sf, sum(s.b_roe) b_roe, sum(s.b_fc) b_fc, sum(s.b_sb) b_sb, sum(s.b_cs) b_cs, sum(s.p_outs) p_outs, sum(s.p_bf) p_bf, sum(s.p_pitches) p_pitches, sum(s.p_h) p_h, sum(s.p_r) p_r, sum(s.p_er) p_er, sum(s.p_bb) p_bb, sum(s.p_so) p_so, sum(s.p_hbp) p_hbp, sum(s.p_wp) p_wp, sum(s.p_bk) p_bk,
         coalesce(max(d.p_gs), 0) p_gs
    from public.game_stats s
    join public.games g on g.id = s.game_id
    left join public.game_decisions d on d.game_id = s.game_id and d.player_id = s.player_id
   where s.side = 'us' and s.player_id is not null and g.counts_for_stats
     and g.season_id = 'b8f868cc-e795-4cf5-ad05-ec424cb5adc2'
   group by 1, 2
),
pad as (
  select player_id, count(*) filter (where b_pa > 0) b_g, count(*) filter (where p_bf > 0 or p_outs > 0) p_g,
         sum(p_gs) p_gs, sum(b_pa) b_pa, sum(b_ab) b_ab, sum(b_h) b_h, sum(b_2b) b_2b, sum(b_3b) b_3b, sum(b_hr) b_hr, sum(b_rbi) b_rbi, sum(b_r) b_r, sum(b_bb) b_bb, sum(b_so) b_so, sum(b_kl) b_kl, sum(b_hbp) b_hbp, sum(b_sac) b_sac, sum(b_sf) b_sf, sum(b_roe) b_roe, sum(b_fc) b_fc, sum(b_sb) b_sb, sum(b_cs) b_cs, sum(p_outs) p_outs, sum(p_bf) p_bf, sum(p_pitches) p_pitches, sum(p_h) p_h, sum(p_r) p_r, sum(p_er) p_er, sum(p_bb) p_bb, sum(p_so) p_so, sum(p_hbp) p_hbp, sum(p_wp) p_wp, sum(p_bk) p_bk
    from per_game group by 1
)
insert into public.stat_imports (team_id, season_id, player_id, source, b_g, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs, p_g, p_gs, p_outs, p_bf, p_pitches, p_w, p_l, p_sv, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk)
select '65ef3b9e-a6fe-4c6d-888c-88acde37d210', 'b8f868cc-e795-4cf5-ad05-ec424cb5adc2', p.id, 'gamechanger',
       greatest(gc.b_g - coalesce(pad.b_g, 0), 0), greatest(gc.b_pa - coalesce(pad.b_pa, 0), 0), greatest(gc.b_ab - coalesce(pad.b_ab, 0), 0), greatest(gc.b_h - coalesce(pad.b_h, 0), 0), greatest(gc.b_2b - coalesce(pad.b_2b, 0), 0), greatest(gc.b_3b - coalesce(pad.b_3b, 0), 0), greatest(gc.b_hr - coalesce(pad.b_hr, 0), 0), greatest(gc.b_rbi - coalesce(pad.b_rbi, 0), 0), greatest(gc.b_r - coalesce(pad.b_r, 0), 0), greatest(gc.b_bb - coalesce(pad.b_bb, 0), 0), greatest(gc.b_so - coalesce(pad.b_so, 0), 0), greatest(gc.b_kl - coalesce(pad.b_kl, 0), 0), greatest(gc.b_hbp - coalesce(pad.b_hbp, 0), 0), greatest(gc.b_sac - coalesce(pad.b_sac, 0), 0), greatest(gc.b_sf - coalesce(pad.b_sf, 0), 0), greatest(gc.b_roe - coalesce(pad.b_roe, 0), 0), greatest(gc.b_fc - coalesce(pad.b_fc, 0), 0), greatest(gc.b_sb - coalesce(pad.b_sb, 0), 0), greatest(gc.b_cs - coalesce(pad.b_cs, 0), 0), greatest(gc.p_g - coalesce(pad.p_g, 0), 0), greatest(gc.p_gs - coalesce(pad.p_gs, 0), 0), greatest(gc.p_outs - coalesce(pad.p_outs, 0), 0), greatest(gc.p_bf - coalesce(pad.p_bf, 0), 0), greatest(gc.p_pitches - coalesce(pad.p_pitches, 0), 0), 0, 0, 0, greatest(gc.p_h - coalesce(pad.p_h, 0), 0), greatest(gc.p_r - coalesce(pad.p_r, 0), 0), greatest(gc.p_er - coalesce(pad.p_er, 0), 0), greatest(gc.p_bb - coalesce(pad.p_bb, 0), 0), greatest(gc.p_so - coalesce(pad.p_so, 0), 0), greatest(gc.p_hbp - coalesce(pad.p_hbp, 0), 0), greatest(gc.p_wp - coalesce(pad.p_wp, 0), 0), greatest(gc.p_bk - coalesce(pad.p_bk, 0), 0)
  from gc
  join public.players p on p.team_id = '65ef3b9e-a6fe-4c6d-888c-88acde37d210' and p.number = gc.number
  left join pad on pad.player_id = p.id;

-- Fielding, from the same export (added once the fielding columns existed,
-- 2026-10-19): each player's gamechanger row takes the export's fielding minus
-- whatever the pad's games already credit. Re-runnable like the rest.
with gc (number, f_po, f_a, f_e, p_pik, c_sb, c_cs, c_pik, c_pb, b_pik) as (values
  ('4',1,1,0,2,0,0,0,0,0),
  ('5',20,2,2,0,34,3,0,1,0),
  ('7',16,0,2,0,0,0,0,0,1),
  ('9',1,2,0,0,0,0,0,0,0),
  ('12',9,2,3,0,14,1,0,0,1),
  ('14',1,0,0,0,0,0,0,0,0),
  ('16',10,3,2,2,10,0,0,0,1),
  ('21',7,3,3,0,0,0,0,0,0),
  ('24',3,1,3,3,0,0,0,0,0),
  ('34',7,1,3,0,8,0,0,1,0),
  ('37',1,1,3,0,1,0,0,0,0),
  ('99',1,0,0,0,0,0,0,0,0)),
pad as (
  select s.player_id, sum(s.f_po) f_po, sum(s.f_a) f_a, sum(s.f_e) f_e, sum(s.p_pik) p_pik, sum(s.c_sb) c_sb, sum(s.c_cs) c_cs, sum(s.c_pik) c_pik, sum(s.c_pb) c_pb, sum(s.b_pik) b_pik
    from public.game_stats s join public.games g on g.id = s.game_id
   where s.side = 'us' and s.player_id is not null and g.counts_for_stats
     and g.season_id = 'b8f868cc-e795-4cf5-ad05-ec424cb5adc2'
   group by 1
)
update public.stat_imports si
   set f_po = greatest(gc.f_po - coalesce(pad.f_po, 0), 0),
       f_a = greatest(gc.f_a - coalesce(pad.f_a, 0), 0),
       f_e = greatest(gc.f_e - coalesce(pad.f_e, 0), 0),
       p_pik = greatest(gc.p_pik - coalesce(pad.p_pik, 0), 0),
       c_sb = greatest(gc.c_sb - coalesce(pad.c_sb, 0), 0),
       c_cs = greatest(gc.c_cs - coalesce(pad.c_cs, 0), 0),
       c_pik = greatest(gc.c_pik - coalesce(pad.c_pik, 0), 0),
       c_pb = greatest(gc.c_pb - coalesce(pad.c_pb, 0), 0),
       b_pik = greatest(gc.b_pik - coalesce(pad.b_pik, 0), 0)
  from gc
  join public.players p on p.team_id = '65ef3b9e-a6fe-4c6d-888c-88acde37d210' and p.number = gc.number
  left join pad on pad.player_id = p.id
 where si.season_id = 'b8f868cc-e795-4cf5-ad05-ec424cb5adc2' and si.source = 'gamechanger' and si.player_id = p.id;

commit;

-- Rollback: the gamechanger rows as they were (export of 2026-10-15, 7 games).
-- Put back with the three game_stats cells above (48 b_2b, 50 b_so, 52 b_cs) set to 1.
--
-- delete from public.stat_imports where season_id = 'b8f868cc-e795-4cf5-ad05-ec424cb5adc2' and source = 'gamechanger';
-- insert into public.stat_imports (team_id, season_id, player_id, source, imported_at, b_g, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs, p_g, p_gs, p_outs, p_bf, p_pitches, p_w, p_l, p_sv, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk)
-- select team_id, season_id, player_id, source, imported_at, b_g, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs, p_g, p_gs, p_outs, p_bf, p_pitches, p_w, p_l, p_sv, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk
--   from jsonb_populate_recordset(null::public.stat_imports, '[{"b_g":6,"b_h":0,"b_r":3,"p_g":5,"p_h":11,"p_l":0,"p_r":13,"p_w":0,"b_2b":0,"b_3b":0,"b_ab":6,"b_bb":4,"b_cs":1,"b_fc":0,"b_hr":0,"b_kl":0,"b_pa":10,"b_sb":5,"b_sf":0,"b_so":2,"p_bb":8,"p_bf":31,"p_bk":1,"p_er":13,"p_gs":2,"p_so":2,"p_sv":0,"p_wp":1,"b_hbp":0,"b_rbi":0,"b_roe":0,"b_sac":0,"p_hbp":2,"p_outs":11,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":110,"player_id":"3055b48c-835c-4e64-9f26-5d8a8a64fe0a","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":6,"b_h":2,"b_r":1,"p_g":2,"p_h":3,"p_l":0,"p_r":3,"p_w":0,"b_2b":1,"b_3b":0,"b_ab":5,"b_bb":2,"b_cs":2,"b_fc":0,"b_hr":0,"b_kl":1,"b_pa":7,"b_sb":4,"b_sf":0,"b_so":1,"p_bb":4,"p_bf":12,"p_bk":1,"p_er":3,"p_gs":0,"p_so":2,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":0,"b_roe":0,"b_sac":0,"p_hbp":1,"p_outs":4,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":48,"player_id":"52557a6c-79ea-496b-8872-3d8816901ff3","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":5,"b_h":1,"b_r":4,"p_g":3,"p_h":4,"p_l":0,"p_r":9,"p_w":0,"b_2b":0,"b_3b":0,"b_ab":1,"b_bb":4,"b_cs":0,"b_fc":0,"b_hr":0,"b_kl":0,"b_pa":5,"b_sb":6,"b_sf":0,"b_so":0,"p_bb":7,"p_bf":23,"p_bk":0,"p_er":9,"p_gs":1,"p_so":8,"p_sv":0,"p_wp":1,"b_hbp":0,"b_rbi":0,"b_roe":0,"b_sac":0,"p_hbp":1,"p_outs":11,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":105,"player_id":"696e90e5-bd35-48ba-89f5-c57db41472f0","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":6,"b_h":2,"b_r":5,"p_g":0,"p_h":0,"p_l":0,"p_r":0,"p_w":0,"b_2b":1,"b_3b":0,"b_ab":4,"b_bb":4,"b_cs":0,"b_fc":0,"b_hr":1,"b_kl":1,"b_pa":8,"b_sb":5,"b_sf":0,"b_so":2,"p_bb":0,"p_bf":0,"p_bk":0,"p_er":0,"p_gs":0,"p_so":0,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":3,"b_roe":0,"b_sac":0,"p_hbp":0,"p_outs":0,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":0,"player_id":"6e87a835-bb01-4538-9ba7-dc3132a95e32","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":7,"b_h":6,"b_r":5,"p_g":0,"p_h":0,"p_l":0,"p_r":0,"p_w":0,"b_2b":0,"b_3b":1,"b_ab":10,"b_bb":1,"b_cs":0,"b_fc":0,"b_hr":0,"b_kl":1,"b_pa":11,"b_sb":8,"b_sf":0,"b_so":2,"p_bb":0,"p_bf":0,"p_bk":0,"p_er":0,"p_gs":0,"p_so":0,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":1,"b_roe":0,"b_sac":0,"p_hbp":0,"p_outs":0,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":0,"player_id":"7510e134-6d90-4a33-9649-33319e18c344","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":7,"b_h":6,"b_r":8,"p_g":1,"p_h":0,"p_l":0,"p_r":0,"p_w":0,"b_2b":2,"b_3b":0,"b_ab":7,"b_bb":3,"b_cs":0,"b_fc":0,"b_hr":0,"b_kl":0,"b_pa":10,"b_sb":12,"b_sf":0,"b_so":1,"p_bb":0,"p_bf":0,"p_bk":0,"p_er":0,"p_gs":0,"p_so":0,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":3,"b_roe":0,"b_sac":0,"p_hbp":0,"p_outs":0,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":2,"player_id":"9add2f44-080c-4fc1-8076-21894d2c67c9","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":7,"b_h":1,"b_r":0,"p_g":4,"p_h":5,"p_l":0,"p_r":6,"p_w":0,"b_2b":0,"b_3b":0,"b_ab":6,"b_bb":3,"b_cs":2,"b_fc":0,"b_hr":0,"b_kl":1,"b_pa":9,"b_sb":3,"b_sf":0,"b_so":1,"p_bb":4,"p_bf":21,"p_bk":1,"p_er":6,"p_gs":0,"p_so":6,"p_sv":0,"p_wp":2,"b_hbp":0,"b_rbi":1,"b_roe":0,"b_sac":0,"p_hbp":1,"p_outs":12,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":84,"player_id":"b6d29184-6cc9-4dda-a2c6-f9e0a311e989","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":7,"b_h":1,"b_r":1,"p_g":0,"p_h":0,"p_l":0,"p_r":0,"p_w":0,"b_2b":0,"b_3b":0,"b_ab":6,"b_bb":2,"b_cs":2,"b_fc":0,"b_hr":0,"b_kl":1,"b_pa":8,"b_sb":4,"b_sf":0,"b_so":4,"p_bb":0,"p_bf":0,"p_bk":0,"p_er":0,"p_gs":0,"p_so":0,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":3,"b_roe":0,"b_sac":0,"p_hbp":0,"p_outs":0,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":0,"player_id":"d1073626-6831-4e33-b9f7-614c9cae9d79","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":7,"b_h":1,"b_r":4,"p_g":0,"p_h":0,"p_l":0,"p_r":0,"p_w":0,"b_2b":1,"b_3b":0,"b_ab":6,"b_bb":4,"b_cs":1,"b_fc":0,"b_hr":0,"b_kl":0,"b_pa":10,"b_sb":7,"b_sf":0,"b_so":2,"p_bb":0,"p_bf":0,"p_bk":0,"p_er":0,"p_gs":0,"p_so":0,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":1,"b_roe":0,"b_sac":0,"p_hbp":0,"p_outs":0,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":0,"player_id":"ec375e67-8b59-4e75-8847-c2d68f4e55ec","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":6,"b_h":0,"b_r":5,"p_g":0,"p_h":0,"p_l":0,"p_r":0,"p_w":0,"b_2b":0,"b_3b":0,"b_ab":2,"b_bb":6,"b_cs":0,"b_fc":0,"b_hr":0,"b_kl":1,"b_pa":8,"b_sb":6,"b_sf":0,"b_so":1,"p_bb":0,"p_bf":0,"p_bk":0,"p_er":0,"p_gs":0,"p_so":0,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":0,"b_roe":0,"b_sac":0,"p_hbp":0,"p_outs":0,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":0,"player_id":"f2d017f1-fef5-4aab-ac03-3d2bc20a06a1","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null},{"b_g":7,"b_h":0,"b_r":2,"p_g":5,"p_h":13,"p_l":0,"p_r":16,"p_w":0,"b_2b":0,"b_3b":0,"b_ab":5,"b_bb":4,"b_cs":2,"b_fc":0,"b_hr":0,"b_kl":2,"b_pa":9,"b_sb":6,"b_sf":0,"b_so":4,"p_bb":13,"p_bf":35,"p_bk":0,"p_er":15,"p_gs":4,"p_so":4,"p_sv":0,"p_wp":0,"b_hbp":0,"b_rbi":0,"b_roe":0,"b_sac":0,"p_hbp":0,"p_outs":13,"source":"gamechanger","team_id":"65ef3b9e-a6fe-4c6d-888c-88acde37d210","p_pitches":132,"player_id":"f5aa4715-40d4-4e32-a1c1-427749c8c517","season_id":"b8f868cc-e795-4cf5-ad05-ec424cb5adc2","imported_at":"2026-10-15T19:47:30.6506+00:00","imported_by":null}]');
