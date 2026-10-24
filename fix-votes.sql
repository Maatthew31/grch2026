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
