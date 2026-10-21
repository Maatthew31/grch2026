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
app.use(express.static(__dirname, { index: 'index.html' }));

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
app.get('/api/videos', async (req, res) => {
  try {
    const voter = await voterFrom(req);
    if (!voter) return res.status(401).json({ error: 'Нужна регистрация' });
    const [{ data: videos }, { data: votes }] = await Promise.all([
      db.from('videos').select('id,category,title,size'),
      db.from('votes').select('video_id').eq('voter_id', voter.id)
    ]);
    const byCat = {};
    for (const v of videos) (byCat[v.category] ||= []).push({ id: v.id, title: v.title, size: v.size, url: `/api/video/${v.id}` });
    const myVotes = {};
    for (const vt of votes || []) {
      const vid = videos.find(v => v.id === vt.video_id);
      if (vid) myVotes[vid.category] = vid.id;
    }
    res.json({ videos: byCat, myVotes });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// стриминг видео из Supabase Storage (bucket "videos", private)
app.get('/api/video/:id', async (req, res) => {
  try {
    const { data: v } = await db.from('videos').select('path').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Видео не найдено' });
    const { data: signed, error } = await db.storage.from('videos').createSignedUrl(v.path, 60 * 60, { download: v.path.split('/').pop() });
    if (error) throw error;
    res.redirect(signed.signedUrl);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ---------- VOTING ----------
app.post('/api/vote', async (req, res) => {
  try {
    const voter = await voterFrom(req);
    if (!voter) return res.status(401).json({ error: 'Сначала представьтесь' });
    const { category, videoId } = req.body;
    const { data: video } = await db.from('videos').select('id,category').eq('id', videoId).maybeSingle();
    if (!video) return res.status(404).json({ error: 'Ролик не найден' });
    if (video.category !== category) return res.status(400).json({ error: 'Ролик не из этой номинации' });
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

// загрузка файла: PUT /api/admin/upload?category=01&name=file.mp4  (тело = сырые байты)
app.put('/api/admin/upload', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const category = String(req.query.category || '');
    const name = cleanName(req.query.name) || 'video.mp4';
    if (!/^\d{2}$/.test(category)) return res.status(400).json({ error: 'Некорректная номинация' });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return res.status(400).json({ error: 'Пустой файл' });
        const id = uid();
        const ext = (name.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase();
        const filePath = `${category}/${id}${ext}`;
        const { error: upErr } = await db.storage.from('videos')
          .upload(filePath, buf, { contentType: 'video/' + ext.slice(1), upsert: false });
        if (upErr) throw upErr;
        await db.from('videos').insert({ id, category, title: name.replace(/\.[a-z0-9]+$/i, ''), path: filePath, size: buf.length });
        res.json({ ok: true, id });
      } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/admin/overview', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const [{ data: voters }, { data: videos }, { data: votes }] = await Promise.all([
      db.from('voters').select('id,name'),
      db.from('videos').select('id,category,title,size'),
      db.from('votes').select('voter_id,category,video_id')
    ]);
    const nameOf = Object.fromEntries((voters || []).map(v => [v.id, v.name]));
    res.json({
      voters: (voters || []).map(v => ({
        name: v.name,
        choices: (votes || []).filter(t => t.voter_id === v.id).map(t => ({
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
