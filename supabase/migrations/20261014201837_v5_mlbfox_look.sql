-- MLBFox joins the looks: v4.46-4.47's national-TV playoff bug, rebuilt natively.
alter table public.channels drop constraint channels_look_check;
alter table public.channels add constraint channels_look_check
  check (look in ('pressbox', 'classic', 'primetime', 'bluesteel', 'forever20', 'midnight', 'mlbfox', 'classic-green', 'pinball-dmd',
                  'chalkboard', 'comic', 'split-flap', 'receipt', 'pixel-rpg'));
