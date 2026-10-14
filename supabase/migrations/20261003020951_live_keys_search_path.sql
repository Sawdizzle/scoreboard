-- Pin live_keys() to a fixed search path, like every other function here.
alter function public.live_keys() set search_path = public, pg_temp;
