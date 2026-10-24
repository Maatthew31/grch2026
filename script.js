(() => {
  // Участники. Фото номинантов можно загружать прямо из админки (вкладка ФОТО).
  let participants = [
    { name: 'КУРМАН', role: 'Номинант', img: 'assets/person-1.svg' },
    { name: 'ЛЕХА', role: 'Номинант', img: 'assets/person-2.svg' },
    { name: 'ВОВА', role: 'Номинант', img: 'assets/person-3.svg' },
    { name: 'ИГОРЬ', role: 'Номинант', img: 'assets/person-4.svg' },
    { name: 'РИЗЕН', role: 'Номинант', img: 'assets/person-5.svg' },
    { name: 'ГЭС', role: 'Номинант', img: 'assets/person-6.svg' },
    { name: 'АНТОН', role: 'Номинант', img: 'assets/person-7.svg' },
    { name: 'МАКСОН', role: 'Номинант', img: 'assets/person-8.svg' },
    { name: 'НОВЫЙ', role: 'Номинант', img: 'assets/person-9.svg' } // ← 9-й человек: замените НОВЫЙ на настоящее имя
  ];
  try {
    const saved = JSON.parse(localStorage.getItem('grechka_participants'));
    if (Array.isArray(saved)) {
      saved.slice(0, participants.length).forEach((p, i) => { if (p && p.img) participants[i] = { ...participants[i], ...p }; });
    }
  } catch { /* ignore */ }

  const categories = [
    ['01','Король грч все','Главный титул вечера. Без объяснений. Просто король.'],
    ['02','Человек мем года','Человек, который стал мемом раньше, чем успел это осознать.'],
    ['04','Провал года','Когда всё шло по плану. К сожалению, план был ужасным.'],
    ['05','Киберкотлет года','Реакция быстрее, чем загрузка меню. Навык вне человеческих норм.'],
    ['06','Дед инсайд года','Самый глубокий уровень погружения в собственные мысли.'],
    ['07','Дача года','Там, где отдых заканчивается через семь минут после приезда.'],
    ['08','Откат года','Шаг назад, который почему-то заслужил отдельную премию.'],
    ['09','Выход года','Появление, уход или выход из ситуации — всё решает стиль.'],
    ['10','Кружок года','Сообщение, которое нельзя было просто написать текстом.'],
    ['11','Фотка года','Один кадр. Тысяча вопросов. Ноль объяснений.'],
    ['12','Сырный соус года','Категория, которую история будет ещё долго пытаться понять.'],
    ['13','Король пунктуальности','Человек, который приходит вовремя. Иногда даже раньше.'],
    ['14','Игра года','Главная игра года по версии комиссии, которой никто не видел.']
  ].map(([n,title,desc]) => ({n,title,desc}));
  const CAT_COUNT = categories.length; // 13 номинаций (номинация «03» удалена)
  // Сколько голосов у зрителя в номинации (должно совпадать с VOTE_LIMITS в server.js; по умолчанию 1).
  // Откат года (08), Кружок года (10), Игра года (14) — 3; Провал года (04), Выход года (09) и Фотка года (11) — 2; остальные — 1.
  const VOTE_LIMITS = { '04': 2, '08': 3, '09': 2, '10': 3, '11': 3, '14': 3 };
  const limitOf = (n) => VOTE_LIMITS[n] || 1;
  const TOTAL_VOTES = categories.reduce((n, c) => n + limitOf(c.n), 0);
  const votesIn = (n) => { const v = myVotes[n]; return Array.isArray(v) ? v : (v ? [v] : []); };

  const app = document.getElementById('app');
  // Восстановление сцены после перезагрузки страницы: адрес вида #scene/номер_номинации
  const SCENES = ['intro', 'login', 'participants', 'categories', 'categoryDetail'];
  const parseHash = () => {
    if (location.hash === '#admin') return { admin: true };
    const [h, n] = location.hash.replace(/^#\/?/, '').split('/');
    if (!SCENES.includes(h)) return {};
    return { scene: h, cat: /^\d{2}$/.test(n || '') ? n : null };
  };
  const restored = parseHash();
  let scene = restored.admin ? 'admin' : (restored.scene || 'intro');
  let selected = categories.find(c => c.n === restored.cat) || categories[0];
  let direction = 'forward';
  const sceneHash = (s) => s === 'admin' ? '#admin' : s === 'intro' ? '#/' : '#' + s + (s === 'categoryDetail' ? '/' + selected.n : '');

  const store = {
    get voter() { try { return JSON.parse(localStorage.getItem('grechka_voter')); } catch { return null; } },
    set voter(v) { v ? localStorage.setItem('grechka_voter', JSON.stringify(v)) : localStorage.removeItem('grechka_voter'); },
    get admin() { return sessionStorage.getItem('grechka_admin'); },
    set admin(t) { t ? sessionStorage.setItem('grechka_admin', t) : sessionStorage.removeItem('grechka_admin'); }
  };
  let myVotes = {};      // category -> [videoId, ...] (голосов может быть несколько)
  let videosByCat = {};  // category -> [video]
  let coversByCat = {};  // category -> url обложки 16:9 (фон кнопки в списке номинаций)

  async function api(path, { method = 'GET', body, admin = false } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (admin) headers['x-admin'] = store.admin || '';
    else if (store.voter) headers['x-voter'] = store.voter.token;
    let r;
    try {
      r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('Сервер не отвечает. Подождите 10–20 секунд и повторите — бесплатный Render «просыпается» после простоя.');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || `Ошибка запроса (${r.status})`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  // Глобальный перехват ошибок: если в обработчике клика что-то упало — показываем
  // понятное сообщение, а не «тихий» чёрный/сломанный экран.
  window.addEventListener('unhandledrejection', (e) => { console.error('[grechka]', e.reason); });
  window.addEventListener('error', (e) => { console.error('[grechka]', e.message); });
  // Фото участников: берём из публичного /api/participants (вход не нужен), поэтому лица
  // видны сразу — и новому гостю, и без обновления страницы. Функцию можно вызывать повторно.
  const preloadImg = (url) => new Promise(res => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = url; });
  async function loadParticipantPhotos() {
    try {
      const d = await api('/api/participants');
      const pp = d.photos || [];
      let changed = false;
      for (const item of pp) {
        const m = item.title.match(/(\d+)\s*$/); // имя вида «ИМЯ 4» — индекс номинанта в конце
        if (!m) continue;
        const i = Number(m[1]) - 1;
        if (i >= 0 && i < participants.length && participants[i].img !== item.url) { participants[i].img = item.url; changed = true; }
      }
      if (!changed) return;
      try { localStorage.setItem('grechka_participants', JSON.stringify(participants)); } catch { /* ignore */ }
      // подгружаем картинки заранее, чтобы лица не «выскакивали» по одному
      await Promise.all(participants.map(p => preloadImg(p.img)));
      // в админке НЕ перерисовываем всё заново — иначе вкладка сбрасывается на «ОБЛОЖКИ»
      if (scene === 'participants') render();
    } catch { /* сервер спит или недоступен — останутся картинки по умолчанию */ }
  }
  loadParticipantPhotos();

  // обложка: { url, w, h } (старый формат — просто строка url, считаем 16:9)
  // размеры обложки: «1280x720» из строки title БД либо из объекта {url,w,h};
  // если реальных пикселей нет — честные пропорции 16:9 (1280×720), а НЕ «16 на 9 пикселей»
  const parseCoverDims = (s) => { const m = String(s || '').match(/^(?:.*?\s)?(\d+)x(\d+)$/); return m ? { w: +m[1], h: +m[2] } : null; };
  const coverDims = (c) => {
    if (!c) return null;
    if (typeof c === 'string') { const d = parseCoverDims(c) || { w: 1280, h: 720 }; return { url: '', ...d }; }
    const w = +c.w > 0 && +c.h > 0 ? +c.w : 1280, h = +c.w > 0 && +c.h > 0 ? +c.h : 720;
    return { url: c.url, w, h };
  };

  async function loadVideos() {
    try {
      const d = await api('/api/videos');
      videosByCat = d.videos; myVotes = d.myVotes; coversByCat = d.covers || {};
      // если в БД размеры обложек не записаны (w/h = 0) — узнаём настоящие пиксели по картинкам
      for (const [n, cv] of Object.entries(coversByCat)) {
        if (cv && !(cv.w > 0 && cv.h > 0)) {
          const img = new Image();
          img.onload = () => { cv.w = img.naturalWidth || 1280; cv.h = img.naturalHeight || 720; };
          img.src = cv.url;
        }
      }
    } catch (e) {
      if (e.status === 401) { store.voter = null; navigate('login'); throw e; }
      // Сервер недоступен (сайт открыт как статика с GitHub Pages).
      // Голосовать нельзя, но обложки номинаций можно показать — тянем их
      // напрямую из Supabase (картинки по-прежнему хранятся на БД).
      videosByCat = {}; myVotes = {};
      await loadCoversFromSupabaseDirect();
    }
  }

  // ---------- ОБЛОЖКИ ПРЯМО ИЗ SUPABASE (режим без Node-сервера) ----------
  // Если сайт открыт как чистая статика (GitHub Pages) и /api недоступен,
  // обложки читаются напрямую из Supabase: список — из таблицы videos
  // (category='CV'), сами картинки — из публичного bucket 'covers'.
  // Ключи (URL проекта + service_role/anon) сохраняются в localStorage
  // в админке (вкладка «ОБЛОЖКИ» → «Режим GitHub Pages») или на covers.html.
  function sbCfg() {
    try { return JSON.parse(localStorage.getItem('grechka_sb') || 'null'); } catch { return null; }
  }
  const sbBase = (u) => String(u || '').trim().replace(/\/+$/, '');
  async function loadCoversFromSupabaseDirect() {
    const cfg = sbCfg();
    if (!cfg || !sbBase(cfg.u) || !String(cfg.k || '').trim()) return; // ключей нет — номинации без обложек
    const base = sbBase(cfg.u), key = String(cfg.k).trim();
    let rows = [];
    try {
      const r = await fetch(`${base}/rest/v1/videos?select=id,title,path,size,created_at&category=eq.CV&order=created_at.asc`,
        { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      if (!r.ok) return;
      rows = await r.json();
    } catch { return; }
    const out = {};
    for (const v of rows) { // строки по created_at.asc — последние перезаписывают старые
      const m = String(v.title || '').match(/^(\d{2})(?:\s+(\d+)x(\d+))?$/);
      if (!m) continue;
      const path = String(v.path || '').split('/').map(encodeURIComponent).join('/');
      let w = +(m[2] || 0), h = +(m[3] || 0);
      if (!(w > 0 && h > 0)) { // размеры не записаны в title — узнаём настоящие пиксели по картинке
        try {
          const probe = await new Promise((res, rej) => {
            const im = new Image(); im.onload = () => res(im); im.onerror = rej;
            im.src = `${base}/storage/v1/object/public/covers/${path}`;
          });
          w = probe.naturalWidth || 1280; h = probe.naturalHeight || 720;
        } catch { w = 1280; h = 720; }
      }
      out[m[1]] = { url: `${base}/storage/v1/object/public/covers/${path}`, w, h };
    }
    coversByCat = out;
  }
  const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + ' ГБ' : (b / 1e6).toFixed(1) + ' МБ';
  const VIDEO_CATS = ['08', '10']; // «Откат года» и «Кружок года» — ролики; остальные номинации — картинки номинантов
  const isVideoCat = (n) => VIDEO_CATS.includes(n);

  const esc = (value) => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function shell(content, label) {
    // Страховка от «чёрного экрана»: перед каждой перерисовкой убираем все
    // оставшиеся <main> (старые узлы из анимаций предыдущих переходов).
    app.querySelectorAll('main').forEach(m => m.remove());
    app.innerHTML = `
      <main class="app ${scene} ${direction === 'back' ? 'backScene' : ''}">
        <div class="background"><div class="light l1"></div><div class="light l2"></div><div class="vignette"></div></div>
        <header class="topbar">${scene !== 'intro' ? '<button class="back" id="back" aria-label="Назад">←</button>' : ''}<span>ГРЕЧКА <b>2026</b></span><i></i><small>${label}</small></header>
        ${content}
      </main>`;
    document.getElementById('back')?.addEventListener('click', () => {
      // Кнопка «назад» = шаг по ИСТОРИИ САЙТА. Ходим по собственному стеку сцен,
      // а не history.back(): так назад работает и внутри админки (#admin — одна
      // история-запись), и не зависит от внешних hashchange-событий.
      const prev = sceneStack.length > 1 ? sceneStack[sceneStack.length - 2] : 'intro';
      goBack(prev);
    });
  }

  // ---------- НАВИГАЦИЯ ИСТОРИЕЙ ----------
  // Каждая сцена — запись в истории браузера (pushState). Поэтому:
  //  • браузерная кнопка «назад» возвращает на ПРЕДЫДУЩУЮ страницу сайта, а не на главную;
  //  • F5 остаётся на той же странице;
  //  • анимация сама понимает, вперёд идём или назад.
  // sceneStack — собственный стек посещённых сцен: по нему ходит кнопка «←»
  // (в том числе внутри админки, где история одна, и после прямых заходов по hash).
  const sceneStack = [scene];
  let navToken = null;
  window.addEventListener('popstate', (e) => {
    const target = e.state && SCENES.includes(e.state.scene) ? e.state.scene : 'intro';
    if (target === scene) return;
    const back = !navToken || (SCENES.indexOf(target) < SCENES.indexOf(navToken));
    navToken = target;
    // синхронизируем стек: если вернулись на уже посещённую сцену — срезаем хвост
    const idx = sceneStack.lastIndexOf(target);
    if (idx >= 0) sceneStack.length = idx + 1; else sceneStack.push(target);
    navigate(target, back ? 'back' : 'forward');
  });
  const pushHistory = (s) => {
    navToken = s;
    history.pushState({ scene: s }, '', sceneHash(s));
    const idx = sceneStack.lastIndexOf(s);
    if (idx >= 0) sceneStack.length = idx + 1; else sceneStack.push(s);
  };
  function goBack(prev) {
    const idx = sceneStack.lastIndexOf(prev);
    if (idx >= 0) sceneStack.length = idx + 1;
    // обновляем адрес без новой записии истории (запись уберёт popstate-обработчик ниже,
    // если пользователь позже сам нажмёт браузерную «назад»)
    navigate(prev, 'back');
  }

  // Плавный переход: новая сцена въезжает поверх. Анимация ставится на <main>
  // целиком (вместе с фоном и шапкой) — анимируются только GPU-дешёвые
  // transform/opacity, поэтому нет микрофризов. Старый <main> shell() убирает сам,
  // так что «чёрного экрана» из-за зависшей анимации быть не может в принципе.
  let animating = false;
  const EASE = 'cubic-bezier(.33,1,.68,1)';
  function animateIn(el, dir) {
    el.classList.remove('sceneIn'); // анимируем только через WAAPI, без двойных эффектов
    el.style.willChange = 'transform, opacity';
    return el.animate(
      [{ opacity: 0, transform: `translateX(${dir === 'back' ? -42 : 42}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: EASE, fill: 'both' }
    ).finally(() => { el.style.willChange = ''; });
  }
  async function navigate(next, dir = 'forward') {
    if (next === scene && app.querySelector('main')) return;
    animating = true;
    direction = dir;
    scene = next;
    window.scrollTo(0, 0);
    render(); // shell() сам убирает все старые <main> — гарантированно один узел
    const newEl = app.querySelector('main');
    animating = false;
    if (newEl) { try { await animateIn(newEl, dir); } catch { /* ignore */ } }
  }

  function renderIntro() {
    shell(`
      <section class="intro sceneIn">
        <div class="heroKicker">ЕЖЕГОДНАЯ ЦЕРЕМОНИЯ · 2026</div>
        <div class="heroLogo">ГРЕЧКА<span>2026</span></div>
        <div class="heroRule"><span></span><b>THE MOST IMPORTANT NIGHT OF THE YEAR</b><span></span></div>
        <p>Премия за достижения, которые никто не просил совершать.</p>
        <button class="luxButton" id="enter"><span>ВОЙТИ В ЦЕРЕМОНИЮ</span></button>
        <div class="introFoot">ЛИСТАТЬ НЕ ОБЯЗАТЕЛЬНО <em>·</em> LKM — ЛЕВАЯ КНОПКА МЫШИ <em>·</em> <a class="adminLink" href="#admin">АДМИН</a></div>
      </section>`, 'ПРОЛОГ');
    document.getElementById('enter').onclick = () => { const t = store.voter ? 'participants' : 'login'; pushHistory(t); navigate(t); };
  }

  function portrait(p) {
    return `<div class="hallPortrait"><img src="${esc(p.img)}" alt=""><div><b>${esc(p.name)}</b><small>${esc(p.role)}</small></div></div>`;
  }

  function personCard(p, i) {
    return `<article class="person"><div class="personImage"><img src="${esc(p.img)}" alt="${esc(p.name)}"><span>0${i+1}</span></div><div class="personName"><b>${esc(p.name)}</b><small>${esc(p.role)}</small></div></article>`;
  }

  function renderParticipants() {
    if (!renderParticipants.fetched) { renderParticipants.fetched = true; loadParticipantPhotos(); }
    shell(`
      <section class="participants sceneIn">
        <div class="sectionHead"><div class="heroKicker">ПЕРЕД НАЧАЛОМ</div><h1>ЛИЦА<br><em>ЦЕРЕМОНИИ</em></h1><p>Те самые люди, которым каким-то образом удалось попасть в историю Гречки.</p></div>
        <div class="peopleGrid">${participants.map(personCard).join('')}</div>
        <div class="centerAction"><button class="luxButton" id="openCategories"><span>ОТКРЫТЬ НОМИНАЦИИ</span><b>→</b></button></div>
      </section>`, 'УЧАСТНИКИ');
    document.getElementById('openCategories').onclick = () => { selected = categories[0]; pushHistory('categories'); navigate('categories'); };
  }

  function renderLogin() {
    shell(`
      <section class="login sceneIn">
        <div class="heroKicker">ПЕРЕД ГОЛОСОВАНИЕМ</div>
        <h1 class="loginTitle">КАК ВАС<br><em>ЗОВУТ?</em></h1>
        <p class="loginNote">Имя нужно, чтобы засчитать ваши голоса. Голос в каждой номинации отдаётся один раз (в некоторых номинациях — несколько, за разных номинантов) — изменить выбор будет нельзя.</p>
        <div class="loginForm">
          <input id="voterName" class="textInput" maxlength="40" placeholder="Имя или ник" autocomplete="off">
          <button class="luxButton" id="voterGo"><span>ПРОДОЛЖИТЬ</span><b>→</b></button>
        </div>
        <div class="formError" id="loginError"></div>
      </section>`, 'ПРЕДСТАВЬТЕСЬ');
    const input = document.getElementById('voterName');
    const err = document.getElementById('loginError');
    const go = async () => {
      err.textContent = '';
      try {
        const d = await api('/api/register', { method: 'POST', body: { name: input.value } });
        store.voter = { token: d.token, name: d.name };
        await Promise.race([loadParticipantPhotos(), new Promise(r => setTimeout(r, 4000))]); // лица готовы к показу
        pushHistory('participants'); navigate('participants');
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('voterGo').onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    input.focus();
  }

  async function renderCategories() {
    try { await loadVideos(); } catch { return; }
    // Обложка 16:9 фоном кнопки + затемняющий градиент, чтобы текст читался всегда.
    const rows = categories.map(c => {
      const got = votesIn(c.n).length, lim = limitOf(c.n);
      const done = got >= lim;           // все голоса в этой номинации отданы
      const partial = got > 0 && !done;  // часть голосов отдана (в номинациях с несколькими голосами)
      const cv = coverDims(coversByCat[c.n]);
      // высота кнопки = ширина списка × пропорции загруженной картинки —
      // размер кнопок автоматически подстраивается под размер обложки, картинка целиком (без обрезки)
      const ratio = cv && cv.w > 0 && cv.h > 0 ? cv.h / cv.w : 9 / 16;
      const vars = cv ? `--cover:url('${esc(cv.url)}');--rowH:calc(var(--rowW,100%) * ${ratio.toFixed(5)})` : '';
      return `<button class="categoryRow ${selected.n === c.n ? 'active' : ''} ${done ? 'done' : ''} ${partial ? 'partial' : ''} ${cv ? 'hasCover' : ''}" data-category="${c.n}" style="${vars}"><span class="crNum">${c.n}</span><strong>${esc(c.title)}</strong>${got ? `<em class="voteBadge">${done ? '✓ ГОЛОС ОТДАН' : '✓ ' + got + ' ИЗ ' + lim}</em>` : ''}<i>${done ? '✓' : lim > 1 ? got + '/' + lim : '↗'}</i></button>`;
    }).join('');
    const doneCount = categories.reduce((n, c) => n + Math.min(votesIn(c.n).length, limitOf(c.n)), 0);
    shell(`
      <section class="categories sceneIn">
        <div class="sectionHead categoryHead"><div class="heroKicker">ГРЕЧКА 2026 · ${CAT_COUNT} КАТЕГОРИЙ · ВАШИ ГОЛОСА: ${doneCount}/${TOTAL_VOTES}</div><h1>НОМИНАЦИИ</h1><p>Выберите категорию. Судьба человечества подождёт.</p></div>
        <div class="categoryLayout">
          <div class="categoryList" id="categoryList">${rows}</div>
          <aside class="categoryFeature" id="categoryFeature"><div class="cfCover" id="cfCover"></div><div class="featureInner" id="featureInner"><div class="featureTop"><span>${selected.n}</span><small>НОМИНАЦИЯ</small></div><h2>${esc(selected.title)}</h2><p>${esc(selected.desc)}</p><div class="featureRule"></div><button class="luxButton" id="openCategory"><span>ОТКРЫТЬ НОМИНАЦИЮ</span><b>→</b></button></div></aside>
        </div>
      </section>`, 'НОМИНАЦИИ');

    const updateFeatureCover = () => {
      const cf = document.getElementById('cfCover');
      if (!cf) return;
      const cv = coverDims(coversByCat[selected.n]);
      cf.style.backgroundImage = cv ? `url('${cv.url}')` : '';
      cf.classList.toggle('on', !!cv);
    };
    updateFeatureCover();

    // Окошко «Открыть номинацию» ставится напротив ВЫБРАННОЙ кнопки, а не первой.
    const positionFeature = () => {
      const feature = document.getElementById('categoryFeature');
      const inner = document.getElementById('featureInner');
      if (!feature || !inner) return;
      const list = document.getElementById('categoryList');
      const active = list && list.querySelector(`.categoryRow[data-category="${selected.n}"]`);
      if (!list || !active || window.innerWidth <= 900) {
        // мобильная раскладка / нет кнопки — обычное sticky-поведение
        feature.classList.remove('floating');
        inner.style.transform = '';
        return;
      }
      feature.classList.add('floating');
      const listRect = list.getBoundingClientRect();
      const rowRect = active.getBoundingClientRect();
      const fH = inner.offsetHeight || 370;
      let top = rowRect.top - listRect.top - (fH - rowRect.height) / 2;
      // не вылезаем за границы списка
      top = Math.max(0, Math.min(top, listRect.height - fH));
      if (!inner.dataset.placed) { // первая расстановка — мгновенно, без «заезда» сверху
        inner.style.transition = 'none';
        inner.style.transform = `translateY(${top}px)`;
        void inner.offsetHeight;
        inner.style.transition = '';
        inner.dataset.placed = '1';
      } else inner.style.transform = `translateY(${top}px)`;
    };

    const updateCategory = (number) => {
      const next = categories.find(c => c.n === number);
      if (!next) return;
      selected = next;
      document.querySelectorAll('.categoryRow').forEach(row => row.classList.toggle('active', row.dataset.category === selected.n));
      const feature = document.getElementById('categoryFeature');
      feature.querySelector('.featureTop span').textContent = selected.n;
      feature.querySelector('h2').textContent = selected.title;
      feature.querySelector('p').textContent = selected.desc;
      updateFeatureCover();
      positionFeature();
      const inner = document.getElementById('featureInner');
      inner.animate([
        { opacity: .55 },
        { opacity: 1 }
      ], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
    };

    document.querySelectorAll('.categoryRow').forEach(btn => btn.onclick = () => updateCategory(btn.dataset.category));
    document.getElementById('openCategory').onclick = () => { pushHistory('categoryDetail'); navigate('categoryDetail'); };

    positionFeature();
    requestAnimationFrame(positionFeature);
    // после загрузки шрифтов высота окошка может чуть измениться — ставим его на место ещё раз
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionFeature);
    window.addEventListener('resize', positionFeature);
    // если размеры списка или окошка поменялись (загрузились картинки, шрифты, появился скроллбар) — ставим окошко заново
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => positionFeature());
      ro.observe(document.getElementById('categoryList'));
      ro.observe(document.getElementById('featureInner'));
    }
    // страховка: ещё раз ставим окошко, когда страница точно «устоялась»
    [150, 500, 1200].forEach(ms => setTimeout(positionFeature, ms));
    window.addEventListener('load', positionFeature);
  }

  // Яркое окошко вместо системного alert() — стилизуется под сайт и хорошо читается
  function showNotice(text, title = 'Внимание') {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="modalBox noticeBox" role="alertdialog" aria-modal="true">
        <div class="modalIcon">!</div>
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        <div class="modalActions"><button class="luxButton" data-r="1"><span>ПОНЯТНО</span><b>✓</b></button></div>
      </div>`;
      const close = () => { m.remove(); document.removeEventListener('keydown', onKey); resolve(); };
      const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
      m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-r]')) close(); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(m);
      m.querySelector('[data-r]').focus();
    });
  }

  function confirmVote(video) {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="modalBox" role="dialog" aria-modal="true">
        <div class="modalIcon">!</div>
        <h3>Выбор нельзя будет изменить</h3>
        <p>Вы голосуете за <b>«${esc(video.title)}»</b> в номинации <b>«${esc(selected.title)}»</b>.${limitOf(selected.n) > 1 ? ` Это ваш голос ${votesIn(selected.n).length + 1} из ${limitOf(selected.n)}.` : ''} После подтверждения изменить или отозвать голос не получится.</p>
        <div class="modalActions"><button class="ghostBtn" data-r="0">ОТМЕНА</button><button class="luxButton" data-r="1"><span>ДА, ГОЛОСУЮ</span><b>✓</b></button></div>
      </div>`;
      const close = (r) => { m.remove(); document.removeEventListener('keydown', onKey); resolve(r); };
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      m.addEventListener('click', e => { if (e.target === m) close(false); const r = e.target.closest('[data-r]'); if (r) close(r.dataset.r === '1'); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(m);
      m.querySelector('[data-r="0"]').focus();
    });
  }

  function renderCategoryDetail() {
    shell(`
      <section class="categoryDetail sceneIn">
        <div class="detailHead">
          <div><div class="heroKicker">ГРЕЧКА 2026 · НОМИНАЦИЯ ${selected.n}</div><h1>${esc(selected.title)}</h1><p>${esc(selected.desc)}</p></div>
          <div class="voteStatus" id="voteStatus">ЗАГРУЗКА…</div>
        </div>
        <div class="voteWarn" id="voteWarn"></div>
        <div class="${isVideoCat(selected.n) ? 'videoGrid' : 'imageGrid'}" id="videoGrid"></div>
      </section>`, 'ГОЛОСОВАНИЕ');
    loadVideos().then(paintCards).catch(() => {});
  }

  function paintCards() {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;
    const status = document.getElementById('voteStatus');
    const warn = document.getElementById('voteWarn');
    const videoMode = isVideoCat(selected.n);
    const list = videosByCat[selected.n] || [];

    const paint = () => {
      const chosen = votesIn(selected.n);       // за кого уже проголосовано
      const limit = limitOf(selected.n);        // сколько голосов всего
      const left = limit - chosen.length;       // сколько голосов осталось
      if (!list.length) {
        status.textContent = 'НОМИНАНТОВ ПОКА НЕТ';
        warn.style.display = 'none';
        grid.innerHTML = `<div class="emptyState">В этой номинации ещё нет ${videoMode ? 'роликов' : 'номинантов'}. Загляните позже.</div>`;
        return;
      }
      warn.style.display = '';
      if (left <= 0) {
        status.textContent = limit > 1 ? `ВСЕ ${limit} ГОЛОСА ОТДАНЫ · ИЗМЕНИТЬ НЕЛЬЗЯ` : 'ВАШ ГОЛОС ЗАСЧИТАН · ИЗМЕНИТЬ НЕЛЬЗЯ';
        warn.className = 'voteWarn locked';
        warn.textContent = limit > 1 ? 'Вы уже отдали все голоса в этой номинации. Выбор окончательный.' : 'Вы уже проголосовали в этой номинации. Выбор окончательный.';
      } else if (limit > 1) {
        status.textContent = `ГОЛОСОВ ОСТАЛОСЬ: ${left} ИЗ ${limit}`;
        warn.className = 'voteWarn';
        warn.innerHTML = `<b>Внимание:</b> в этой номинации у вас <b>${limit} голоса</b> — отдайте их за <b>разных</b> ${videoMode ? 'роликов' : 'номинантов'}. Каждый голос после подтверждения изменить нельзя.`;
      } else {
        status.textContent = videoMode ? 'ВЫБЕРИТЕ ОДИН РОЛИК' : 'ВЫБЕРИТЕ НОМИНАНТА';
        warn.className = 'voteWarn';
        warn.innerHTML = `<b>Внимание:</b> голосовать можно только один раз. После подтверждения изменить выбор нельзя.`;
      }
      grid.innerHTML = list.map((v, i) => {
        const mine = chosen.includes(v.id);
        const label = mine ? 'ВАШ ВЫБОР ✓' : left <= 0 ? 'ГОЛОСА ОТДАНЫ' : 'ОТДАТЬ ГОЛОС';
        const off = mine || left <= 0 ? 'disabled' : '';
        const media = videoMode
          ? `<div class="videoWrap"><video controls preload="metadata" playsinline src="${esc(v.url)}"></video><span class="videoNum">0${i + 1}</span></div>
             <div class="videoMeta"><div><small>ВИДЕО №0${i + 1}</small><strong>${esc(v.title)}</strong></div><button class="voteBtn ${mine ? 'chosen' : ''}" data-vote="${esc(v.id)}" ${off}>${label}</button></div>`
          : `<div class="imageWrap"><span class="imgBlur" style="background-image:url('${esc(v.url)}')"></span><img src="${esc(v.url)}" alt="${esc(v.title)}" loading="lazy" decoding="async"><span class="frame"></span><span class="videoNum">0${i + 1}</span></div>
             <div class="imageCaption"><b title="${esc(v.title)}">${esc(v.title)}</b><button class="voteBtn ${mine ? 'chosen' : ''}" data-vote="${esc(v.id)}" ${off}>${label}</button></div>`;
        return `<article class="videoCard ${videoMode ? 'videoCardV' : 'videoCardI'} ${mine ? 'mine' : ''}">${media}</article>`;
      }).join('');
      grid.querySelectorAll('.voteBtn:not([disabled])').forEach(btn => btn.onclick = async () => {
        const video = list.find(v => v.id === btn.dataset.vote);
        grid.querySelectorAll('video').forEach(v => v.pause());
        if (!await confirmVote(video)) return;
        try {
          await api('/api/vote', { method: 'POST', body: { category: selected.n, videoId: video.id } });
          myVotes[selected.n] = [...votesIn(selected.n), video.id];
        } catch (e) {
          if (e.status === 409 && Array.isArray(e.data.videoIds)) myVotes[selected.n] = e.data.videoIds;
          await showNotice(e.message, e.status === 409 ? 'Голос уже отдан' : 'Не получилось проголосовать');
        }
        paint();
      });
    };
    paint();
  }

  // ---------- АДМИНКА ----------
  function renderAdmin() {
    shell(`<section class="admin sceneIn" id="adminRoot"></section>`, 'АДМИНКА');
    if (!store.admin) return adminLogin();
    adminDashboard();
  }

  // Админка работает в двух режимах:
  //  • с server.js (локально или на хостинге) — вход по паролю, загрузка через /api;
  //  • без сервера (чистый GitHub Pages) — вход по ключу Supabase, загрузка напрямую в БД.
  function adminLogin() {
    const root = document.getElementById('adminRoot');
    const cfg0 = sbCfg();
    const direct0 = !!(cfg0 && sbBase(cfg0.u) && String(cfg0.k || '').trim());
    root.innerHTML = `
      <div class="login">
        <div class="heroKicker">ТОЛЬКО ДЛЯ ОРГАНИЗАТОРОВ</div>
        <h1 class="loginTitle">ВХОД<br><em>В АДМИНКУ</em></h1>
        <div class="loginForm">
          <input id="adminPass" type="password" class="textInput" placeholder="${direct0 ? 'Пароль или «включить режим GitHub Pages»' : 'Пароль'}" autocomplete="current-password">
          <button class="luxButton" id="adminGo"><span>ВОЙТИ</span><b>→</b></button>
        </div>
        <div class="formError" id="adminError"></div>
        <p class="adminHint loginHint">Нет доступа к серверу? Укажите ниже URL проекта и ключ Supabase — админка будет грузить обложки напрямую в базу, без Node-сервера.</p>
        <div class="sbBar inline">
          <label>SUPABASE URL<input type="text" id="sbUrlL" placeholder="https://xxxxxxxx.supabase.co" value="${esc(cfg0?.u || '')}"></label>
          <label>SERVICE_ROLE / ANON KEY<input type="password" id="sbKeyL" placeholder="eyJhbGciOi..." value="${esc(cfg0?.k || '')}"></label>
          <button class="ghostBtn" id="sbSaveL">РЕЖИМ GITHUB PAGES</button>
        </div>
      </div>`;
    const input = document.getElementById('adminPass');
    const go = async () => {
      try {
        const d = await api('/api/admin/login', { method: 'POST', body: { password: input.value } });
        store.admin = d.token;
        adminDashboard();
      } catch (e) { document.getElementById('adminError').textContent = e.message; }
    };
    document.getElementById('adminGo').onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    document.getElementById('sbSaveL').onclick = () => {
      const u = sbBase(document.getElementById('sbUrlL').value), k = String(document.getElementById('sbKeyL').value || '').trim();
      if (!u.startsWith('http') || k.length < 20) return alert('Заполните оба поля: URL проекта и ключ');
      localStorage.setItem('grechka_sb', JSON.stringify({ u, k }));
      store.admin = 'direct'; // вход без пароля: дальше работаем только с Supabase
      adminDashboard();
    };
    if (direct0) { store.admin = 'direct'; return adminDashboard(); } // ключи уже сохранены — сразу в дашборд
    input.focus();
  }

  let adminTabMemo = 'covers';
  function adminDashboard() {
    const root = document.getElementById('adminRoot');
    if (!root) return; // админку уже закрыли/перерисовали — выходим молча (иначе краш выбрасывает из админки)
    const cfgD = sbCfg();
    const directAdmin = store.admin === 'direct' || !!(cfgD && sbBase(cfgD.u) && String(cfgD.k || '').trim());
    let tab = (directAdmin && adminTabMemo === 'results') ? 'covers' : adminTabMemo; // запоминаем вкладку: даже если админку перерисуют, вы останетесь где были
    let cat = categories[0].n;
    let overview = { videos: [], voters: [] };
    const queue = []; // { id, name, pct, state, error }

    root.innerHTML = `
      <div class="adminHead">
        <div><div class="heroKicker">ГРЕЧКА 2026${directAdmin ? ' · РЕЖИМ GITHUB PAGES' : ''}</div><h1>АДМИНКА</h1></div>
        <div class="adminTabs"><button data-tab="covers" class="${tab === 'covers' ? 'on' : ''}">ОБЛОЖКИ</button><button data-tab="videos" class="${tab === 'videos' ? 'on' : ''}">НОМИНАЦИИ</button><button data-tab="people" class="${tab === 'people' ? 'on' : ''}">ФОТО</button>${directAdmin ? '' : `<button data-tab="results" class="${tab === 'results' ? 'on' : ''}">ВЫБОР ЛЮДЕЙ</button>`}<button data-tab="out">ВЫЙТИ</button></div>
      </div>
      <div id="adminBody"></div>`;
    const body = document.getElementById('adminBody');

    const reload = async () => {
      // режим GitHub Pages (ключи Supabase сохранены): сервер не нужен.
      // Обложки обновляем напрямую из БД; для остальных вкладок тянем из Supabase
      // номинантов и голоса, чтобы работал подсчёт участников в номинации.
      if (directAdmin) {
        const cfgR = sbCfg();
        try {
          const allVids = await sbDirect('/rest/v1/videos?select=id,category,title,path,size,kind&order=created_at.asc', {}, cfgR);
          const allVotes = await sbDirect('/rest/v1/votes?select=video_id,voter_id,category', {}, cfgR).catch(() => []);
          // превью номинантов из bucket «videos»: сначала пробуем публичный URL,
          // подпись через API — только если картинка не открылась (приватный bucket)
          const pubUrl = (path) => `${sbBase(cfgR.u)}/storage/v1/object/public/videos/${String(path || '').split('/').map(encodeURIComponent).join('/')}`;
          const signUrl = async (path) => {
            try {
              const d = await sbDirect(`/storage/v1/object/sign/videos/${String(path || '').split('/').map(encodeURIComponent).join('/')}`,
                { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) }, cfgR);
              return `${sbBase(cfgR.u)}${d.signedURL || d.url || ''}`;
            } catch { return ''; }
          };
          const normVideos = allVids.filter(v => v.category !== 'CV' && v.category !== 'PP');
          for (const v of normVideos) v.voters = allVotes.filter(t => t.video_id === v.id);
          overview = { videos: normVideos, voters: [] };
          // подписываем лениво: превью ставим сразу публичным URL, при ошибке загрузки меняем на подписанный
          normVideos.forEach(v => { v.url = pubUrl(v.path); v._sign = () => signUrl(v.path).then(u => { v.url = u; }); });
        } catch (e) { console.warn('Supabase direct overview:', e.message || e); }
        await loadCoversFromSupabaseDirect().catch(() => {});
        if (tab === 'covers') drawCovers(); else draw();
        return;
      }
      try {
        overview = await api('/api/admin/overview', { admin: true });
        // «01 1280x720» в title обложки — служебные размеры, оставляем только номер номинации
        for (const v of overview.videos) {
          if (v.category === 'CV') {
            const m = String(v.title).match(/^(\d{2})(?: \d+x\d+)?$/);
            v.title = m ? m[1] : v.title;
          }
        }
      }
      catch (e) { if (e.status === 401) { store.admin = null; return adminLogin(); } }
      // если пользователь за это время вышел из админки — не рисуем старьё
      if (!store.admin || !document.getElementById('adminRoot') || root !== document.getElementById('adminRoot')) return;
      draw();
    };

    root.querySelector('.adminTabs').onclick = (e) => {
      const t = e.target.closest('button')?.dataset.tab;
      if (!t) return;
      if (t === 'out') { store.admin = null; return adminLogin(); }
      tab = adminTabMemo = t;
      root.querySelectorAll('.adminTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
      reload();
    };

    function draw() { tab === 'videos' ? drawVideos() : tab === 'covers' ? drawCovers() : tab === 'people' ? drawPeople() : drawResults(); }

    // счётчик номинантов для списка слева (обложки CV и фото PP не считаем)
    const catCount = (c) => overview.videos.filter(v => v.category === c.n).length;
    // актуализируем счётчики «в реальном времени» без полной перезагрузки:
    // пересчитываем количество записей в таблице videos по каждой номинации напрямую из Supabase
    async function refreshCatCounts() {
      if (!directAdmin || tab !== 'videos') return;
      try {
        const rows = await sbDirect('/rest/v1/videos?select=id,category,title,path,size,kind', {}, sbCfg());
        const arr = Array.isArray(rows) ? rows : [];
        const counts = {};
        for (const r of arr) if (r.category !== 'CV' && r.category !== 'PP') counts[r.category] = (counts[r.category] || 0) + 1;
        body.querySelectorAll('.adminCats button[data-cat]').forEach(b => {
          const cc = b.querySelector('em .cc');
          if (cc) cc.textContent = String(counts[b.dataset.cat] || 0);
        });
      } catch { /* ignore */ }
    }
    // title обложек в БД вида «01 1280x720» — сравниваем только номер номинации
    const coverOf = (c) => overview.videos.find(v => v.category === 'CV' && String(v.title).match(/^(\d{2})(?: \d+x\d+)?$/)?.[1] === c);

    function drawVideos() {
      const list = overview.videos.filter(v => v.category === cat);
      const videoMode = isVideoCat(cat);
      // актуализируем счётчики после загрузки данных из Supabase (если они ещё не готовы)
      if (!overview.videos.length && directAdmin) refreshCatCounts();
      body.innerHTML = `
        <div class="adminCols">
          <nav class="adminCats">${categories.map(c => {
            const n = catCount(c.n);
            return `<button data-cat="${c.n}" class="${c.n === cat ? 'on' : ''}"><span>${c.n}</span><strong>${esc(c.title)}</strong><em><b class="cc">${n}</b>${coverOf(c.n) ? ' ✦' : ''}</em></button>`;
          }).join('')}</nav>
          <div class="adminMain">
            <h2>${esc(categories.find(c => c.n === cat).title)}</h2>
            <p class="adminHint">У каждого зрителя в этой номинации: <b>${limitOf(cat)} ${limitOf(cat) === 1 ? 'голос' : limitOf(cat) < 5 ? 'голоса' : 'голосов'}</b>${limitOf(cat) > 1 ? ' (за разных номинантов)' : ''}</p>
            <div class="dropzone" id="dropzone" tabindex="0">
              <div class="dropIcon">⇪</div>
              <b>${videoMode ? 'Перетащите видео сюда' : 'Перетащите картинки сюда'}</b>
              <small>${videoMode
                ? 'можно выбрать несколько роликов сразу · MP4, WebM, MOV · до 50 МБ каждый'
                : 'имя файла станет подписью номинанта · JPG, PNG, GIF, WEBP · до 15 МБ · можно несколько сразу'}</small>
              <input type="file" id="fileInput" accept="${videoMode ? 'video/*,.mp4,.webm,.mov,.m4v,.ogv' : 'image/*'}" multiple hidden>
            </div>
            <div class="uploadQueue" id="uploadQueue"></div>
            <div class="adminVideos">${list.length ? list.map(v => `
              <div class="adminVideo" data-id="${esc(v.id)}">
                ${videoMode
                  ? `<video src="${esc(v.url)}" preload="metadata" controls playsinline></video>`
                  : `<img src="${esc(v.url)}" alt="" loading="lazy" data-fb="1">`}
                <div class="avInfo"><strong>${esc(v.title)}</strong><small>${fmtSize(v.size)} · голосов: ${v.voters.length}</small></div>
                <div class="avActions"><button data-act="rename">ПЕРЕИМЕНОВАТЬ</button><button data-act="del" class="danger">УДАЛИТЬ</button></div>
              </div>`).join('') : `<div class="emptyState">В этой номинации пока нет ${videoMode ? 'роликов' : 'номинантов'}.</div>`}</div>
          </div>
        </div>`;
      // превью ставим сразу; если bucket «videos» приватный — картинка не откроется,
      // тогда подписываем URL через Supabase API и меняем src (ленивая подстраховка)
      body.querySelectorAll('.adminVideos img[data-fb]').forEach(img => {
        img.onerror = async () => {
          img.onerror = null;
          const id = img.closest('.adminVideo')?.dataset.id;
          const vid = list.find(x => String(x.id) === String(id));
          if (vid && vid._sign) { const u = await vid._sign().catch(() => ''); if (u) img.src = u; }
        };
      });
      body.querySelector('.adminCats').onclick = (e) => {
        const c = e.target.closest('button')?.dataset.cat;
        if (c) { cat = c; drawVideos(); drawQueue(); }
      };
      const dz = document.getElementById('dropzone');
      const fi = document.getElementById('fileInput');
      dz.onclick = () => fi.click();
      dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } };
      fi.onchange = () => { addFiles([...fi.files]); fi.value = ''; };
      ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
      dz.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
      body.querySelector('.adminVideos').onclick = async (e) => {
        const act = e.target.dataset.act;
        const id = e.target.closest('.adminVideo')?.dataset.id;
        if (!act || !id) return;
        const v = overview.videos.find(x => x.id === id);
        try {
          if (act === 'rename') {
            const t = prompt('Название ролика:', v.title);
            if (t === null) return;
            await api('/api/admin/videos/' + id, { method: 'PATCH', admin: true, body: { title: t } });
          } else if (act === 'del') {
            const extra = v.voters.length ? `\n\nУ ролика уже ${v.voters.length} голос(ов) — они будут сброшены, и эти люди смогут проголосовать заново.` : '';
            if (!confirm(`Удалить «${v.title}»?${extra}`)) return;
            await api('/api/admin/videos/' + id, { method: 'DELETE', admin: true });
          }
          reload();
        } catch (err) { alert(err.message); }
      };
      drawQueue();
    }

    // ---------- ОБЛОЖКИ НОМИНАЦИЙ (вкладка «ОБЛОЖКИ») ----------
    // Картинка 16:9, которая ставится фоном кнопки номинации на странице «НОМИНАЦИИ».
    // ---- загрузка обложек напрямую в Supabase (для сайта без Node-сервера) ----
    async function sbDirect(path, opts = {}, cfg) {
      const r = await fetch(sbBase(cfg.u) + path, {
        ...opts,
        headers: { apikey: cfg.k, Authorization: 'Bearer ' + cfg.k,
                   ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
                   ...(opts.headers || {}) }
      });
      if (!r.ok) throw new Error((await r.text().catch(() => '')).slice(0, 160) || ('HTTP ' + r.status));
      const ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : r.arrayBuffer();
    }
    async function directCoverList(cfg) {
      const rows = await sbDirect('/rest/v1/videos?select=id,title,path,size,created_at&category=eq.CV&order=created_at.asc', {}, cfg);
      const map = {};
      for (const v of Array.isArray(rows) ? rows : []) {
        // title обложки: «01» или «01 1280x720» — номер номинации + реальные размеры картинки
        const m = String(v.title || '').match(/^(\d{2})(?:\s+(\d+)x(\d+))?$/);
        if (!m) continue;
        const path = String(v.path || '').split('/').map(encodeURIComponent).join('/');
        map[m[1]] = { id: v.id, path: v.path, url: `${sbBase(cfg.u)}/storage/v1/object/public/covers/${path}`, w: +(m[2] || 0) || null, h: +(m[3] || 0) || null };
      }
      return map;
    }
    // размеры обложек из кэша coversByCat (серверный /api или прямая загрузка из Supabase)
    const coverDimsFromCache = (cNum) => {
      const cv = coverDims(coversByCat[cNum]);
      return cv && cv.w > 0 && cv.h > 0 ? cv : null;
    };
    // подтягиваем настоящие пиксели картинок, если в записях БД размеров нет (старые загрузки)
    function ensureCoverDims(map) {
      let changed = false;
      for (const cNum of Object.keys(map)) {
        const cv = map[cNum];
        if (!(cv.w > 0 && cv.h > 0)) { // размеры не были записаны — узнаём по самой картинке
          changed = true;
          const img = new Image();
          img.onload = () => { cv.w = img.naturalWidth || 1280; cv.h = img.naturalHeight || 720; drawCoversQuiet(); };
          img.onerror = () => { cv.w = 1280; cv.h = 720; };
          img.src = cv.url;
        }
      }
      return changed;
    }
    let coversRedrawTimer = null;
    function drawCoversQuiet() { clearTimeout(coversRedrawTimer); coversRedrawTimer = setTimeout(() => { if (document.getElementById('adminBody')) drawCovers(); }, 300); }
    async function directCoverUpload(cfg, cNum, file, onProgress) {
      const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || 'jpg';
      const dims = await new Promise((res) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res(null);
        img.src = URL.createObjectURL(file);
      }).finally(() => {});
      const path = `covers/${cNum}/${Date.now()}.${ext}`;
      const old = await directCoverList(cfg);
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('file', file, file.name);
      await sbDirect(`/storage/v1/object/covers/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', body: form }, cfg);
      await sbDirect('/rest/v1/videos', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ category: 'CV', kind: 'image', title: dims ? `${cNum} ${dims.w}x${dims.h}` : cNum, path, size: file.size }) }, cfg);
      if (old[cNum]) { // одна обложка на номинацию — старую убираем
        await sbDirect(`/storage/v1/object/covers/${String(old[cNum].path).split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }, cfg).catch(() => {});
        await sbDirect(`/rest/v1/videos?id=eq.${old[cNum].id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, cfg).catch(() => {});
      }
      void onProgress;
      return { width: dims?.w || 16, height: dims?.h || 9 };
    }
    async function directCoverRemove(cfg, cNum) {
      const cur = await directCoverList(cfg);
      const row = cur[cNum];
      if (!row) return;
      await sbDirect(`/storage/v1/object/covers/${String(row.path).split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }, cfg).catch(() => {});
      await sbDirect(`/rest/v1/videos?id=eq.${row.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, cfg);
    }

    function coverCardHtml(c, cv) {
      return `<div class="cvCard" data-cat="${c.n}">
        <div class="cvImg ${cv && cv.url ? 'on' : ''}" style="${cv ? `aspect-ratio:${cv.w}/${cv.h}` : ''}">${cv && cv.url ? `<img src="${esc(cv.url)}" alt="" loading="lazy">` : `<small>${cv ? `${cv.w}×${cv.h} px · ждём ссылку…` : 'без обложки'}</small>`}</div>
        <b>${c.n} · ${esc(c.title)}</b><small class="cvDims">${cv ? `${cv.w}×${cv.h} px · кнопки подстроятся автоматически` : 'кнопка номинации будет стандартной'}</small>
        <div class="cvActions"><button class="ghostBtn cvUpload" data-cat="${c.n}">${cv ? 'ЗАМЕНИТЬ' : 'ЗАГРУЗИТЬ'}</button>${cv ? `<button class="ghostBtn danger cvRemove" data-cat="${c.n}">УБРАТЬ</button>` : ''}</div>
        <input type="file" accept="image/*" hidden data-cat="${c.n}">
        <div class="paStatus"></div>
      </div>`;
    }

    function drawCovers() {
      const cfg = sbCfg();
      const directMode = !!(cfg && sbBase(cfg.u) && String(cfg.k || '').trim());
      body.innerHTML = `
        <div class="adminMain">
          <h2>Обложки номинаций</h2>
          <p class="adminHint">Картинка 16:9 станет фоном кнопки номинации на странице «НОМИНАЦИИ» у всех посетителей. Рекомендуем ~1280×720, JPG/PNG/WEBP до 8 МБ. Текст поверх обложки затемняется градиентом — картинку лучше выбирать спокойной по центру. Картинки хранятся в базе (Supabase Storage + таблица videos) и подгружаются оттуда у всех.</p>
          <div class="sbBar">
            <label>SUPABASE URL<input type="text" id="sbUrl" placeholder="https://xxxxxxxx.supabase.co" value="${esc(cfg?.u || '')}"></label>
            <label>SERVICE_ROLE / ANON KEY<input type="password" id="sbKey" placeholder="eyJhbGciOi..." value="${esc(cfg?.k || '')}"></label>
            <button class="ghostBtn" id="sbSave">СОХРАНИТЬ КЛЮЧИ</button>
            <span class="sbMode">${directMode ? 'режим GitHub Pages: загрузка идёт напрямую в Supabase ✓' : 'загрузка через server.js (локально / Render)'}</span>
          </div>
          <div class="coverGrid">${categories.map(c => coverCardHtml(c, directMode ? null : coverOf(c.n))).join('')}</div>
        </div>`;

      // если размеры уже известны из кэша обложек (картинки для страницы номинаций) — показываем их сразу
      categories.forEach(c => {
        const cached = coverDims(coversByCat[c.n]);
        if (!cached || !(cached.w > 0 && cached.h > 0)) return;
        const card = body.querySelector(`.cvCard[data-cat="${c.n}"] .cvImg`);
        if (card && !card.classList.contains('on') && /px/.test(card.textContent)) {
          card.outerHTML = `<div class="cvImg ${cached.url ? 'on' : ''}" style="aspect-ratio:${cached.w}/${cached.h}">${cached.url ? `<img src="${esc(cached.url)}" alt="" loading="lazy">` : `<small>${cached.w}×${cached.h} px</small>`}</div>`;
        }
      });

      document.getElementById('sbSave').onclick = () => {
        const u = sbBase(document.getElementById('sbUrl').value), k = String(document.getElementById('sbKey').value || '').trim();
        if (!u.startsWith('http') || k.length < 20) return alert('Заполните оба поля: URL проекта и ключ');
        localStorage.setItem('grechka_sb', JSON.stringify({ u, k }));
        document.querySelector('.sbMode').textContent = 'сохранено ✓ перезагружаю…';
        loadCoversFromSupabaseDirect().then(() => drawCovers());
      };

      bindCoverButtons();
      if (directMode) { // список обложек тянем из самой БД
        directCoverList(cfg).then((map) => {
          ensureCoverDims(map); // если размеры не записаны в title — узнаём их по картинке
          categories.forEach(c => {
            const card = body.querySelector(`.cvCard[data-cat="${c.n}"]`);
            if (!card) return;
            const cv = map[c.n];
            card.outerHTML = coverCardHtml(c, cv);
          });
          bindCoverButtons();
        }).catch(() => {});
      } else {
        // серверный режим: id/path есть в overview.videos, размеры берём из кэша обложек
        const map = {};
        for (const c of categories) {
          const v = coverOf(c.n);
          const dims = coverDimsFromCache(c.n);
          if (v) map[c.n] = { ...v, url: v.url, w: dims?.w || null, h: dims?.h || null };
        }
        ensureCoverDims(map);
        categories.forEach(c => {
          const card = body.querySelector(`.cvCard[data-cat="${c.n}"]`);
          if (card && map[c.n]) card.outerHTML = coverCardHtml(c, map[c.n]);
        });
        bindCoverButtons();
      }
    }

    function bindCoverButtons() {
      const cfg = sbCfg();
      const directMode = !!(cfg && sbBase(cfg.u) && String(cfg.k || '').trim());
      body.querySelectorAll('.cvUpload').forEach(btn => btn.onclick = () => {
        const cNum = btn.dataset.cat;
        const card = body.querySelector(`.cvCard[data-cat="${cNum}"]`);
        const input = card.querySelector('input[type=file]');
        input.onchange = async () => {
          const f = input.files[0]; if (!f) return;
          const st = card.querySelector('.paStatus');
          if (f.size > 8 * 1024 * 1024) { st.textContent = 'Максимум 8 МБ'; return; }
          st.textContent = 'Загрузка…';
          try {
            let res;
            if (directMode) {
              res = await directCoverUpload(cfg, cNum, f);
              const fresh = (await directCoverList(cfg))[cNum];
              coversByCat[cNum] = { url: fresh?.url, w: res.width || fresh?.w || 1280, h: res.height || fresh?.h || 720 };
            } else {
              res = await uploadWithRetry(`/api/admin/cover?category=${cNum}&name=${encodeURIComponent(f.name)}`, f, (p) => { st.textContent = `Загрузка… ${p}%`; });
              if (res && res.url) coversByCat[cNum] = { url: res.url, w: res.width || 16, h: res.height || 9 };
            }
            st.textContent = 'ГОТОВО ✓';
            reload();
          } catch (e) { st.textContent = (e.message || 'Ошибка загрузки') + ' · попробуйте ещё раз'; }
        };
        input.click();
      });
      body.querySelectorAll('.cvRemove').forEach(btn => btn.onclick = async () => {
        if (!confirm('Убрать обложку этой номинации?')) return;
        const cfg2 = sbCfg();
        const direct = !!(cfg2 && sbBase(cfg2.u) && String(cfg2.k || '').trim());
        try {
          delete coversByCat[btn.dataset.cat];
          if (direct) await directCoverRemove(cfg2, btn.dataset.cat);
          else await api('/api/admin/cover/' + btn.dataset.cat, { method: 'DELETE', admin: true });
          reload();
        }
        catch (e) { alert(e.message); }
      });
    }

    function drawCoversLegacyUnused() { void 0; }

    // ---------- ФОТО УЧАСТНИКОВ (вкладка «ФОТО») ----------
    function drawPeople() {
      body.innerHTML = `
        <div class="adminMain">
          <h2>Лица церемонии</h2>
          <p class="adminHint">Загрузите фотографию для каждого номинанта — она сразу появится на странице «УЧАСТНИКИ» у всех посетителей.</p>
          <div class="peopleAdminGrid">${participants.map((p, i) => `
            <div class="paCard" data-i="${i}">
              <div class="paImg"><img src="${esc(p.img)}" alt="${esc(p.name)}"></div>
              <b>${esc(p.name)}</b>
              <button class="ghostBtn paUpload" data-i="${i}">ЗАГРУЗИТЬ ФОТО</button>
              <input type="file" accept="image/*,.jpg,.jpeg,.png,.gif,.webp" hidden data-i="${i}">
              <div class="paStatus"></div>
            </div>`).join('')}</div>
        </div>`;
      body.querySelectorAll('.paUpload').forEach(btn => btn.onclick = () => {
        const input = body.querySelector(`.paCard[data-i="${btn.dataset.i}"] input[type=file]`);
        input.onchange = async () => {
          const f = input.files[0]; if (!f) return;
          const card = btn.closest('.paCard');
          const st = card.querySelector('.paStatus');
          // расширение проверяем «мягко»: настоящий тип определит сервер по содержимому
          if (f.size > 15 * 1024 * 1024) { st.textContent = 'Максимум 15 МБ'; return; }
          st.textContent = 'Загрузка… 0%';
          try {
            const url = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('PUT', `/api/admin/participant-photo?index=${btn.dataset.i}&name=${encodeURIComponent(participants[+btn.dataset.i].name + ' ' + (+btn.dataset.i + 1))}`);
              xhr.setRequestHeader('x-admin', store.admin || '');
              xhr.timeout = 300000;
              xhr.upload.onprogress = (e) => { if (e.lengthComputable) st.textContent = `Загрузка… ${Math.round(e.loaded / e.total * 100)}%`; };
              xhr.onload = () => {
                if (xhr.status === 200) { try { resolve(JSON.parse(xhr.responseText).url); } catch (err) { reject(err); } }
                else { let m = ''; try { m = JSON.parse(xhr.responseText).error; } catch {} reject(new Error(m || ('ошибка ' + xhr.status))); }
              };
              xhr.onerror = () => setTimeout(() => { // одна автоповторная попытка: Render после простоя «просыпается» со 2-го запроса
                const y = new XMLHttpRequest();
                y.open('PUT', `/api/admin/participant-photo?index=${btn.dataset.i}&name=${encodeURIComponent(participants[+btn.dataset.i].name + ' ' + (+btn.dataset.i + 1))}`);
                y.setRequestHeader('x-admin', store.admin || '');
                y.onload = () => { if (y.status === 200) { try { resolve(JSON.parse(y.responseText).url); } catch (err) { reject(err); } } else reject(new Error('сеть недоступна')); };
                y.onerror = () => reject(new Error('сеть недоступна · попробуйте ещё раз'));
                y.send(f);
              }, 1500);
              xhr.ontimeout = () => reject(new Error('таймаут загрузки'));
              xhr.send(f);
            });
            participants[+btn.dataset.i].img = url;
            // Сохраняем фото на СЕРВЕРЕ (в Supabase), чтобы его видели все посетители,
            // а не только тот браузер, где его загрузили. localStorage — как страховка.
            try { await api('/api/admin/participants', { method: 'PUT', admin: true, body: participants.map(p => ({ img: p.img })) }); } catch { /* ignore */ }
            localStorage.setItem('grechka_participants', JSON.stringify(participants));
            card.querySelector('img').src = url;
            st.textContent = 'ГОТОВО ✓';
          } catch (e) { st.textContent = e.message || 'Ошибка загрузки'; }
        };
        input.click();
      });
    }

    // загрузка с авторетраями: «ошибка сети» чаще всего бывает от обрыва соединения
    // или когда Render «спит» после простоя — вторая попытка обычно уже проходит
    function xhrPut(url, file, onprogress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('x-admin', store.admin || '');
        xhr.timeout = 600000; // 10 минут на крупные видео
        xhr.upload.onprogress = (e) => { if (onprogress && e.lengthComputable) onprogress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => {
          if (xhr.status === 200) { let d = null; try { d = JSON.parse(xhr.responseText); } catch { /* ignore */ } return resolve(d); }
          let msg = ''; try { msg = JSON.parse(xhr.responseText).error; } catch { /* ignore */ }
          reject(new Error(msg || ('ошибка сервера ' + xhr.status)));
        };
        xhr.onerror = () => reject(new Error('сеть недоступна'));
        xhr.ontimeout = () => reject(new Error('таймаут загрузки'));
        xhr.onabort = () => reject(new Error('загрузка прервана'));
        xhr.send(file);
      });
    }
    async function uploadWithRetry(url, file, onprogress, attempts = 3) {
      let lastErr;
      for (let a = 1; a <= attempts; a++) {
        try { return await xhrPut(url, file, (p) => onprogress && onprogress(p, a)); }
        catch (e) {
          lastErr = e;
          if (a < attempts) await new Promise(r => setTimeout(r, 1500 * a)); // пауза перед повтором
        }
      }
      throw lastErr;
    }

    function drawQueue() {
      const q = document.getElementById('uploadQueue');
      if (!q) return;
      q.innerHTML = queue.filter(i => i.cat === cat).map(i => `
        <div class="qItem ${i.state}"><span>${esc(i.name)}</span><div class="bar"><i style="width:${i.pct}%"></i></div><em>${i.state === 'error' ? esc(i.error) : i.state === 'done' ? 'ГОТОВО' : i.attempt > 1 ? `ПОВТОР ${i.attempt}/3` : i.pct + '%'}</em></div>`).join('');
    }

    let uploading = false;
    function addFiles(files) {
      // Никакой фильтрации по расширению на клиенте: Windows/мессенджеры присылают .JPG/.MP4
      // с заглавными буквами или без расширения. Настоящий тип проверит сервер по содержимому.
      // Здесь только мягкая подсказка по MIME-типу, если браузер его определил.
      const videoMode = isVideoCat(cat);
      const ok = [], bad = [];
      for (const f of files) {
        const t = f.type || '';
        if (videoMode) (t.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(f.name) ? ok : bad).push(f);
        else (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name) ? ok : bad).push(f);
      }
      bad.forEach(f => queue.push({ cat, name: f.name, pct: 0, state: 'error', attempt: 1, error: videoMode ? 'похоже, это не видео' : 'похоже, это не картинка' }));
      ok.forEach(f => queue.push({ cat, file: f, name: f.name, pct: 0, state: 'wait', attempt: 1 }));
      drawQueue();
      runQueue();
    }
    async function runQueue() {
      if (uploading) return;
      uploading = true;
      let item;
      while ((item = queue.find(i => i.state === 'wait'))) {
        item.state = 'up';
        try {
          await uploadWithRetry(
            `/api/admin/upload?category=${item.cat}&name=${encodeURIComponent(item.name)}`,
            item.file,
            (pct, attempt) => { item.pct = pct; item.attempt = attempt; drawQueue(); }
          );
          item.state = 'done'; item.pct = 100;
        } catch (e) {
          item.state = 'error';
          item.error = (e.message || 'ошибка') + ' · попробуйте ещё раз';
        }
        delete item.file; drawQueue();
      }
      uploading = false;
      if (tab === 'videos' || tab === 'covers') {
        try { overview = await api('/api/admin/overview', { admin: true }); draw(); } catch { /* ignore */ }
      }
    }

    function drawResults() {
      // Раньше тут стояло «if (!overview.voters.length)» — и пока никто не проголосовал, админка
      // ошибочно писала про GitHub Pages. Теперь сообщение только в настоящем режиме без сервера.
      if (directAdmin) { // режим GitHub Pages: голосов через БД без сервера не видно
        body.innerHTML = `<div class="adminMain"><h2>Выбор людей</h2><p class="adminHint">В режиме GitHub Pages список голосов недоступен — здесь он работает только с запущенным server.js. Количество номинантов в каждой номинации смотрите во вкладке «НОМИНАЦИИ».</p></div>`;
        return;
      }
      const total = overview.voters.reduce((n, v) => n + v.choices.length, 0);
      body.innerHTML = `
        <div class="statRow"><div><b>${overview.voters.length}</b><small>ЗРИТЕЛЕЙ</small></div><div><b>${total}</b><small>ГОЛОСОВ ВСЕГО</small></div><div><b>${overview.videos.filter(v => v.category !== 'CV' && v.category !== 'PP').length}</b><small>НОМИНАНТОВ</small></div></div>
        <h2 class="subH">ПО НОМИНАЦИЯМ</h2>
        <div class="resultList">${categories.map(c => {
          const vids = overview.videos.filter(v => v.category === c.n).sort((a, b) => b.voters.length - a.voters.length);
          const sum = vids.reduce((n, v) => n + v.voters.length, 0);
          return `<div class="resultCat"><div class="rcHead"><span>${c.n}</span><strong>${esc(c.title)}</strong><em>голосов: ${sum} · у зрителя ${limitOf(c.n)} ${limitOf(c.n) === 1 ? 'голос' : limitOf(c.n) < 5 ? 'голоса' : 'голосов'}</em></div>${vids.length ? vids.map(v => `
            <div class="rcVideo"><div class="rcTop"><b>${esc(v.title)}</b><i>${v.voters.length}</i></div><div class="bar"><i style="width:${sum ? Math.round(v.voters.length / sum * 100) : 0}%"></i></div>
            <div class="chips">${v.voters.length ? v.voters.map(n => `<span>${esc(n)}</span>`).join('') : '<small>пока никто не выбрал</small>'}</div></div>`).join('') : '<div class="emptyState sm">Нет номинантов</div>'}</div>`;
        }).join('')}</div>
        <h2 class="subH">КТО ЧТО ВЫБРАЛ</h2>
        <div class="voterTable">${overview.voters.length ? overview.voters.map(v => `
          <div class="voterRow"><div class="vName"><b>${esc(v.name)}</b><small>${v.choices.length}/${TOTAL_VOTES}</small></div>
          <div class="vChoices">${v.choices.length ? v.choices.sort((a, b) => a.category.localeCompare(b.category)).map(ch => `<span><em>${ch.category}</em> ${esc(categories.find(c => c.n === ch.category)?.title || '')} → <b>${esc(ch.title)}</b> <button class="chipDel" data-voter="${esc(ch.voterId)}" data-cat="${esc(ch.category)}" data-video="${esc(ch.videoId || '')}" title="Удалить этот голос из базы">×</button></span>`).join('') : '<small>ещё не голосовал</small>'}</div></div>`).join('') : '<div class="emptyState">Пока никто не зашёл.</div>'}</div>`;
    }

    // удаление голоса прямо из таблицы «КТО ЧТО ВЫБРАЛ» — запрос идёт на сервер, запись удаляется из БД.
    // Слушаем КЛИКИ на контейвере: обработчик переживает любую перерисовку (reload),
    // поэтому крестик работает всегда, а не только сразу после первой отрисовки.
    body.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('.chipDel');
      if (!btn) return;
      if (!confirm('Удалить этот голос? Зритель сможет проголосовать в этой номинации заново.')) return;
      try {
        await api(`/api/admin/votes/${btn.dataset.voter}/${btn.dataset.cat}${btn.dataset.video ? '/' + btn.dataset.video : ''}`, { method: 'DELETE', admin: true }); // удаляется один конкретный голос
        reload();
      } catch (err) { alert(err.message); }
    });

    // чтобы браузер не открывал видео, если уронить файл мимо зоны
    const stop = e => { if (scene === 'admin' && !e.target.closest?.('#dropzone')) { e.preventDefault(); } };
    window.addEventListener('dragover', stop); window.addEventListener('drop', stop);

    reload();
  }

  function render() {
    if (scene === 'intro') renderIntro();
    if (scene === 'login') renderLogin();
    if (scene === 'participants') renderParticipants();
    if (scene === 'categories') renderCategories();
    if (scene === 'categoryDetail') renderCategoryDetail();
    if (scene === 'admin') renderAdmin();
    // Запоминаем текущую страницу в адресе, чтобы F5 не выбрасывал на главную
    if (scene !== 'admin' && (!history.state || history.state.scene !== scene)) history.replaceState({ scene }, '', sceneHash(scene));
  }

  // Ссылка «АДМИН» (#admin) — отдельный путь без pushState. Админка живёт на том же
  // URL, поэтому браузерная «назад» из неё уходит ровно туда, откуда пришли в сайт,
  // а не на главную: hashchange-обработчик ниже это и делает.
  window.addEventListener('hashchange', () => {
    if (location.hash === '#admin' && scene !== 'admin') navigate('admin');
    else if (location.hash !== '#admin' && scene === 'admin') {
      const prev = sceneStack.length > 1 ? sceneStack[sceneStack.length - 2] : 'intro';
      navigate(prev, 'back');
    }
  });
  if (location.hash === '#admin') scene = 'admin';
  render();
  // Первая сцена тоже становится записью истории — тогда браузерная «назад»
  // уходит с неё на предыдущую страницу сайта, а не сразу на главную.
  if (scene !== 'admin' && !history.state) pushHistory(scene);
})();