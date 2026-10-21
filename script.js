(() => {
  const participants = [
    { name: 'КУРМАН', role: 'Номинант', img: 'assets/person-1.svg' },
    { name: 'ЛЕХА', role: 'Номинант', img: 'assets/person-2.svg' },
    { name: 'ВОВА', role: 'Номинант', img: 'assets/person-3.svg' },
    { name: 'КАЗАНЦЕВ', role: 'Номинант', img: 'assets/person-4.svg' },
    { name: 'ИГОРЬ', role: 'Номинант', img: 'assets/person-5.svg' },
    { name: 'ГЭС', role: 'Номинант', img: 'assets/person-6.svg' },
    { name: 'АНТОН', role: 'Номинант', img: 'assets/person-7.svg' }
  ];

  const categories = [
    ['01','Король грч все','Главный титул вечера. Без объяснений. Просто король.'],
    ['02','Человек мем года','Человек, который стал мемом раньше, чем успел это осознать.'],
    ['03','Разъебать года','За абсолютное уничтожение ожиданий, здравого смысла или всего сразу.'],
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

  const app = document.getElementById('app');
  // Восстановление сцены после перезагрузки страницы: адрес вида #scene/номер_номинации
  const SCENES = ['intro', 'login', 'participants', 'categories', 'categoryDetail'];
  const parseHash = () => {
    const [h, s, n] = location.hash.split('/');
    if (h !== '#admin' || !s) return {};
    return { scene: SCENES.includes(s) ? s : null, cat: /^\d{2}$/.test(n || '') ? n : null };
  };
  const restored = parseHash();
  let scene = restored.scene || 'intro';
  let selected = categories.find(c => c.n === restored.cat) || categories[0];
  let direction = 'forward';
  const sceneHash = (s) => '#admin/' + s + (s === 'categoryDetail' ? '/' + selected.n : '');

  const store = {
    get voter() { try { return JSON.parse(localStorage.getItem('grechka_voter')); } catch { return null; } },
    set voter(v) { v ? localStorage.setItem('grechka_voter', JSON.stringify(v)) : localStorage.removeItem('grechka_voter'); },
    get admin() { return sessionStorage.getItem('grechka_admin'); },
    set admin(t) { t ? sessionStorage.setItem('grechka_admin', t) : sessionStorage.removeItem('grechka_admin'); }
  };
  let myVotes = {};      // category -> videoId
  let videosByCat = {};  // category -> [video]

  async function api(path, { method = 'GET', body, admin = false } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (admin) headers['x-admin'] = store.admin || '';
    else if (store.voter) headers['x-voter'] = store.voter.token;
    const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || 'Ошибка запроса'); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  async function loadVideos() {
    try {
      const d = await api('/api/videos');
      videosByCat = d.videos; myVotes = d.myVotes;
    } catch (e) {
      if (e.status === 401) { store.voter = null; navigate('login'); }
      throw e;
    }
  }
  const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + ' ГБ' : (b / 1e6).toFixed(1) + ' МБ';
  const VIDEO_CAT = '08'; // «Откат года» — ролики; остальные номинации — картинки номинантов
  const isVideoCat = (n) => n === VIDEO_CAT;

  const esc = (value) => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function shell(content, label) {
    app.innerHTML = `
      <main class="app ${scene} ${direction === 'back' ? 'backScene' : ''}">
        <div class="background"><div class="light l1"></div><div class="light l2"></div><div class="vignette"></div></div>
        <header class="topbar">${scene !== 'intro' ? '<button class="back" id="back" aria-label="Назад">←</button>' : ''}<span>ГРЕЧКА <b>2026</b></span><i></i><small>${label}</small></header>
        ${content}
      </main>`;
    document.getElementById('back')?.addEventListener('click', () => {
      const prev = { login:'intro', participants:'intro', categories:'participants', categoryDetail:'categories', admin:'intro' }[scene] || 'intro';
      if (scene === 'admin') history.replaceState(null, '', location.pathname);
      navigate(prev, 'back');
    });
  }

  // Плавный переход: старая сцена уплывает, новая въезжает СРАЗУ поверх неё
  // (position:absolute на время анимации) — без пауз и «лагающих» рывков.
  let animating = false;
  const EASE = 'cubic-bezier(.33,1,.68,1)';
  function animateOut(el, dir) {
    el.style.willChange = 'transform, opacity';
    return el.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir === 'back' ? 34 : -34}px)` }],
      { duration: 170, easing: EASE, fill: 'forwards' }
    ).finished.then(() => { el.remove(); }).catch(() => { el.remove(); });
  }
  function animateIn(el, dir) {
    el.classList.remove('sceneIn'); // анимируем только через WAAPI, без двойных эффектов
    el.style.willChange = 'transform, opacity';
    return el.animate(
      [{ opacity: 0, transform: `translateX(${dir === 'back' ? -34 : 34}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 320, delay: 90, easing: EASE, fill: 'both' }
    ).finished.then(() => { el.style.willChange = ''; }).catch(() => {});
  }
  async function navigate(next, dir = 'forward') {
    if (animating || next === scene) return;
    animating = true;
    const oldEl = app.querySelector('section');
    direction = dir;
    scene = next;
    window.scrollTo(0, 0);
    render();
    const newEl = app.querySelector('section');
    if (oldEl && newEl && oldEl !== newEl) {
      // Старая сцена остаётся видимой поверх новой только на время анимации
      const r = newEl.getBoundingClientRect();
      oldEl.style.position = 'absolute';
      oldEl.style.top = r.top + window.scrollY + 'px';
      oldEl.style.left = 0; oldEl.style.right = 0;
      oldEl.style.zIndex = 5;
      await Promise.all([animateOut(oldEl, dir), animateIn(newEl, dir)]);
    } else if (newEl) {
      await animateIn(newEl, dir);
    }
    animating = false;
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
    document.getElementById('enter').onclick = () => navigate(store.voter ? 'participants' : 'login');
  }

  function portrait(p) {
    return `<div class="hallPortrait"><img src="${esc(p.img)}" alt=""><div><b>${esc(p.name)}</b><small>${esc(p.role)}</small></div></div>`;
  }

  function personCard(p, i) {
    return `<article class="person"><div class="personImage"><img src="${esc(p.img)}" alt="${esc(p.name)}"><span>0${i+1}</span></div><div class="personName"><b>${esc(p.name)}</b><small>${esc(p.role)}</small></div></article>`;
  }

  function renderParticipants() {
    shell(`
      <section class="participants sceneIn">
        <div class="sectionHead"><div class="heroKicker">ПЕРЕД НАЧАЛОМ</div><h1>ЛИЦА<br><em>ЦЕРЕМОНИИ</em></h1><p>Те самые люди, которым каким-то образом удалось попасть в историю Гречки.</p></div>
        <div class="peopleGrid">${participants.map(personCard).join('')}</div>
        <div class="centerAction"><button class="luxButton" id="openCategories"><span>ОТКРЫТЬ НОМИНАЦИИ</span><b>→</b></button></div>
      </section>`, 'УЧАСТНИКИ');
    document.getElementById('openCategories').onclick = () => navigate('categories');
  }

  function renderLogin() {
    shell(`
      <section class="login sceneIn">
        <div class="heroKicker">ПЕРЕД ГОЛОСОВАНИЕМ</div>
        <h1 class="loginTitle">КАК ВАС<br><em>ЗОВУТ?</em></h1>
        <p class="loginNote">Имя нужно, чтобы засчитать ваши голоса. В каждой номинации можно проголосовать только один раз — изменить выбор будет нельзя.</p>
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
        navigate('participants');
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('voterGo').onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    input.focus();
  }

  async function renderCategories() {
    try { await loadVideos(); } catch { return; }
    const rows = categories.map(c => {
      const done = !!myVotes[c.n];
      return `<button class="categoryRow ${selected.n === c.n ? 'active' : ''} ${done ? 'done' : ''}" data-category="${c.n}"><span>${c.n}</span><strong>${esc(c.title)}</strong><i>${done ? '✓' : '↗'}</i></button>`;
    }).join('');
    const doneCount = Object.keys(myVotes).length;
    shell(`
      <section class="categories sceneIn">
        <div class="sectionHead categoryHead"><div class="heroKicker">ГРЕЧКА 2026 · 14 КАТЕГОРИЙ · ВАШИ ГОЛОСА: ${doneCount}/14</div><h1>НОМИНАЦИИ</h1><p>Выберите категорию. Судьба человечества подождёт.</p></div>
        <div class="categoryLayout">
          <div class="categoryList" id="categoryList">${rows}</div>
          <aside class="categoryFeature" id="categoryFeature"><div class="featureTop"><span>${selected.n}</span><small>НОМИНАЦИЯ</small></div><h2>${esc(selected.title)}</h2><p>${esc(selected.desc)}</p><div class="featureRule"></div><button class="luxButton" id="openCategory"><span>ОТКРЫТЬ НОМИНАЦИЮ</span><b>→</b></button></aside>
        </div>
      </section>`, 'НОМИНАЦИИ');

    const updateCategory = (number) => {
      const next = categories.find(c => c.n === number);
      if (!next) return;
      selected = next;
      document.querySelectorAll('.categoryRow').forEach(row => row.classList.toggle('active', row.dataset.category === selected.n));
      const feature = document.getElementById('categoryFeature');
      feature.querySelector('.featureTop span').textContent = selected.n;
      feature.querySelector('h2').textContent = selected.title;
      feature.querySelector('p').textContent = selected.desc;
      feature.animate([
        { opacity: .55, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
    };

    document.querySelectorAll('.categoryRow').forEach(btn => btn.onclick = () => updateCategory(btn.dataset.category));
    document.getElementById('openCategory').onclick = () => navigate('categoryDetail');
  }

  function confirmVote(video) {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="modalBox" role="dialog" aria-modal="true">
        <div class="modalIcon">!</div>
        <h3>Выбор нельзя будет изменить</h3>
        <p>Вы голосуете за <b>«${esc(video.title)}»</b> в номинации <b>«${esc(selected.title)}»</b>. После подтверждения изменить или отозвать голос не получится.</p>
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
      const chosenId = myVotes[selected.n];
      if (!list.length) {
        status.textContent = 'НОМИНАНТОВ ПОКА НЕТ';
        warn.style.display = 'none';
        grid.innerHTML = `<div class="emptyState">В этой номинации ещё нет ${videoMode ? 'роликов' : 'номинантов'}. Загляните позже.</div>`;
        return;
      }
      warn.style.display = '';
      if (chosenId) {
        status.textContent = 'ВАШ ГОЛОС ЗАСЧИТАН · ИЗМЕНИТЬ НЕЛЬЗЯ';
        warn.className = 'voteWarn locked';
        warn.textContent = 'Вы уже проголосовали в этой номинации. Выбор окончательный.';
      } else {
        status.textContent = videoMode ? 'ВЫБЕРИТЕ ОДИН РОЛИК' : 'ВЫБЕРИТЕ НОМИНАНТА';
        warn.className = 'voteWarn';
        warn.innerHTML = `<b>Внимание:</b> голосовать можно только один раз. После подтверждения изменить выбор нельзя.`;
      }
      grid.innerHTML = list.map((v, i) => {
        const mine = chosenId === v.id;
        const label = mine ? 'ВАШ ВЫБОР ✓' : chosenId ? 'ГОЛОС УЖЕ ОТДАН' : 'ОТДАТЬ ГОЛОС';
        const media = videoMode
          ? `<div class="videoWrap"><video controls preload="metadata" playsinline src="${esc(v.url)}"></video><span class="videoNum">0${i + 1}</span></div>
             <div class="videoMeta"><div><small>ВИДЕО №0${i + 1}</small><strong>${esc(v.title)}</strong></div><button class="voteBtn ${mine ? 'chosen' : ''}" data-vote="${esc(v.id)}" ${chosenId ? 'disabled' : ''}>${label}</button></div>`
          : `<div class="imageWrap"><img src="${esc(v.url)}" alt="${esc(v.title)}" loading="lazy"><span class="videoNum">0${i + 1}</span></div>
             <div class="imageCaption"><b>${esc(v.title)}</b><button class="voteBtn ${mine ? 'chosen' : ''}" data-vote="${esc(v.id)}" ${chosenId ? 'disabled' : ''}>${label}</button></div>`;
        return `<article class="videoCard ${mine ? 'mine' : ''}">${media}</article>`;
      }).join('');
      grid.querySelectorAll('.voteBtn:not([disabled])').forEach(btn => btn.onclick = async () => {
        const video = list.find(v => v.id === btn.dataset.vote);
        grid.querySelectorAll('video').forEach(v => v.pause());
        if (!await confirmVote(video)) return;
        try {
          await api('/api/vote', { method: 'POST', body: { category: selected.n, videoId: video.id } });
          myVotes[selected.n] = video.id;
        } catch (e) {
          if (e.status === 409 && e.data.videoId) myVotes[selected.n] = e.data.videoId;
          alert(e.message);
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

  function adminLogin() {
    const root = document.getElementById('adminRoot');
    root.innerHTML = `
      <div class="login">
        <div class="heroKicker">ТОЛЬКО ДЛЯ ОРГАНИЗАТОРОВ</div>
        <h1 class="loginTitle">ВХОД<br><em>В АДМИНКУ</em></h1>
        <div class="loginForm">
          <input id="adminPass" type="password" class="textInput" placeholder="Пароль" autocomplete="current-password">
          <button class="luxButton" id="adminGo"><span>ВОЙТИ</span><b>→</b></button>
        </div>
        <div class="formError" id="adminError"></div>
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
    input.focus();
  }

  function adminDashboard() {
    const root = document.getElementById('adminRoot');
    let tab = 'videos';
    let cat = categories[0].n;
    let overview = { videos: [], voters: [] };
    const queue = []; // { id, name, pct, state, error }

    root.innerHTML = `
      <div class="adminHead">
        <div><div class="heroKicker">ГРЕЧКА 2026</div><h1>АДМИНКА</h1></div>
        <div class="adminTabs"><button data-tab="videos" class="on">ВИДЕО</button><button data-tab="results">ВЫБОР ЛЮДЕЙ</button><button data-tab="out">ВЫЙТИ</button></div>
      </div>
      <div id="adminBody"></div>`;
    const body = document.getElementById('adminBody');

    const reload = async () => {
      try { overview = await api('/api/admin/overview', { admin: true }); }
      catch (e) { if (e.status === 401) { store.admin = null; return adminLogin(); } }
      draw();
    };

    root.querySelector('.adminTabs').onclick = (e) => {
      const t = e.target.closest('button')?.dataset.tab;
      if (!t) return;
      if (t === 'out') { store.admin = null; return adminLogin(); }
      tab = t;
      root.querySelectorAll('.adminTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
      reload();
    };

    function draw() { tab === 'videos' ? drawVideos() : drawResults(); }

    function drawVideos() {
      const list = overview.videos.filter(v => v.category === cat);
      const videoMode = isVideoCat(cat);
      body.innerHTML = `
        <div class="adminCols">
          <nav class="adminCats">${categories.map(c => {
            const n = overview.videos.filter(v => v.category === c.n).length;
            return `<button data-cat="${c.n}" class="${c.n === cat ? 'on' : ''}"><span>${c.n}</span><strong>${esc(c.title)}</strong><em>${n}</em></button>`;
          }).join('')}</nav>
          <div class="adminMain">
            <h2>${esc(categories.find(c => c.n === cat).title)}</h2>
            <div class="dropzone" id="dropzone" tabindex="0">
              <div class="dropIcon">⇪</div>
              <b>${videoMode ? 'Перетащите видео сюда' : 'Перетащите картинки сюда'}</b>
              <small>${videoMode
                ? 'можно выбрать несколько роликов сразу · MP4, WebM, MOV, M4V, OGV · до 200 МБ'
                : 'имя файла станет подписью номинанта · JPG, PNG, GIF, WEBP · до 15 МБ · можно несколько сразу'}</small>
              <input type="file" id="fileInput" accept="${videoMode ? 'video/*,.mp4,.webm,.mov,.m4v,.ogv' : 'image/*,.jpg,.jpeg,.png,.gif,.webp'}" multiple hidden>
            </div>
            <div class="uploadQueue" id="uploadQueue"></div>
            <div class="adminVideos">${list.length ? list.map(v => `
              <div class="adminVideo" data-id="${esc(v.id)}">
                ${videoMode
                  ? `<video src="${esc(v.url)}" preload="metadata" controls playsinline></video>`
                  : `<img src="${esc(v.url)}" alt="" loading="lazy">`}
                <div class="avInfo"><strong>${esc(v.title)}</strong><small>${fmtSize(v.size)} · голосов: ${v.voters.length}</small></div>
                <div class="avActions"><button data-act="rename">ПЕРЕИМЕНОВАТЬ</button><button data-act="del" class="danger">УДАЛИТЬ</button></div>
              </div>`).join('') : `<div class="emptyState">В этой номинации пока нет ${videoMode ? 'роликов' : 'номинантов'}.</div>`}</div>
          </div>
        </div>`;
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

    function drawQueue() {
      const q = document.getElementById('uploadQueue');
      if (!q) return;
      q.innerHTML = queue.filter(i => i.cat === cat).map(i => `
        <div class="qItem ${i.state}"><span>${esc(i.name)}</span><div class="bar"><i style="width:${i.pct}%"></i></div><em>${i.state === 'error' ? esc(i.error) : i.state === 'done' ? 'ГОТОВО' : i.pct + '%'}</em></div>`).join('');
    }

    let uploading = false;
    function addFiles(files) {
      const videoMode = isVideoCat(cat);
      const ok = files.filter(f => videoMode
        ? /\.(mp4|webm|mov|m4v|ogv)$/i.test(f.name)
        : /\.(jpe?g|png|gif|webp)$/i.test(f.name));
      const bad = files.filter(f => !ok.includes(f));
      bad.forEach(f => queue.push({ cat, name: f.name, pct: 0, state: 'error', error: videoMode ? 'только видео (MP4, WebM, MOV)' : 'только картинки (JPG, PNG, GIF, WEBP)' }));
      ok.forEach(f => queue.push({ cat, file: f, name: f.name, pct: 0, state: 'wait' }));
      drawQueue();
      runQueue();
    }
    async function runQueue() {
      if (uploading) return;
      uploading = true;
      let item;
      while ((item = queue.find(i => i.state === 'wait'))) {
        item.state = 'up';
        await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `/api/admin/upload?category=${item.cat}&name=${encodeURIComponent(item.name)}`);
          xhr.setRequestHeader('x-admin', store.admin || '');
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) { item.pct = Math.round(e.loaded / e.total * 100); drawQueue(); } };
          xhr.onload = () => {
            if (xhr.status === 200) { item.state = 'done'; item.pct = 100; }
            else { item.state = 'error'; try { item.error = JSON.parse(xhr.responseText).error; } catch { item.error = 'ошибка ' + xhr.status; } }
            delete item.file; drawQueue(); resolve();
          };
          xhr.onerror = () => { item.state = 'error'; item.error = 'сеть недоступна'; delete item.file; drawQueue(); resolve(); };
          xhr.send(item.file);
        });
      }
      uploading = false;
      if (tab === 'videos') {
        try { overview = await api('/api/admin/overview', { admin: true }); drawVideos(); } catch { /* ignore */ }
      }
    }

    function drawResults() {
      const total = overview.voters.reduce((n, v) => n + v.choices.length, 0);
      body.innerHTML = `
        <div class="statRow"><div><b>${overview.voters.length}</b><small>ЗРИТЕЛЕЙ</small></div><div><b>${total}</b><small>ГОЛОСОВ ВСЕГО</small></div><div><b>${overview.videos.length}</b><small>НОМИНАНТОВ</small></div></div>
        <h2 class="subH">ПО НОМИНАЦИЯМ</h2>
        <div class="resultList">${categories.map(c => {
          const vids = overview.videos.filter(v => v.category === c.n).sort((a, b) => b.voters.length - a.voters.length);
          const sum = vids.reduce((n, v) => n + v.voters.length, 0);
          return `<div class="resultCat"><div class="rcHead"><span>${c.n}</span><strong>${esc(c.title)}</strong><em>голосов: ${sum}</em></div>${vids.length ? vids.map(v => `
            <div class="rcVideo"><div class="rcTop"><b>${esc(v.title)}</b><i>${v.voters.length}</i></div><div class="bar"><i style="width:${sum ? Math.round(v.voters.length / sum * 100) : 0}%"></i></div>
            <div class="chips">${v.voters.length ? v.voters.map(n => `<span>${esc(n)}</span>`).join('') : '<small>пока никто не выбрал</small>'}</div></div>`).join('') : '<div class="emptyState sm">Нет номинантов</div>'}</div>`;
        }).join('')}</div>
        <h2 class="subH">КТО ЧТО ВЫБРАЛ</h2>
        <div class="voterTable">${overview.voters.length ? overview.voters.map(v => `
          <div class="voterRow"><div class="vName"><b>${esc(v.name)}</b><small>${v.choices.length}/14</small></div>
          <div class="vChoices">${v.choices.length ? v.choices.sort((a, b) => a.category.localeCompare(b.category)).map(ch => `<span><em>${ch.category}</em> ${esc(categories.find(c => c.n === ch.category)?.title || '')} → <b>${esc(ch.title)}</b></span>`).join('') : '<small>ещё не голосовал</small>'}</div></div>`).join('') : '<div class="emptyState">Пока никто не зашёл.</div>'}</div>`;
    }

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
    if (scene !== 'admin') history.replaceState(null, '', sceneHash(scene));
  }

  const isAdminHash = () => location.hash === '#admin' || location.hash.startsWith('#admin/');
  window.addEventListener('hashchange', () => {
    if (!isAdminHash() && scene !== 'intro') navigate('intro', 'back');
    else if (isAdminHash() && scene === 'intro') navigate('admin');
  });
  if (location.hash === '#admin') scene = 'admin';
  render();
})();
