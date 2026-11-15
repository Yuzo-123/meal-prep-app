-- 日曜につくりおき: アプリから「献立を頼む」ための置き場（注文）
-- 使い方: Supabase の画面 → SQL Editor の新しいタブに全部貼って Run。何度流しても同じ結果になる。
-- 考え方:
--   ・頼めるのは、ログインしていて、その家庭の名簿に入っている人だけ。自分の家庭のぶんだけ見られる
--   ・「組んでいます」「届きました」などの状態を書き換えられるのは、管理用の鍵（Mac 側）だけ
--   ・ログインしていない人は、読むことも頼むこともできない

create table if not exists public.requests (
  id          uuid primary key default gen_random_uuid(),
  household   text not null,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  week_start  date not null,
  payload     jsonb not null,   -- 選んだ品・おまかせ・取り分け・ひとこと・冷蔵庫の写真の日付と枚数
  status      text not null default 'new' check (status in ('new', 'working', 'done', 'failed', 'cancelled')),
  status_note text,
  updated_at  timestamptz not null default now()
);

alter table public.requests enable row level security;

revoke all on public.requests from anon, authenticated;
grant select, insert on public.requests to authenticated;
grant select, insert, update, delete on public.requests to service_role;

drop policy if exists "requests_select_own_household" on public.requests;
create policy "requests_select_own_household" on public.requests
  for select to authenticated
  using (household in (select household from public.household_members where user_id = (select auth.uid())));

drop policy if exists "requests_insert_own_household" on public.requests;
create policy "requests_insert_own_household" on public.requests
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'new'
    and household in (select household from public.household_members where user_id = (select auth.uid()))
  );
