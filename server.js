// ГРЕЧКА 2026 — сервер: статика + API поверх Supabase (бесплатная онлайн-БД)
// Запуск: node server.js  (или `npm start` на Render/жёлтой обёртке)
require('dotenv').config();

// Страховка: ни одна необработанная сетевая ошибка (ECONNRESET у стримов/загрузок)
// не должна ронять весь процесс сервера. Логируем и живём дальше.
process.on('uncaughtException', (e) => console.error('uncaught:', e.message || e));
process.on('unhandledRejection', (e) => console.error('unrejection:', (e && e.message) || e));

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
  next();
});
// API всегда без кэша — иначе браузер покажет старые результаты/списки
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Статика с коротким кэшем: при выкатке обновления браузер подхватит его сам,
// «чёрных экранов из-за старого кэша» больше быть не может
app.use(express.static(__dirname, { index: 'index.html', maxAge: 0, etag: true }));

// SPA-навигация: любой неизвестный GET возвращаем index.html,
// чтобы F5 и прямые заходы работали на любой странице сайта
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.set('Cache-Control', 'no-cache'); // HTML всегда проверяется на свежесть
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
// Видео-номинации: 08 «Откат года», 10 «Кружок года». Остальные — картинки номинантов.
const VIDEO_CATS = ['08', '10'];
const isVideoCat = (n) => VIDEO_CATS.includes(n);

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
    // сортировка по названию важна для фото номинантов («ИМЯ 4» → индекс 4),
    // иначе порядок в списке «PP» зависит от порядка строк в БД и лица перепутаются.
    // Числа сравниваем как числа: «ИМЯ 10» должен идти после «ИМЯ 9», а не после «ИМЯ 1».
    Object.values(byCat).forEach(list => list.sort((a, b) => {
      const na = Number((a.title.match(/(\d+)\s*$/) || [])[1]);
      const nb = Number((b.title.match(/(\d+)\s*$/) || [])[1]);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.title).localeCompare(String(b.title), 'ru');
    }));
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
// Важно: 'error' на res убираем сразу после drain — иначе при десятках параллельных
// стримов браузер копит error-слушателей и Node пишет MaxListenersExceededWarning.
async function streamFile(req, res, signedUrl, headers, status) {
  const r = await fetch(signedUrl, { headers });
  if (!r.ok && r.status !== 206) throw new Error(`Supabase Storage ответил ${r.status}`);
  res.status(status);
  const reader = r.body.getReader();
  // если зритель закрыл вкладку/перемотал — обрываем стрим без падения процесса
  let aborted = false;
  const abortStream = () => { aborted = true; try { reader.cancel().catch(() => {}); } catch {} };
  req.on('close', abortStream);
  res.on('close', abortStream);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || aborted) break;
      if (!res.write(value)) {
        await new Promise((resolve, reject) => {
          const onError = (err) => reject(err);
          const onDrain = () => { res.removeListener('error', onError); resolve(); };
          res.once('drain', onDrain);
          res.once('error', onError);
        }).catch(() => { try { reader.cancel().catch(() => {}); } catch {} return; });
        if (aborted) break;
      }
    }
  } finally {
    req.removeListener('close', abortStream);
    res.removeListener('close', abortStream);
    try { reader.releaseLock(); } catch {}
    if (!res.writableEnded) res.end();
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
        return streamFile(req, res, signed.signedUrl, { Range: `bytes=${start}-${end}` }, 206);
      }
    }
    // без Range — стримим весь файл частями (не держим его целиком в памяти)
    const head = await fetchFile(signed.signedUrl, 'bytes=0-0');
    const cr = head.resp.headers.get('content-range');
    const total = cr ? Number(cr.split('/')[1]) : NaN;
    if (Number.isFinite(total)) res.setHeader('Content-Length', total);
    return streamFile(req, res, signed.signedUrl, {}, 200);
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
// Видео-номинации VIDEO_CATS принимают только видео, остальные — только картинки.
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const MAX_VIDEO = 200 * 1024 * 1024, MAX_IMAGE = 15 * 1024 * 1024;

