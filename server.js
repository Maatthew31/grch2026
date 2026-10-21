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
  next();
});
// API всегда без кэша — иначе браузер покажет старые результаты/списки
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // сайт может лежать на GitHub Pages и звать этот API с другого адреса —
  // разрешаем такие запросы и служебные заголовки с размерами картинок
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,X-Voter,X-Admin');
  res.set('Access-Control-Expose-Headers', 'Content-Range,X-Image-Width,X-Image-Height');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
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
const VIDEO_CATS = ['08', '10']; // «Откат года» и «Кружок года» — видео; остальные номинации — картинки
const isVideoCatN = (n) => VIDEO_CATS.includes(n);
const COVER_CAT = 'CV'; // служебная «номинация»: обложки номинаций (16:9), рисуются фоном в списке категорий

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
    // обложки не должны считаться «номинантами» в голосовании — выносим их отдельно
    const covers = {};
    for (const c of byCat[COVER_CAT] || []) {
      // в title хранится «01 1280x720» — номер номинации + реальные пиксели картинки,
      // чтобы клиент подстроил размер кнопок номинаций под пропорции обложки
      const m = String(c.title).match(/^(\d{2})(?: (\d+)x(\d+))?$/);
      if (!m) continue;
      covers[m[1]] = { url: c.url, w: +(m[2] || 0), h: +(m[3] || 0) }; // 0 = размеры не записаны — клиент узнает их по картинке
    }
    delete byCat[COVER_CAT];
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
    res.json({ videos: byCat, myVotes, covers });
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

// размеры изображения по «magic header» — без внешних библиотек.
// Нужны, чтобы кнопки номинаций автоматически подстраивались под пропорции обложки.
function imageDims(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) { // JPEG: идём по сегментам до SOFn
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xFF) { off++; continue; }
        const marker = buf[off + 1];
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        off += 2 + buf.readUInt16BE(off + 2);
      }
    }
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 }; }
      if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
    }
    if (buf.length > 10 && (buf.toString('ascii', 6, 10) === 'GIF8')) {
      return { width: buf.readUInt16LE(6 + 2), height: buf.readUInt16LE(6 + 4) };
    }
    // AVIF/HEIC/HEIF (ISO-BMFF): размеры лежат в боксе 'ispe'
    if (buf.length > 16 && buf.toString('ascii', 4, 8) === 'ftyp') {
      const at = buf.indexOf('ispe');
      if (at !== -1 && at + 12 <= buf.length) return { width: buf.readUInt32BE(at + 4), height: buf.readUInt32BE(at + 8) };
    }
  } catch { /* разбитый файл — считаем 16:9 */ }
  return null;
}

