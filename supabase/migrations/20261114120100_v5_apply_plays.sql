-- =============================================================================
-- apply_plays: every play waiting on the pad, in one request.
-- =============================================================================
-- On a slow field connection each play cost a full round trip, one after the
-- other, so a few taps made while the signal dropped took seconds to clear.
-- apply_plays takes the plays in order and runs apply_play for each, on top of
-- the seq the one before it left, inside one transaction:
--
--   * p_seq is checked against the game exactly as apply_play does: a batch
--     sent on an old seq is refused with PB409, and nothing in it is saved.
--   * any play that fails (a bad row, a seat that cannot score) takes the
--     whole batch with it; the pad then sends the plays one at a time, so the
--     good ones still save and the bad one fails alone, as before.
--   * each play keeps its own event, payload and cid, so a reply that is lost
--     is found afterwards by the cids on the server, as before.
--
-- SECURITY INVOKER: it adds no rights of its own. apply_play does every check.
-- =============================================================================

create function public.apply_plays(p_game uuid, p_seq int, p_items jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_seq int := p_seq;
  v_res jsonb;
  v_out jsonb := '[]'::jsonb;
  it jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Those plays could not be read.' using errcode = 'P0001';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) is distinct from 'object' or jsonb_typeof(it->'patch') is distinct from 'object' then
      raise exception 'That play could not be read.' using errcode = 'P0001';
    end if;
    v_res := public.apply_play(p_game, v_seq, it->>'type', it->'patch',
                               coalesce(it->'payload', '{}'::jsonb), coalesce(it->'stats', '[]'::jsonb), it->>'status');
    v_seq := (v_res->>'seq')::int;
    v_out := v_out || jsonb_build_array(v_res);
  end loop;
  return jsonb_build_object('seq', v_seq, 'live', v_res->'live', 'status', v_res->'status', 'results', v_out);
end;
$$;

revoke all on function public.apply_plays(uuid, int, jsonb) from public, anon;
grant execute on function public.apply_plays(uuid, int, jsonb) to authenticated;
