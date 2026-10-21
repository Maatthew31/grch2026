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
  title text not null,
  path text not null,              -- путь файла в Storage (bucket "videos")
  size bigint default 0,
  created_at timestamptz default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  voter_id uuid references voters(id) on delete cascade,
  category text not null,
  video_id uuid references videos(id) on delete cascade,
  created_at timestamptz default now(),
  unique (voter_id, category)      -- один голос на номинацию — гарантия на уровне БД
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

-- Storage: bucket для видео (приватный, сервер отдаёт подписанные ссылки)
insert into storage.buckets (id, name, public) values ('videos', 'videos', false)
on conflict (id) do nothing;
