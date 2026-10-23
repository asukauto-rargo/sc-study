-- 情報処理安全確保支援士 学習アプリ スキーマ（適用済みの内容をまとめたもの）
-- プロジェクト: znhilwkohgsdgygzlvrr / ap-northeast-1
-- 再構築したいときは新しいプロジェクトでこのファイルを流せばよい。

create extension if not exists pgroonga;
create extension if not exists pg_trgm;

-- ===== 試験回（共有リファレンス） =====
create table if not exists public.exam_sittings (
  code        text primary key,
  label       text not null,
  year_ad     int  not null,
  season      text not null check (season in ('haru','aki','toku')),
  sort_key    int  not null,
  ipa_urls    jsonb not null default '{}'::jsonb,
  siken_base  text
);

-- ===== 学習資料 =====
create table if not exists public.materials (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  kind         text not null default 'pdf' check (kind in ('pdf','note')),
  source_path  text,
  storage_path text,
  page_count   int,
  content_hash text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, source_path)
);

create table if not exists public.material_pages (
  id          bigserial primary key,
  material_id uuid not null references public.materials(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  page        int  not null,
  text        text not null default '',
  unique (material_id, page)
);

-- ===== 復習カード（忘却曲線 / SM-2） =====
create table if not exists public.cards (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  deck               text not null default '未分類',
  front              text not null,
  back               text not null,
  note               text,
  tags               text[] not null default '{}',
  source_material_id uuid references public.materials(id) on delete set null,
  source_page        int,
  origin             text not null default 'manual' check (origin in ('manual','material','question')),
  origin_ref         text,
  suspended          boolean not null default false,
  state              text    not null default 'new' check (state in ('new','learning','review','relearning')),
  due                timestamptz not null default now(),
  interval_days      numeric not null default 0,
  ease               numeric not null default 2.5,
  reps               int     not null default 0,
  lapses             int     not null default 0,
  last_reviewed_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.reviews (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  card_id       uuid not null references public.cards(id) on delete cascade,
  rating        int  not null check (rating between 1 and 4),
  elapsed_ms    int,
  prev_interval numeric,
  next_interval numeric,
  prev_ease     numeric,
  next_ease     numeric,
  reviewed_at   timestamptz not null default now()
);

-- ===== 過去問 =====
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  sitting_code    text not null references public.exam_sittings(code),
  section         text not null check (section in ('a1','a2','b')),
  number          int  not null,
  sub_label       text,
  body            text not null,
  choices         jsonb,
  correct         text,
  official_answer text,
  explanation     text,
  topic           text,
  siken_url       text,
  attribution     text not null,
  created_at      timestamptz not null default now(),
  unique (user_id, sitting_code, section, number)
);

create table if not exists public.question_attempts (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  question_id  uuid not null references public.questions(id) on delete cascade,
  selected     text,
  answer_text  text,
  self_score   int check (self_score between 0 and 100),
  correct      boolean,
  elapsed_ms   int,
  attempted_at timestamptz not null default now()
);

-- ===== インデックス =====
create index if not exists cards_due_idx           on public.cards (user_id, suspended, due);
create index if not exists cards_deck_idx          on public.cards (user_id, deck);
create index if not exists cards_front_pgroonga    on public.cards using pgroonga (front);
create unique index if not exists cards_origin_ref_uniq
  on public.cards (user_id, origin, origin_ref) where origin_ref is not null;
create index if not exists reviews_user_time_idx   on public.reviews (user_id, reviewed_at desc);
create index if not exists reviews_card_idx        on public.reviews (card_id, reviewed_at desc);
create index if not exists material_pages_user_idx on public.material_pages (user_id, material_id, page);
create index if not exists material_pages_pgroonga on public.material_pages using pgroonga (text);
create index if not exists questions_lookup_idx    on public.questions (user_id, section, sitting_code, number);
create index if not exists questions_body_pgroonga on public.questions using pgroonga (body);
create index if not exists attempts_user_time_idx  on public.question_attempts (user_id, attempted_at desc);
create index if not exists attempts_q_idx          on public.question_attempts (question_id, attempted_at desc);

-- ===== updated_at =====
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists materials_touch on public.materials;
create trigger materials_touch before update on public.materials
  for each row execute function public.touch_updated_at();
drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before update on public.cards
  for each row execute function public.touch_updated_at();

-- ===== RLS: 本人のデータだけ =====
alter table public.exam_sittings     enable row level security;
alter table public.materials         enable row level security;
alter table public.material_pages    enable row level security;
alter table public.cards             enable row level security;
alter table public.reviews           enable row level security;
alter table public.questions         enable row level security;
alter table public.question_attempts enable row level security;

drop policy if exists exam_sittings_read on public.exam_sittings;
create policy exam_sittings_read on public.exam_sittings
  for select to authenticated using (true);

drop policy if exists materials_own on public.materials;
create policy materials_own on public.materials
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists material_pages_own on public.material_pages;
create policy material_pages_own on public.material_pages
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cards_own on public.cards;
create policy cards_own on public.cards
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists reviews_own on public.reviews;
create policy reviews_own on public.reviews
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists questions_own on public.questions;
create policy questions_own on public.questions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists question_attempts_own on public.question_attempts;
create policy question_attempts_own on public.question_attempts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== 資料PDF用の非公開ストレージ =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', false, 104857600)
on conflict (id) do nothing;

drop policy if exists materials_objects_own on storage.objects;
create policy materials_objects_own on storage.objects
  for all to authenticated
  using (bucket_id = 'materials' and owner = auth.uid())
  with check (bucket_id = 'materials' and owner = auth.uid());
