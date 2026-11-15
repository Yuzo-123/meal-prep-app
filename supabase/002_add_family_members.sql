-- 作り置きアプリ: いま登録されている人を、家庭 'home' の一員にする
-- 使い方: Authentication の画面で Yuzo と妻の 2 人を追加し、新規登録を止めたあとに、SQL Editor で Run。
-- 注意: 「いま登録されている人 全員」を入れるので、流す前に Authentication → Users に 2 人だけが並んでいることを確かめる。
-- Mac の lio（管理用の鍵）が、名簿の人数を確かめられるようにする。アプリ側（ログインした人）の権限は変えない。
grant select on public.household_members to service_role;

insert into public.household_members (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- 確認用: 何人入ったか（メールアドレスは表示しない）
select household, count(*) as members from public.household_members group by household;
