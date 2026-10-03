-- ことば辞典 v0.5
-- Supabase SQL Editor にそのまま貼り付けて実行してください。

create table if not exists public.dictionary_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  reading text not null default '',
  meaning text not null default '',
  example text not null default '',
  category text not null default '',
  tags text not null default '',
  related_words text not null default '',
  memo text not null default '',
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dictionary_entries enable row level security;

drop policy if exists "Users can view their own dictionary entries" on public.dictionary_entries;
create policy "Users can view their own dictionary entries"
on public.dictionary_entries
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own dictionary entries" on public.dictionary_entries;
create policy "Users can create their own dictionary entries"
on public.dictionary_entries
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own dictionary entries" on public.dictionary_entries;
create policy "Users can update their own dictionary entries"
on public.dictionary_entries
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own dictionary entries" on public.dictionary_entries;
create policy "Users can delete their own dictionary entries"
on public.dictionary_entries
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists dictionary_entries_user_id_idx
on public.dictionary_entries(user_id);

create index if not exists dictionary_entries_updated_at_idx
on public.dictionary_entries(user_id, updated_at desc);

grant select, insert, update, delete
on public.dictionary_entries
to authenticated;

revoke all
on public.dictionary_entries
from anon;
