// ГРЕЧКА 2026 — сервер: статика + API поверх Supabase (бесплатная онлайн-БД)
// Запуск: node server.js  (или `npm start` на Render/жёлтой обёртке)
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws'); // нужен для supabase-js на Node 20 (realtime не используется)

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,        // service_role key — НЕ показывать клиентам!
  ADMIN_PASSWORD = 'grechka2026',
  PORT = 3000
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Нужно задать SUPABASE_URL и SUPABASE_SERVICE_KEY в .env');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

const app = express();
app.use(express.json({ limit: '1mb' }));
// Uploads are streamed raw; make sure proxies never buffer the whole body.
app.use((req, res, next) => {
  if (req.method === 'PUT') req.setTimeout(600000, () => {});
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(__dirname, { index: 'index.html', maxAge: '1h' }));

// SPA-навигация: любой неизвестный GET возвращаем index.html,
// чтобы F5 и прямые заходы работали на любой странице сайта
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- helpers ----------
const uid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(24).toString('hex');
const cleanName = (raw) => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);

async function voterFrom(req) {
  const t = req.headers['x-voter'];
  if (!t) return null;
  const { data } = await db.from('voters').select('*').eq('token', t).maybeSingle();
  return data; // { id, name, token } или null
}
async function adminFrom(req) {
  const t = req.headers['x-admin'];
  if (!t) return false;
  const { data } = await db.from('admins').select('token').eq('token', t).maybeSingle();
  return !!data;
}