app.get('/api/video/:id', async (req, res) => {
  try {
    const { data: v } = await db.from('videos').select('path,kind,title').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Файл не найден' });
    const ext = (v.path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || (v.kind === 'image' ? 'jpg' : 'mp4');
    const mime = MIME[ext] || (v.kind === 'image' ? 'application/octet-stream' : 'video/mp4');
    const { data: signed, error } = await db.storage.from('videos').createSignedUrl(v.path, 60 * 60);
    if (error) throw error;

    // для картинок отдаём X-Image-Width/Height — так клиент узнаёт реальные
    // пропорции обложки и подстраивает под них размер кнопок номинаций
    if (v.kind === 'image') {
      try {
        const head = await fetchFile(signed.signedUrl, 'bytes=0-65535');
        const dims = imageDims(head.buf);
        if (dims && dims.width > 0 && dims.height > 0) {
          res.setHeader('X-Image-Width', dims.width);
          res.setHeader('X-Image-Height', dims.height);
        }
      } catch { /* не критично — клиент использует 16:9 по умолчанию */ }
    }

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
// Номинации '08' (Откат года) и '10' (Кружок года) принимают только видео, остальные — только картинки.
const MAX_VIDEO = 50 * 1024 * 1024, MAX_IMAGE = 15 * 1024 * 1024;

// определение реального типа файла по первым байтам (magic bytes),
// чтобы не зависеть от расширения в имени (Windows любит присылать .JPG/.MP4 с заглавными)
function sniffType(buf) {
  const b = buf.subarray(0, 16);
  const hex = Buffer.from(b).toString('hex');
  const str = Buffer.from(b.subarray(0, 12)).toString('latin1');
  if (b[0] === 0xFF && b[1] === 0xD8) return { ext: 'jpg', mime: 'image/jpeg', image: true, video: false };
  if (hex.startsWith('89504e47')) return { ext: 'png', mime: 'image/png', image: true, video: false };
  if (str.startsWith('GIF8')) return { ext: 'gif', mime: 'image/gif', image: true, video: false };
  if (str.startsWith('RIFF') && str.slice(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp', image: true, video: false };
  if (str.slice(4, 8) === 'ftyp') {
    const brand = str.slice(8, 12); // magic bytes решают: avif/heic — картинки, qt/mp4 — видео
    if (brand === 'avif' || brand === 'avis') return { ext: 'avif', mime: 'image/avif', image: true, video: false };
    if (/^(heic|heix|heim|heis|mif1|msf1|hei[cf])$/.test(brand)) return { ext: 'heic', mime: 'image/heic', image: true, video: false };
    return { ext: 'mp4', mime: 'video/mp4', image: false, video: true }; // mp4/mov/m4v
  }
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { ext: 'webm', mime: 'video/webm', image: false, video: true }; // matroska/webm
  if (str.slice(0, 4) === 'OggS') return { ext: 'ogv', mime: 'video/ogg', image: false, video: true };
  return { ext: '', mime: 'application/octet-stream', image: false, video: false };
}

// Собирает тело запроса в буфер с ограничением по размеру.
// Возвращает Promise<Buffer|null>; null — если ответ (413/400) уже отправлен.
function collectBody(req, res, limit) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const chunks = [];
    let total = 0, tooBig = false;
    req.on('data', c => {
      if (tooBig) return; // тело просто досчитываем и выбрасываем, req.destroy() ломает ответ
      total += c.length;
      if (total > limit) {
        tooBig = true;
        res.status(413).json({ error: `Файл слишком большой (максимум ${Math.round(limit / 1024 / 1024)} МБ)` });
        finish(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return finish(null);
      const buf = Buffer.concat(chunks);
      if (!buf.length) { res.status(400).json({ error: 'Пустой файл' }); return finish(null); }
      finish(buf);
    });
    req.on('error', () => finish(null));
  });
}

// Разбирает multipart/form-data: возвращает { file: Buffer|null, fields: {...} }.
// Нужен, чтобы обложки можно было грузить обычной HTML-формой (даже со статического
// сайта на GitHub Pages, где нет своего JS-кода для загрузки).
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { file: null, fields: {} };
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const CRLF = '\r\n\r\n';
  const out = { file: null, fields: {} };
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    let part = buf.subarray(start + boundary.length, next);
    if (part.length >= 2 && part[0] === 0x0D && part[1] === 0x0A) part = part.subarray(2); // после CRLF
    if (part.length >= 2 && part[part.length - 2] === 0x0D && part[part.length - 1] === 0x0A) part = part.subarray(0, part.length - 2); // до CRLF
    const sep = part.indexOf(CRLF);
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('latin1');
      const body = part.subarray(sep + 4);
      const nameM = /name="([^"]*)"/.exec(head);
      if (/filename="/.test(head)) { if (!out.file) out.file = body; }
      else if (nameM) out.fields[nameM[1]] = body.toString('utf8').trim();
    }
    start = next;
  }
  return out;
}

app.put('/api/admin/upload', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const category = String(req.query.category || '');
    const name = cleanName(req.query.name) || 'file';
    if (!/^\d{2}$/.test(category)) return res.status(400).json({ error: 'Некорректная номинация' });
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    const isVideoCat = isVideoCatN(category);
    const kind = isVideoCat ? 'video' : 'image';
    // расширение файла больше не является истиной — тип определим по содержимому (magic bytes),
    // иначе браузеры и Windows любят присылать .JPG вместо .jpg, Safari — без расширения и т.п.
    const buf = await collectBody(req, res, isVideoCat ? MAX_VIDEO : MAX_IMAGE);
    if (!buf) return; // 413/400 уже отправлен
    try {
      const real = sniffType(buf); // тип по содержимому, а не по имени файла
      if (isVideoCat && !real.video) return res.status(400).json({ error: `В видео-номинации можно загружать только видео (MP4, WebM, MOV)` });
      if (!isVideoCat && !real.image) return res.status(400).json({ error: `В эту номинацию можно загружать только картинки (JPG, PNG, GIF, WEBP)` });
      const id = uid();
      const filePath = `${category}/${id}.${real.ext}`;
      const { error: upErr } = await db.storage.from('videos')
        .upload(filePath, buf, { contentType: real.mime, upsert: false });
      if (upErr) throw upErr;
      await db.from('videos').insert({ id, category, kind, title: name.replace(/\.[a-z0-9]+$/i, ''), path: filePath, size: buf.length });
      res.json({ ok: true, id });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
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
    const buf = await collectBody(req, res, MAX_IMAGE);
    if (!buf) return; // 413/400 уже отправлен
    try {
      const real = sniffType(buf); // тип по содержимому, а не по расширению в имени (.JPG/.png — ок)
      if (!real.image) return res.status(400).json({ error: 'Можно загружать только картинки (JPG, PNG, GIF, WEBP)' });
      const id = uid();
      const filePath = `participants/${id}.${real.ext}`;
      const { error: upErr } = await db.storage.from('videos')
        .upload(filePath, buf, { contentType: real.mime, upsert: false });
      if (upErr) throw upErr;
      // title = «ИМЯ номер»: страница участников сортирует фото PP по числу в конце названия
      await db.from('videos').insert({ id, category: 'PP', kind: 'image', title: `${name} ${index + 1}`, path: filePath, size: buf.length });
      res.json({ ok: true, id, url: `/api/video/${id}` });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Обложка номинации (по умолчанию 16:9, но принимаются любые пропорции — кнопки
// номинаций автоматически подстраивают размер под реальную картинку).
// Хранится в Supabase Storage (bucket «videos», папка covers/) + запись в таблице videos
// с category='CV' и title='01 1280x720' — список «CV» отдаётся в /api/videos.
// Два способа загрузки (картинки всегда уходят на БД — Supabase Storage + Postgres):
//  • PUT  /api/admin/cover?category=01 — сырые байты файла, заголовок x-admin
//    (так грузит админка сайта);
//  • POST /api/admin/cover (multipart/form-data: category, token, file) — обычная
//    HTML-форма; ею можно загружать обложки даже со статического сайта на GitHub Pages.
const MAX_COVER = 8 * 1024 * 1024;

async function handleCoverUpload(req, res, rawBuf) {
  try {
    let category = String(req.query.category || '');
    let buf = rawBuf;
    if (req.method === 'POST') {
      const parsed = parseMultipart(buf, req.headers['content-type']);
      category = category || parsed.fields.category || '';
      buf = parsed.file;
      if (parsed.fields.token) req.headers['x-admin'] = parsed.fields.token; // форма не умеет заголовки
    }
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    if (!/^\d{2}$/.test(category)) return res.status(400).json({ error: 'Некорректная номинация' });
    if (!buf || !buf.length) return res.status(400).json({ error: 'Пустой файл' });
    const real = sniffType(buf);
    if (!real.image) return res.status(400).json({ error: 'Обложкой может быть только картинка (JPG, PNG, GIF, WEBP)' });
    const id = uid();
    const dims = imageDims(buf); // реальные пиксели обложки — кнопки подстроятся под них
    const filePath = `covers/${category}/${id}.${real.ext}`; // уникальный id — перезапись не конфликтует
    const { error: upErr } = await db.storage.from('videos')
      .upload(filePath, buf, { contentType: real.mime, upsert: false });
    if (upErr) throw upErr;
    // старые обложки этой номинации удаляются вместе с файлами из Storage
    const { data: old } = await db.from('videos').select('id,path').eq('category', COVER_CAT).like('title', category + '%');
    for (const o of old || []) {
      await db.storage.from('videos').remove([o.path]);
      await db.from('videos').delete().eq('id', o.id);
    }
    const coverTitle = dims ? `${category} ${dims.width}x${dims.height}` : category;
    await db.from('videos').insert({ id, category: COVER_CAT, kind: 'image', title: coverTitle, path: filePath, size: buf.length });
    res.json({ ok: true, id, url: `/api/video/${id}`, width: dims?.width || 16, height: dims?.height || 9 });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
}

app.put('/api/admin/cover', async (req, res) => {
  if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
  const buf = await collectBody(req, res, MAX_COVER);
  if (!buf) return; // 413/400 уже отправлен
  handleCoverUpload(req, res, buf);
});

app.post('/api/admin/cover', async (req, res) => {
  const buf = await collectBody(req, res, MAX_COVER + 64 * 1024); // + запас на служебные поля формы
  if (!buf) return;
  handleCoverUpload(req, res, buf);
});

app.delete('/api/admin/cover/:category', async (req, res) => {
  try {
    if (!await adminFrom(req)) return res.status(401).json({ error: 'Нет доступа' });
    const category = req.params.category;
    if (!/^\d{2}$/.test(category)) return res.status(400).json({ error: 'Некорректная номинация' });
    const { data: old } = await db.from('videos').select('id,path').eq('category', COVER_CAT).like('title', category + '%');
    for (const o of old || []) {
      await db.storage.from('videos').remove([o.path]);
      await db.from('videos').delete().eq('id', o.id);
    }
    res.json({ ok: true });
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
