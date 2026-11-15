-- 作り置きアプリ: 冷蔵庫の写真の置き場と「誰が読めるか」の決まり
-- 使い方: Supabase の画面 → SQL Editor に全部貼って Run。何度流しても同じ結果になる書き方にしてある。
-- 考え方: 最初は全部閉じておき、必要なぶんだけ開ける。
--   ・ログインしていない人は、何も読めないし上げられない
--   ・ログインした人は、自分の家庭のフォルダにだけ写真を上げられて、見られる
--   ・写真を消す・書き換えるのは管理用の鍵（Mac の lio）だけ

-- 1. どの人がどの家庭か（最初は 1 家庭 'home' だけ。あとで増やせる）
create table if not exists public.household_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  household  text not null default 'home',
  created_at timestamptz not null default now()
);

alter table public.household_members enable row level security;

revoke all on public.household_members from anon, authenticated;
grant select on public.household_members to authenticated;

drop policy if exists "members_select_own" on public.household_members;
create policy "members_select_own" on public.household_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 2. 写真の置き場（非公開・1 枚 5MB まで・JPEG だけ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fridge', 'fridge', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. 写真の決まり。置く場所は「<家庭>/<日付>/<ファイル名>.jpg」。
--    先頭のフォルダ名が自分の家庭と同じときだけ、上げる・見るを許す。
drop policy if exists "fridge_insert_own_household" on storage.objects;
create policy "fridge_insert_own_household" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fridge'
    and (storage.foldername(name))[1] in (
      select household from public.household_members where user_id = (select auth.uid())
    )
  );

drop policy if exists "fridge_select_own_household" on storage.objects;
create policy "fridge_select_own_household" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fridge'
    and (storage.foldername(name))[1] in (
      select household from public.household_members where user_id = (select auth.uid())
    )
  );

-- 更新と削除の決まりは作らない（＝ログインした人でもできない）。消すのは Mac の lio が管理用の鍵で行う。