// ---------- AUTH ----------
// Регистрация по имени. Токен возвращается клиенту и хранится в localStorage.
app.post('/api/register', async (req, res) => {
  try {
    const name = cleanName(req.body.name);
    if (name.length < 2) return res.status(400).json({ error: 'Имя слишком короткое' });
    let { data } = await db.from('voters').select('*').eq('name', name).maybeSingle();
    if (!data) {
      const t = token();
      ({ data } = await db.from('voters')
        .insert({ id: uid(), name, token: t })
        .select().single());
    }
    res.json({ token: data.token, name: data.name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    if (String(req.body.password) !== String(ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    const t = token();
    await db.from('admins').insert({ token: t, created_at: new Date().toISOString() });
    res.json({ token: t });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ---------- PUBLIC DATA ----------
const VIDEO_CAT = '08'; // «Откат года» — единственная видео-номинация, остальные — картинки

app.get('/api/videos', async (req, res) => {
  try {
    const voter = await voterFrom(req);
    if (!voter) return res.status(401).json({ error: 'Нужна регистрация' });
    const [{ data: videos }, { data: votes }] = await Promise.all([
      db.from('videos').select('id,category,title,size,kind'),
      db.from('votes').select('video_id').eq('voter_id', voter.id)
    ]);
    const byCat = {};
    for (const v of videos) (byCat[v.category] ||= []).push({ id: v.id, title: v.title, size: v.size, kind: v.kind, url: `/api/video/${v.id}` });
    const myVotes = {};
    for (const vt of votes || []) {
      const vid = videos.find(v => v.id === vt.video_id);
      if (vid) myVotes[vid.category] = vid.id;
    }
    res.json({ videos: byCat, myVotes });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// отдача файла из Supabase Storage (bucket "videos", private) с поддержкой Range-запросов
// — это нужно, чтобы <video> мог перемотать и корректно показывал длительность
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
               jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

async function fetchFile(url, rangeHeader) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: rangeHeader ? { Range: rangeHeader } : {}, signal: ctrl.signal });
    if (!r.ok && r.status !== 206) throw new Error(`Supabase Storage ответил ${r.status}`);
    return { resp: r, buf: Buffer.from(await r.arrayBuffer()) };
  } finally { clearTimeout(timer); }
}

// Стриминг файла из Supabase Storage напрямую в ответ (без загрузки всего ролика в память).
// Экономит RAM на маленьком Render-сервисе и отдаёт видео быстрее.
async function streamFile(res, signedUrl, headers, status) {
  const r = await fetch(signedUrl, { headers });
  if (!r.ok && r.status !== 206) throw new Error(`Supabase Storage ответил ${r.status}`);
  res.status(status);
  const reader = r.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise((resolve, reject) => {
          res.once('drain', resolve);
          res.once('error', reject);
        }).catch(() => { try { reader.cancel(); } catch {} return; });
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
    res.end();
  }
}

app.get('/api/video/:id', async (req, res) => {
  try {
    const { data: v } = await db.from('videos').select('path,kind,title').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Файл не найден' });
    const ext = (v.path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || (v.kind === 'image' ? 'jpg' : 'mp4');
    const mime = MIME[ext] || (v.kind === 'image' ? 'application/octet-stream' : 'video/mp4');
    const { data: signed, error } = await db.storage.from('videos').createSignedUrl(v.path, 60 * 60);
    if (error) throw error;

    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      // узнаём полный размер файла маленьким range-запросом
      const probe = await fetchFile(signed.signedUrl, 'bytes=0-1');
      const cr = probe.resp.headers.get('content-range'); // e.g. "bytes 0-1/12345"
      const total = cr ? Number(cr.split('/')[1]) : NaN;
      if (Number.isFinite(total)) {
        const start = Number(range[1] || 0);
        const end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        if (start > end || start >= total) {
          res.setHeader('Content-Range', `bytes */${total}`);
          return res.status(416).end();
        }
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', end - start + 1);
        return streamFile(res, signed.signedUrl, { Range: `bytes=${start}-${end}` }, 206);
      }
    }
    // без Range — стримим весь файл частями (не держим его целиком в памяти)
    const head = await fetchFile(signed.signedUrl, 'bytes=0-0');
    const cr = head.resp.headers.get('content-range');
    const total = cr ? Number(cr.split('/')[1]) : NaN;
    if (Number.isFinite(total)) res.setHeader('Content-Length', total);
    return streamFile(res, signed.signedUrl, {}, 200);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Ошибка отдачи файла' });
    else res.destroy();
  }
});

// ---------- VOTING ----------
app.post('/api/vote', async (req, res) => {
  try {
    const voter = await voterFrom(req);
    if (!voter) return res.status(401).json({ error: 'Сначала представьтесь' });
    const { category, videoId } = req.body;
    const { data: video } = await db.from('videos').select('id,category').eq('id', videoId).maybeSingle();
    if (!video) return res.status(404).json({ error: 'Номинант не найден' });
    if (video.category !== category) return res.status(400).json({ error: 'Номинант не из этой номинации' });
    const { data: existing } = await db.from('votes').select('video_id')
      .eq('voter_id', voter.id).eq('category', category).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Вы уже голосовали в этой номинации', videoId: existing.video_id });
    await db.from('votes').insert({ id: uid(), voter_id: voter.id, category, video_id: videoId });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ---------- ADMIN ----------
app.patch('/api/admin/videos/:id', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const title = cleanName(req.body.title) || 'Без названия';
    await db.from('videos').update({ title }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// удаление конкретного голоса (зритель + номинация) — запись удаляется из БД,
// после этого человек может проголосовать в этой номинации заново
app.delete('/api/admin/votes/:voterId/:category', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const { voterId, category } = req.params;
    if (!/^\d{2}$/.test(category)) return res.status(400).json({ error: 'Некорректная номинация' });
    const { error } = await db.from('votes').delete().eq('voter_id', voterId).eq('category', category);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/admin/videos/:id', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const { data: v } = await db.from('videos').select('path').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Видео не найдено' });
    await db.from('votes').delete().eq('video_id', req.params.id);
    await db.storage.from('videos').remove([v.path]);
    await db.from('videos').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// загрузка файла: PUT /api/admin/upload?category=01&name=file.png  (тело = сырые байты)
// Номинация '08' (Откат года) принимает только видео, остальные — только картинки.
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const MAX_VIDEO = 200 * 1024 * 1024, MAX_IMAGE = 15 * 1024 * 1024;

app.put('/api/admin/upload', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const category = String(req.query.category || '');
    const name = cleanName(req.query.name) || 'file';
    if (!/^\d{2}$/.test(category)) return res.status(400).json({ error: 'Некорректная номинация' });
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    const isVideoCat = category === VIDEO_CAT;
    const kind = isVideoCat ? 'video' : 'image';
    if (isVideoCat && !VIDEO_EXT.includes(ext)) return res.status(400).json({ error: `В «Откат года» можно загружать только видео (${VIDEO_EXT.join(', ')})` });
    if (!isVideoCat && !IMAGE_EXT.includes(ext)) return res.status(400).json({ error: `В эту номинацию можно загружать только картинки (${IMAGE_EXT.join(', ')})` });
    const chunks = [];
    let total = 0;
    const limit = isVideoCat ? MAX_VIDEO : MAX_IMAGE;
    req.on('data', c => {
      total += c.length;
      if (total > limit) {
        res.status(413).json({ error: `Файл слишком большой (максимум ${isVideoCat ? '200 МБ для видео' : '15 МБ для картинок'})` });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return res.status(400).json({ error: 'Пустой файл' });
        const id = uid();
        const filePath = `${category}/${id}.${ext}`;
        const mime = MIME[ext] || 'application/octet-stream';
        const { error: upErr } = await db.storage.from('videos')
          .upload(filePath, buf, { contentType: mime, upsert: false });
        if (upErr) throw upErr;
        await db.from('videos').insert({ id, category, kind, title: name.replace(/\.[a-z0-9]+$/i, ''), path: filePath, size: buf.length });
        res.json({ ok: true, id });
      } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// фото номинанта для страницы «УЧАСТНИКИ»: PUT /api/admin/participant-photo?index=N
const PARTICIPANT_COUNT = 8;
app.put('/api/admin/participant-photo', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const index = Number(req.query.index);
    if (!Number.isInteger(index) || index < 0 || index >= PARTICIPANT_COUNT) return res.status(400).json({ error: 'Некорректный номинант' });
    const name = cleanName(req.query.name) || `participant-${index + 1}`;
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (!IMAGE_EXT.includes(ext)) return res.status(400).json({ error: `Можно загружать только картинки (${IMAGE_EXT.join(', ')})` });
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > MAX_IMAGE) {
        res.status(413).json({ error: 'Файл слишком большой (максимум 15 МБ)' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return res.status(400).json({ error: 'Пустой файл' });
        const id = uid();
        const filePath = `participants/${id}.${ext}`;
        const { error: upErr } = await db.storage.from('videos')
          .upload(filePath, buf, { contentType: MIME[ext] || 'application/octet-stream', upsert: false });
        if (upErr) throw upErr;
        await db.from('videos').insert({ id, category: 'PP', kind: 'image', title: name.replace(/\.[a-z0-9]+$/i, ''), path: filePath, size: buf.length });
        res.json({ ok: true, id, url: `/api/video/${id}` });
      } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/admin/overview', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const [{ data: voters }, { data: videos }, { data: votes }] = await Promise.all([
      db.from('voters').select('id,name'),
      db.from('videos').select('id,category,title,size,kind'),
      db.from('votes').select('voter_id,category,video_id')
    ]);
    const nameOf = Object.fromEntries((voters || []).map(v => [v.id, v.name]));
    res.json({
      voters: (voters || []).map(v => ({
        name: v.name,
        choices: (votes || []).filter(t => t.voter_id === v.id).map(t => ({
          voterId: v.id,
          category: t.category,
          title: videos?.find(x => x.id === t.video_id)?.title || '?'
        }))
      })),
      videos: (videos || []).map(v => ({
        ...v, url: `/api/video/${v.id}`,
        voters: (votes || []).filter(t => t.video_id === v.id).map(t => nameOf[t.voter_id]).filter(Boolean)
      }))
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.listen(Number(PORT), () => console.log(`ГРЕЧКА 2026 запущена: http://localhost:${PORT}`));
