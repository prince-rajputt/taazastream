-- TaazaStream optional cloud schema (Supabase project "Storage").
--
-- Cloud is OPTIONAL: TaazaStream runs fully offline from its local SQLite database.
-- These tables only receive metadata backups / sync from the server, which writes with the
-- service-role key kept on the server PC. Row Level Security is enabled with NO policies,
-- so the public anon key can neither read nor write them. Video files are never uploaded.

create table if not exists public.ts_servers (
  id text primary key,
  name text not null,
  version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.ts_media_metadata (
  server_id text not null references public.ts_servers (id) on delete cascade,
  kind text not null check (kind in ('movie', 'series', 'episode')),
  local_id text not null,
  title text not null,
  year integer,
  overview text,
  genres text[] not null default '{}',
  data jsonb not null default '{}'::jsonb,
  poster_key text,
  backdrop_key text,
  updated_at timestamptz not null default now(),
  primary key (server_id, kind, local_id)
);

create index if not exists ts_media_metadata_title_idx on public.ts_media_metadata (server_id, title);

create table if not exists public.ts_metadata_backups (
  id uuid primary key default gen_random_uuid(),
  server_id text not null references public.ts_servers (id) on delete cascade,
  storage_key text not null,
  size_bytes bigint,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ts_metadata_backups_server_idx on public.ts_metadata_backups (server_id, created_at desc);

alter table public.ts_servers enable row level security;
alter table public.ts_media_metadata enable row level security;
alter table public.ts_metadata_backups enable row level security;

-- Private bucket for small artefacts only (posters, backdrops, subtitle and metadata backups).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'taazastream-artwork',
  'taazastream-artwork',
  false,
  10485760,
  array['image/webp', 'image/jpeg', 'image/png', 'text/vtt', 'application/gzip', 'application/json']
)
on conflict (id) do nothing;
