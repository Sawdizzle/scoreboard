-- A saved team can be marked as one of yours: it is preselected on its usual
-- side in New Game and loads with its lineup and positions. A per-account
-- choice stored with the team, so nothing about any one club is built in, and
-- an account that covers several teams can mark several.
alter table scoreboard.teams add column mine boolean not null default false;
comment on column scoreboard.teams.mine is
  'Marked as one of the owner''s own teams: preselected in New Game; its lineup positions are the ones the setup checklist asks for.';
