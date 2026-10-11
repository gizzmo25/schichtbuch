-- Schichtbuch — Datenbankschema fuer Supabase (Postgres).
-- Ausfuehren im Supabase-Dashboard: SQL Editor -> New query -> Run.
-- Idempotent: kann beliebig oft erneut ausgefuehrt werden.

-- ---------------------------------------------------------------- Tabellen
create table if not exists public.shifts (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  shift_date    date not null,
  start_time    time not null,
  end_time      time not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 1439),
  rate          numeric(8, 2) not null check (rate >= 0),
  shift_type    text not null default '' check (char_length(shift_type) <= 60),
  note          text not null default '' check (char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Deckt die RLS-Bedingung (user_id) und die Sortierung nach Datum ab.
create index if not exists shifts_user_date_idx on public.shifts (user_id, shift_date);

create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shifts_set_updated_at on public.shifts;
create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- Zugriffsschutz
-- Row Level Security: jede angemeldete Person sieht und aendert nur eigene Zeilen.
alter table public.shifts   enable row level security;
alter table public.settings enable row level security;

drop policy if exists shifts_own on public.shifts;
create policy shifts_own on public.shifts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists settings_own on public.settings;
create policy settings_own on public.settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Nicht angemeldete Zugriffe (Rolle anon) erhalten gar keine Tabellenrechte.
revoke all on public.shifts, public.settings from anon;
grant select, insert, update, delete on public.shifts, public.settings to authenticated;

-- ---------------------------------------------------------------- Keepalive
-- Fuer den geplanten Ping (GitHub Actions), damit das Gratis-Projekt nicht pausiert.
-- Gibt nur die Konstante 1 zurueck und legt keine Daten offen.
create or replace function public.keepalive()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.shifts limit 1;
  return 1;
end;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
