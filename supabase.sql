-- U9 Holdoversigt bruger sin egen tilstandstabel, så U11-data ikke berøres.
create table if not exists public.u9_state (
  id text primary key,
  state jsonb not null default '{"matches":{},"updatedAt":null}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.u9_state (id, state)
values ('main', '{"matches":{},"updatedAt":null}'::jsonb)
on conflict (id) do nothing;

alter table public.u9_state enable row level security;

drop policy if exists "U9 state public read" on public.u9_state;
drop policy if exists "U9 state public insert" on public.u9_state;
drop policy if exists "U9 state public update" on public.u9_state;

drop policy if exists "U9 state authenticated read" on public.u9_state;
drop policy if exists "U9 state authenticated insert" on public.u9_state;
drop policy if exists "U9 state authenticated update" on public.u9_state;

create policy "U9 state public read"
on public.u9_state for select to anon using (true);

create policy "U9 state public insert"
on public.u9_state for insert to anon with check (true);

create policy "U9 state public update"
on public.u9_state for update to anon using (true) with check (true);

create policy "U9 state authenticated read"
on public.u9_state for select to authenticated using (true);

create policy "U9 state authenticated insert"
on public.u9_state for insert to authenticated with check (true);

create policy "U9 state authenticated update"
on public.u9_state for update to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