// определяет реальный тип файла по сигнатуре (magic bytes) — надёжнее, чем по расширению имени
function sniffType(buf) {
  if (buf.length < 12) return null;
  const s = (o, n) => buf.subarray(o, o + n).toString('latin1');
  if (s(4, 4) === 'ftyp') return { kind: 'video', ext: 'mp4', mime: 'video/mp4' };            // MP4/MOV/M4V
  if (s(0, 4) === '\x1a\x45\xdf\xa3') return { kind: 'video', ext: 'webm', mime: 'video/webm' }; // WebM
  if (s(0, 4) === 'OggS') return { kind: 'video', ext: 'ogv', mime: 'video/ogg' };
  if (buf[0] === 0xFF && buf[1] === 0xD8) return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  if (s(0, 8) === '\x89PNG\r\n\x1a\n') return { kind: 'image', ext: 'png', mime: 'image/png' };
  if (s(0, 6).startsWith('GIF8')) return { kind: 'image', ext: 'gif', mime: 'image/gif' };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return { kind: 'image', ext: 'webp', mime: 'image/webp' };
  if (buf[0] === 0x42 && buf[1] === 0x4D) return { kind: 'image', ext: 'bmp', mime: 'image/bmp' };
  return null;
}

app.put('/api/admin/upload', async (req, res) => {
  let responded = false;
  const fail = (code, msg) => {
    if (responded) return;
    responded = true;
    if (!res.headersSent) res.status(code).json({ error: msg }); else res.end();
  };
  try {
    if (!await adminFrom(req)) return fail(401, 'Нет доступа');
    const category = String(req.query.category || '');
    const rawName = String(req.query.name || 'file');
    if (!/^\d{2}$/.test(category)) return fail(400, 'Некорректная номинация');
    const videoCat = VIDEO_CATS.includes(category);
    const limit = videoCat ? MAX_VIDEO : MAX_IMAGE;
    const chunks = [];
    let total = 0, aborted = false;
    req.on('data', c => {
      if (aborted) return;
      total += c.length;
      if (total > limit) {
        aborted = true;
        fail(413, `Файл слишком большой (максимум ${videoCat ? '200 МБ для видео' : '15 МБ для картинок'})`);
        req.resume(); // дочитываем и выбрасываем тело, чтобы соединение не рвалось
        return;
      }
      chunks.push(c);
    });
    req.on('error', () => { aborted = true; fail(400, 'Соединение оборвано при передаче'); });
    req.on('aborted', () => { aborted = true; req.resume(); });
    res.on('close', () => { if (!res.writableEnded) { aborted = true; req.resume(); } });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return fail(400, 'Пустой файл');
        const sniffed = sniffType(buf);
        if (!sniffed) return fail(400, 'Не удалось распознать файл. Поддерживаются JPG, PNG, GIF, WEBP, BMP и MP4, MOV, WEBM, M4V, OGV');
        if (sniffed.kind !== (videoCat ? 'video' : 'image')) {
          return fail(400, videoCat
            ? 'Этот файл — картинка, а в видео-номинации («Откат года», «Кружок года») можно загружать только видео'
            : 'Этот файл — видео, а в этой номинации можно загружать только картинки');
        }
        const id = uid();
        const filePath = `${category}/${id}.${sniffed.ext}`; // расширение из реального содержимого, а не из имени
        const { error: upErr } = await db.storage.from('videos')
          .upload(filePath, buf, { contentType: sniffed.mime, upsert: false });
        if (upErr) throw upErr;
        await db.from('videos').insert({ id, category, kind: sniffed.kind, title: rawName.replace(/\.[a-z0-9]+$/i, '').slice(0, 60), path: filePath, size: buf.length });
        responded = true;
        res.json({ ok: true, id });
      } catch (e) { console.error('upload:', e.message || e); fail(500, 'Supabase отклонил загрузку (' + (e.message || 'сеть') + '). Попробуйте ещё раз.'); }
    });
  } catch (e) { console.error(e); fail(500, 'Ошибка сервера'); }
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
      })).filter(v => v.choices.length), // без голосов показывать нечего — таблица «КТО ЧТО ВЫБРАЛ» только для проголосовавших
      videos: (videos || []).map(v => ({
        ...v, url: `/api/video/${v.id}`,
        voters: (votes || []).filter(t => t.video_id === v.id).map(t => nameOf[t.voter_id]).filter(Boolean)
      }))
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.listen(Number(PORT), () => console.log(`ГРЕЧКА 2026 запущена: http://localhost:${PORT}`));
