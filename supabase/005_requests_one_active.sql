-- 日曜につくりおき: 同じ週の注文が 2 つ同時に進まないようにする（2026-11-17）
-- 使い方: Supabase の画面 → SQL Editor の新しいタブに全部貼って Run。何度流しても同じ結果になる。
-- 考え方:
--   ・1 つの家庭・1 つの週で、まだ手を付けていない（new）か組んでいる途中（working）の注文は 1 件まで。
--     2 件目を入れようとすると断られる（アプリは「いま組んでいるところです」と出す）
--   ・作り直すときは、アプリが前の注文を「取り消し」にしてから新しく入れる。
--     ログインした家族にできる書き換えは、自分の家庭の new の注文を cancelled にすることだけ
--   ・組み始めた（working）注文は取り消せない。届くのを待つ

-- 1. 同じ週で進行中の注文は 1 件まで
create unique index if not exists requests_one_active_per_week
  on public.requests (household, week_start)
  where status in ('new', 'working');

-- 2. 家族が書き換えてよい列だけ許す（中身・頼んだ人・日時は書き換えられない）
grant update (status, status_note) on public.requests to authenticated;

-- 3. 書き換えてよいのは、自分の家庭の new の注文を cancelled にすることだけ
drop policy if exists "requests_cancel_own_new" on public.requests;
create policy "requests_cancel_own_new" on public.requests
  for update to authenticated
  using (
    status = 'new'
    and household in (select household from public.household_members where user_id = (select auth.uid()))
  )
  with check (
    status = 'cancelled'
    and household in (select household from public.household_members where user_id = (select auth.uid()))
  );

-- 確かめ: 進行中の注文が週ごとに 1 件以下になっているか（2 件以上の行が出たら、上の 1 は作られていない）
select household, week_start, count(*) from public.requests
 where status in ('new', 'working') group by household, week_start having count(*) > 1;
