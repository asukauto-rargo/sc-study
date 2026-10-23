-- 試験回のシードと、アプリが呼ぶ関数（RPC）

-- ===== 試験回 =====
-- dir / prefix は IPA の公表PDFのURL構成。過去問道場の年度ページから採取したもの。
with src(code, label, year_ad, season, dir, prefix, pm_style) as (values
  ('07_aki','令和7年秋期',2025,'aki','nl10bi0000009lh8-att','2025r07a','single'),
  ('07_haru','令和7年春期',2025,'haru','nl10bi0000009lh8-att','2025r07h','single'),
  ('06_aki','令和6年秋期',2024,'aki','m42obm000000afqx-att','2024r06a','single'),
  ('06_haru','令和6年春期',2024,'haru','m42obm000000afqx-att','2024r06h','single'),
  ('05_aki','令和5年秋期',2023,'aki','ps6vr70000010d6y-att','2023r05a','single'),
  ('05_haru','令和5年春期',2023,'haru','ps6vr70000010d6y-att','2023r05h','split'),
  ('04_aki','令和4年秋期',2022,'aki','gmcbt80000008smf-att','2022r04a','split'),
  ('04_haru','令和4年春期',2022,'haru','gmcbt80000009sgk-att','2022r04h','split'),
  ('03_aki','令和3年秋期',2021,'aki','gmcbt8000000apad-att','2021r03a','split'),
  ('03_haru','令和3年春期',2021,'haru','gmcbt8000000d5ru-att','2021r03h','split'),
  ('02_aki','令和2年秋期',2020,'aki','gmcbt8000000d05l-att','2020r02o','split'),
  ('01_aki','令和元年秋期',2019,'aki','gmcbt8000000dict-att','2019r01a','split'),
  ('31_haru','平成31年春期',2019,'haru','gmcbt8000000ddiw-att','2019h31h','split'),
  ('30_aki','平成30年秋期',2018,'aki','gmcbt8000000f01f-att','2018h30a','split'),
  ('30_haru','平成30年春期',2018,'haru','gmcbt8000000fabr-att','2018h30h','split'),
  ('29_aki','平成29年秋期',2017,'aki','gmcbt8000000fqpm-att','2017h29a','split'),
  ('29_haru','平成29年春期',2017,'haru','gmcbt8000000fzx1-att','2017h29h','split'),
  ('28_aki','平成28年秋期',2016,'aki','gmcbt8000000g6fw-att','2016h28a','split'),
  ('28_haru','平成28年春期',2016,'haru','gmcbt8000000gn5o-att','2016h28h','split'),
  ('27_aki','平成27年秋期',2015,'aki','gmcbt8000000gxj0-att','2015h27a','split'),
  ('27_haru','平成27年春期',2015,'haru','ug65p90000000f52-att','2015h27h','split'),
  ('26_aki','平成26年秋期',2014,'aki','ug65p90000000ye5-att','2014h26a','split'),
  ('26_haru','平成26年春期',2014,'haru','ug65p90000001dzu-att','2014h26h','split')
), expanded as (
  select code, label, year_ad, season, pm_style,
         'https://www.ipa.go.jp/shiken/mondai-kaiotu/' || dir || '/' || prefix as u
    from src
)
insert into public.exam_sittings (code, label, year_ad, season, sort_key, ipa_urls, siken_base)
select code, label, year_ad, season,
  year_ad * 10 + case season when 'haru' then 1 else 2 end,
  jsonb_build_object(
    'am1_qs',  u || '_koudo_am1_qs.pdf',
    'am1_ans', u || '_koudo_am1_ans.pdf',
    'am2_qs',  u || '_sc_am2_qs.pdf',
    'am2_ans', u || '_sc_am2_ans.pdf')
  || case pm_style
       when 'single' then jsonb_build_object(
         'pm_qs',  u || '_sc_pm_qs.pdf',
         'pm_ans', u || '_sc_pm_ans.pdf')
       else jsonb_build_object(
         'pm1_qs',  u || '_sc_pm1_qs.pdf',
         'pm1_ans', u || '_sc_pm1_ans.pdf',
         'pm2_qs',  u || '_sc_pm2_qs.pdf',
         'pm2_ans', u || '_sc_pm2_ans.pdf')
     end,
  'https://www.sc-siken.com/kakomon/' || code || '/'
from expanded
on conflict (code) do update
  set ipa_urls = excluded.ipa_urls, siken_base = excluded.siken_base;

