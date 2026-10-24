-- Выполните этот скрипт в Supabase: Dashboard -> SQL Editor -> New query -> Run

create table if not exists voters (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  token text unique not null,
  created_at timestamptz default now()
);

create table if not exists videos (
  id uuid primary key default gen_random_uuid(),
  category text not null,          -- '01'..'14'
  title text not null,             -- имя номинанта / название ролика
  path text not null,              -- путь файла в Storage (bucket "videos")
  size bigint default 0,
  kind text not null default 'video', -- 'video' (Откат года) или 'image' (остальные номинации)
  created_at timestamptz default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  voter_id uuid references voters(id) on delete cascade,
  category text not null,
  video_id uuid references videos(id) on delete cascade,
  created_at timestamptz default now(),
  unique (voter_id, video_id)      -- нельзя проголосовать дважды за одного и того же; сколько голосов в номинации — решает server.js (VOTE_LIMITS)
);

create table if not exists admins (
  token text primary key,
  created_at timestamptz default now()
);

create index if not exists idx_votes_video on votes(video_id);
create index if not exists idx_videos_category on videos(category);

-- Сервер использует service_role-ключ, который обходит RLS.
-- Но включим RLS и запретим прямой доступ с ключом anon (клиентам API не нужен).
alter table voters enable row level security;
alter table videos enable row level security;
alter table votes  enable row level security;
alter table admins enable row level security;

-- Storage: bucket для видео и картинок (приватный, сервер отдаёт файлы через свой API)
insert into storage.buckets (id, name, public) values ('videos', 'videos', false)
on conflict (id) do nothing;


-- ============ ОБНОВЛЕНИЕ ДЛЯ ТЕХ, У КОГО БАЗА УЖЕ СОЗДАНА РАНЬШЕ ============
-- Если вы выполняли этот скрипт ДО появления картинок — просто выделите
-- и выполните только эти две строки (остальной скрипт повторно выполнять не нужно):
--
--   alter table videos add column if not exists kind text not null default 'video';
--   update videos set kind = case when category = '08' then 'video' else 'image' end;
-- =============================================================================


-- ============ ОБНОВЛЕНИЕ: НЕСКОЛЬКО ГОЛОСОВ В НОМИНАЦИИ ============
-- Для уже созданной базы: выполните ОДИН раз (SQL Editor -> New query -> Run).
-- Скрипт сам находит и удаляет ЛЮБОЕ старое ограничение «1 голос на номинацию»
-- (уникальность по voter_id + category), как бы оно ни называлось, и ставит новое:
-- «нельзя дважды за одного и того же номинанта». Сколько голосов в номинации — решает server.js.
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.votes'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey))
          = array['category','voter_id']
  loop
    execute format('alter table public.votes drop constraint %I', r.conname);
  end loop;
  -- на случай, если ограничение было создано как отдельный уникальный индекс
  for r in
    select i.indexname from pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'votes'
      and i.indexdef ilike '%unique%' and i.indexdef ilike '%(voter_id, category)%'
  loop
    execute format('drop index public.%I', r.indexname);
  end loop;
end $$;

alter table public.votes drop constraint if exists votes_voter_video_key;
alter table public.votes add constraint votes_voter_video_key unique (voter_id, video_id);

-- проверка: должно остаться ТОЛЬКО ограничение votes_voter_video_key (+ primary key)
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.votes'::regclass;
-- =====================================================================
