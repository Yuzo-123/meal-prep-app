-- 作り置きアプリ: 週の献立・品の一覧・料理の写真をサーバー側に置く（毎週の取り込みを無くす）
-- 使い方: Supabase の画面 → SQL Editor の新しいタブに全部貼って Run。何度流しても同じ結果になる。
-- 考え方:
--   ・書けるのは管理用の鍵（Mac 側）だけ。ログインした人でも書き換えられない
--   ・読めるのは、ログインしていて、その家庭の名簿に入っている人だけ
--   ・ログインしていない人は何も読めない

-- 1. 週の献立（1 家庭・1 週につき 1 行。中身はアプリが読む形のまま持つ）
create table if not exists public.weeks (
  household  text not null,
  week_start date not null,
  bundle     jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (household, week_start)
);

-- 2. 品の一覧（1 家庭につき 1 行）
create table if not exists public.catalogs (
  household  text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.weeks enable row level security;
alter table public.catalogs enable row level security;

revoke all on public.weeks, public.catalogs from anon, authenticated;
grant select on public.weeks, public.catalogs to authenticated;
grant select, insert, update, delete on public.weeks, public.catalogs to service_role;

drop policy if exists "weeks_select_own_household" on public.weeks;
create policy "weeks_select_own_household" on public.weeks
  for select to authenticated
  using (household in (select household from public.household_members where user_id = (select auth.uid())));

drop policy if exists "catalogs_select_own_household" on public.catalogs;
create policy "catalogs_select_own_household" on public.catalogs
  for select to authenticated
  using (household in (select household from public.household_members where user_id = (select auth.uid())));

-- 3. 料理の写真の置き場（非公開・1 枚 1MB まで・JPEG だけ）。置く場所は「<家庭>/<品の番号>.jpg」
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish', 'dish', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "dish_select_own_household" on storage.objects;
create policy "dish_select_own_household" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dish'
    and (storage.foldername(name))[1] in (
      select household from public.household_members where user_id = (select auth.uid())
    )
  );

-- 写真を上げる・消す決まりは作らない（＝ログインした人でもできない）。上げるのは Mac 側が管理用の鍵で行う。