-- ===== 忘却曲線の間隔計算（SM-2 系） =====
-- rating: 1=again 2=hard 3=good 4=easy
--   again → 易しさ係数 -0.20、10分後に再出題
--   hard  → -0.15、復習段階なら間隔×1.2、学習中なら12時間後
--   good  → 初回は1日、以降は 間隔×易しさ係数
--   easy  → +0.15、初回は4日、以降は 間隔×易しさ係数×1.3
-- 間隔は最大365日。2日以上は ±5% ゆらぎを入れて同日に固まるのを防ぐ。
create or replace function public.grade_card(
  p_card_id uuid, p_rating int, p_elapsed_ms int default null
) returns public.cards
language plpgsql security invoker set search_path = public as $$
declare
  c public.cards; new_ease numeric; new_interval numeric; new_state text; fuzz numeric;
begin
  if p_rating < 1 or p_rating > 4 then raise exception 'rating must be 1..4'; end if;

  select * into c from public.cards where id = p_card_id and user_id = auth.uid() for update;
  if not found then raise exception 'card not found'; end if;

  new_ease := c.ease;

  if p_rating = 1 then
    new_ease := greatest(1.3, c.ease - 0.20); new_state := 'relearning'; new_interval := 0;
  elsif p_rating = 2 then
    new_ease := greatest(1.3, c.ease - 0.15);
    if c.state = 'review' then
      new_state := 'review'; new_interval := greatest(1, c.interval_days * 1.2);
    else
      new_state := 'learning'; new_interval := 0.5;
    end if;
  elsif p_rating = 3 then
    new_state := 'review';
    new_interval := case when c.state in ('new','learning','relearning')
                         then 1 else greatest(1, c.interval_days * new_ease) end;
  else
    new_ease := least(3.0, c.ease + 0.15); new_state := 'review';
    new_interval := case when c.state in ('new','learning','relearning')
                         then 4 else greatest(1, c.interval_days * new_ease * 1.3) end;
  end if;

  new_interval := least(new_interval, 365);
  fuzz := case when new_interval >= 2 then 1 + (random() - 0.5) * 0.1 else 1 end;

  insert into public.reviews
    (user_id, card_id, rating, elapsed_ms, prev_interval, next_interval, prev_ease, next_ease)
  values (c.user_id, c.id, p_rating, p_elapsed_ms, c.interval_days, new_interval, c.ease, new_ease);

  update public.cards set
    state = new_state, ease = new_ease, interval_days = new_interval,
    reps = c.reps + 1,
    lapses = c.lapses + case when p_rating = 1 then 1 else 0 end,
    last_reviewed_at = now(),
    due = case when new_interval = 0 then now() + interval '10 minutes'
               when new_interval < 1 then now() + (new_interval * interval '1 day')
               else now() + (new_interval * fuzz * interval '1 day') end
  where id = c.id returning * into c;

  return c;
end $$;

-- ===== 今日の復習キュー =====
create or replace function public.due_queue(p_limit int default 40, p_deck text default null)
returns setof public.cards language sql security invoker set search_path = public as $$
  select * from public.cards
   where user_id = auth.uid() and not suspended and due <= now()
     and (p_deck is null or deck = p_deck)
   order by case state when 'relearning' then 0 when 'learning' then 1
                       when 'review' then 2 else 3 end, due
   limit greatest(1, least(p_limit, 200));
$$;

-- ===== 間違えた過去問を復習キューへ =====
create or replace function public.ensure_question_card(p_question_id uuid)
returns public.cards language plpgsql security invoker set search_path = public as $$
declare q public.questions; c public.cards; v_front text; v_back text;
begin
  select * into q from public.questions where id = p_question_id and user_id = auth.uid();
  if not found then raise exception 'question not found'; end if;

  select * into c from public.cards
   where user_id = auth.uid() and origin = 'question' and origin_ref = p_question_id::text;
  if found then
    update public.cards set due = now(), state = 'relearning', suspended = false
     where id = c.id returning * into c;
    return c;
  end if;

  v_front := q.body || coalesce(E'\n\n' || (
    select string_agg(key || '. ' || value, E'\n' order by key) from jsonb_each_text(q.choices)), '');
  v_back := coalesce('正解: ' || q.correct, '')
         || coalesce(E'\n\n' || q.official_answer, '')
         || coalesce(E'\n\n' || q.explanation, '')
         || E'\n\n' || q.attribution;

  insert into public.cards (user_id, deck, front, back, origin, origin_ref, tags, state, due)
  values (auth.uid(),
    case q.section when 'a1' then '科目A-1' when 'a2' then '科目A-2' else '科目B' end,
    v_front, v_back, 'question', p_question_id::text,
    array[q.sitting_code, q.section]
      || case when q.topic is null then '{}'::text[] else array[q.topic] end,
    'new', now())
  returning * into c;
  return c;
end $$;

-- ===== 資料の日本語全文検索（pgroonga） =====
create or replace function public.search_pages(p_query text, p_limit int default 40)
returns table (material_id uuid, material_title text, page int, snippet text, score real)
language sql security invoker set search_path = public as $$
  select mp.material_id, m.title, mp.page, left(mp.text, 400),
         pgroonga_score(mp.tableoid, mp.ctid)
    from public.material_pages mp
    join public.materials m on m.id = mp.material_id
   where mp.user_id = auth.uid() and mp.text &@~ p_query
   order by 5 desc, mp.page
   limit greatest(1, least(p_limit, 200));
$$;

-- ===== ダッシュボード集計 =====
-- 実体は本番プロジェクトに適用済み。定義を取り出したいときは
--   select pg_get_functiondef('public.dashboard_stats(text)'::regprocedure);
create or replace function public.dashboard_stats(p_tz text default 'Asia/Tokyo')
returns jsonb language sql security invoker set search_path = public as $$
with me as (select auth.uid() as uid),
card_base as (select * from public.cards where user_id = (select uid from me) and not suspended),
totals as (
  select count(*) as total,
         count(*) filter (where due <= now()) as due_now,
         count(*) filter (where state = 'new') as new_cards,
         count(*) filter (where state = 'review') as mature,
         coalesce(round(avg(ease) filter (where state = 'review'), 2), 0) as avg_ease,
         coalesce(round(avg(interval_days) filter (where state = 'review'), 1), 0) as avg_interval
    from card_base),
rev as (select * from public.reviews where user_id = (select uid from me)),
rev_stats as (
  select count(*) filter (where (reviewed_at at time zone p_tz)::date
                                = (now() at time zone p_tz)::date) as today,
         count(*) filter (where reviewed_at >= now() - interval '7 days') as last7,
         count(*) filter (where reviewed_at >= now() - interval '30 days') as last30,
         coalesce(round(100.0 * count(*) filter (
             where rating >= 3 and reviewed_at >= now() - interval '30 days')
           / nullif(count(*) filter (where reviewed_at >= now() - interval '30 days'), 0), 1), 0)
           as retention30
    from rev),
by_deck as (
  select coalesce(jsonb_agg(d order by d->>'deck'), '[]'::jsonb) as v from (
    select jsonb_build_object('deck', deck, 'total', count(*),
             'due', count(*) filter (where due <= now()),
             'new', count(*) filter (where state = 'new'),
             'avg_interval', coalesce(round(avg(interval_days) filter (where state='review'), 1), 0)) as d
      from card_base group by deck) s),
forecast as (
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', c) order by d), '[]'::jsonb) as v from (
    select (now() at time zone p_tz)::date + i as d,
           (select count(*) from card_base
             where (due at time zone p_tz)::date = (now() at time zone p_tz)::date + i) as c
      from generate_series(0, 13) as g(i)) s),
daily as (
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', c) order by d), '[]'::jsonb) as v from (
    select (now() at time zone p_tz)::date - i as d,
           (select count(*) from rev
             where (reviewed_at at time zone p_tz)::date = (now() at time zone p_tz)::date - i) as c
      from generate_series(0, 29) as g(i)) s),
streak as (
  select count(*) as days from (
    select ((now() at time zone p_tz)::date - d) as off,
           (row_number() over (order by d desc)) - 1 as rn
      from (select distinct (reviewed_at at time zone p_tz)::date as d from rev) u) t
  where off = rn),
att as (
  select count(*) as attempts, count(*) filter (where correct) as correct_n,
         coalesce(round(100.0 * count(*) filter (where correct)
           / nullif(count(*) filter (where correct is not null), 0), 1), 0) as accuracy,
         count(*) filter (where attempted_at >= now() - interval '7 days') as last7
    from public.question_attempts where user_id = (select uid from me)),
qbank as (
  select coalesce(jsonb_object_agg(section, n), '{}'::jsonb) as v
    from (select section, count(*) as n from public.questions
           where user_id = (select uid from me) group by section) s)
select jsonb_build_object(
  'cards', (select to_jsonb(t) from totals t),
  'reviews', (select to_jsonb(r) from rev_stats r),
  'by_deck', (select v from by_deck),
  'forecast', (select v from forecast),
  'daily', (select v from daily),
  'streak', (select days from streak),
  'attempts', (select to_jsonb(a) from att a),
  'qbank', (select v from qbank));
$$;
