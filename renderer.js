/**
 * 粉色悬浮便签 - 渲染进程
 * 负责：事项编辑 / 完成勾选 / 提醒设置 / 拖动缩放 /
 *       点击穿透 / 置顶开关 / 自动保存 / 光标小星星 / 爱心动画
 */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const api = window.sticky;
  const noteId = new URLSearchParams(location.search).get('note') || '';

  const els = {
    note: $('#note'),
    title: $('#noteTitle'),
    list: $('#todoList'),
    empty: $('#emptyTip'),
    input: $('#itemInput'),
    add: $('#btnAdd'),
    clock: $('#clock'),
    saveState: $('#saveState'),
    saveHeart: $('#btnSave'),
    btnNew: $('#btnNew'),
    btnPin: $('#btnPin'),
    btnPass: $('#btnPass'),
    btnMin: $('#btnMin'),
    btnClose: $('#btnClose'),
    btnTheme: $('#btnTheme'),
    themePanel: $('#themePanel'),
    themeRows: $('#themeRows'),
    themePresets: $('#themePresets'),
    doodlePicker: $('#doodlePicker'),
    doodles: $('#doodles'),
    mascot: $('#mascot'),
    rOpacity: $('#rOpacity'),
    vOpacity: $('#vOpacity'),
    btnThemeClose: $('#btnThemeClose'),
    btnThemeReset: $('#btnThemeReset'),
    resize: $('#resizeHandle'),
    toast: $('#toast'),
    star: $('#caretStar'),
    progress: $('#todoProgress'),
  };

  let note = null;
  let saveTimer = null;
  let remindTimer = null;
  let toastTimer = null;
  let passthrough = false;
  let islandActive = false; // 穿透模式下鼠标是否悬停在工具区
  let rz = null; // 拖拽缩放状态

  const uid = () => 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');

  const ICONS = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5S3.2 15.3 1.6 10.4C.5 7 2.7 4 6 4c2 0 3.4 1.1 4.2 2.3.3.4.9.4 1.2 0C12.4 5.1 14 4 16 4c3.3 0 5.5 3 4.4 6.4C18.8 15.3 12 20.5 12 20.5z"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 0 0-6-6zm0 15a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 18z"/></svg>',
    close: '<svg class="icon-s" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 9.6 3.2 1.9-.9 1.5L11 13.4V7h2z"/></svg>',
  };

  /* ---------------- 初始化 ---------------- */

  async function init() {
    if (!api) {
      document.body.innerHTML = '<p style="padding:24px;color:#000">请在 Electron 环境中运行本应用 (npm start)</p>';
      return;
    }
    note = await api.loadNote(noteId);
    note.items = Array.isArray(note.items) ? note.items : [];
    if (!note.bounds) note.bounds = { width: 340, height: 470 };

    // 加载已保存的主题（失败则用默认配色）
    try {
      applyTheme(await api.getTheme());
    } catch (e) { /* noop */ }

    els.title.value = note.title || '今日待办';
    renderList();

    tickClock();
    setInterval(tickClock, 1000);

    bindTitlebar();
    bindAdder();
    bindMeta();
    bindResize();
    bindPassthrough();
    bindTheme();

    api.onReminder(onReminder);
    api.onBounds((b) => { note.bounds = b; });
    api.onPassthrough((on) => setPassthrough(on, true));
    api.onTopmost((on) => els.btnPin.classList.toggle('active', on));
    api.onThemeChanged((t) => applyTheme(t));

    bindCaretStar();
  }

  /* ---------------- 渲染 ---------------- */

  function renderList() {
    els.list.innerHTML = '';
    (note.items || []).forEach((item) => els.list.appendChild(renderItem(item)));
    els.empty.style.display = note.items.length ? 'none' : 'block';
    updateProgress();
  }

  // 未完成数量提示（显眼展示，方便及时关注还没做的事）
  function updateProgress() {
    const items = note.items || [];
    const undone = items.filter((i) => !i.done).length;
    const pill = els.progress;
    if (!pill) return;
    if (undone > 0) {
      const wasHidden = pill.hidden;
      pill.hidden = false;
      pill.innerHTML = `还有 <span class="pill-num">${undone}</span> 条未完成 💪`;
      if (!wasHidden) {
        // 数字变化时重新播放弹跳动效
        pill.style.animation = 'none';
        void pill.offsetWidth;
        pill.style.animation = '';
      }
    } else {
      pill.hidden = true;
      pill.innerHTML = '';
    }
  }

  function renderItem(item) {
    const li = document.createElement('li');
    li.className = 'item' + (item.done ? ' done' : '');
    li.dataset.id = item.id;

    // 完成勾选（小爱心）
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'check';
    check.title = item.done ? '取消完成' : '标记完成';
    check.innerHTML = ICONS.heart;
    check.addEventListener('click', () => {
      item.done = !item.done;
      li.classList.toggle('done', item.done);
      check.title = item.done ? '取消完成' : '标记完成';
      li.classList.remove('pop');
      void li.offsetWidth;
      li.classList.add('pop');
      if (item.done) spawnHearts(check, 3, 16);
      updateProgress();
      markDirty();
    });

    // 文本 + 提醒徽标
    const body = document.createElement('div');
    body.className = 'item-body';

    const text = document.createElement('div');
    text.className = 'text';
    text.contentEditable = 'plaintext-only';
    text.spellcheck = false;
    text.dataset.placeholder = '做点什么呀~';
    text.textContent = item.text || '';
    text.addEventListener('input', () => {
      item.text = text.textContent;
      markDirty();
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const idx = note.items.findIndex((x) => x.id === item.id);
        const fresh = { id: uid(), text: '', done: false, remindAt: null, remindFired: false };
        note.items.splice(idx + 1, 0, fresh);
        renderList();
        markDirty();
        focusItem(fresh.id);
      }
    });
    text.addEventListener('blur', () => {
      const t = text.textContent.trim();
      if (!t) {
        removeItem(item.id);
      } else if (t !== item.text) {
        item.text = t;
        text.textContent = t;
        markDirty();
      }
    });
    body.appendChild(text);
    if (item.remindAt) body.appendChild(remindBadge(item));

    // 行内工具
    const tools = document.createElement('div');
    tools.className = 'item-tools';

    const bell = document.createElement('button');
    bell.type = 'button';
    bell.className = 'mini';
    bell.title = '设置提醒时间';
    bell.innerHTML = ICONS.bell;
    bell.addEventListener('click', () => toggleRemindPop(li, item));
    tools.appendChild(bell);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini del';
    del.title = '删除这条';
    del.innerHTML = ICONS.close;
    del.addEventListener('click', () => removeItem(item.id));
    tools.appendChild(del);

    li.appendChild(check);
    li.appendChild(body);
    li.appendChild(tools);
    return li;
  }

  function remindBadge(item) {
    const badge = document.createElement('span');
    badge.className = 'remind-badge';
    badge.innerHTML = ICONS.clock;
    badge.appendChild(document.createTextNode(formatRemind(item.remindAt)));
    return badge;
  }

  function toggleRemindPop(li, item) {
    const old = li.querySelector('.remind-pop');
    if (old) {
      old.remove();
      return;
    }
    document.querySelectorAll('.remind-pop').forEach((p) => p.remove());

    const pop = document.createElement('div');
    pop.className = 'remind-pop';

    const dt = document.createElement('input');
    dt.type = 'datetime-local';
    const base = item.remindAt ? new Date(item.remindAt) : new Date(Date.now() + 10 * 60000);
    dt.value = toLocalInputValue(base);
    dt.addEventListener('change', () => {
      if (!dt.value) return;
      item.remindAt = new Date(dt.value).toISOString();
      item.remindFired = false;
      markDirty();
      renderList();
      toast('⏰ 提醒已设置：' + formatRemind(item.remindAt));
    });
    pop.appendChild(dt);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'mini del';
    clear.title = '清除提醒';
    clear.innerHTML = ICONS.close;
    clear.addEventListener('click', () => {
      item.remindAt = null;
      item.remindFired = false;
      markDirty();
      renderList();
    });
    pop.appendChild(clear);

    li.appendChild(pop);
    dt.focus();
  }

  function removeItem(id) {
    note.items = (note.items || []).filter((x) => x.id !== id);
    renderList();
    markDirty();
  }

  function focusItem(id) {
    const el = els.list.querySelector('.item[data-id="' + id + '"] .text');
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---------------- 自动保存 ---------------- */

  function markDirty(msg) {
    els.saveState.textContent = msg || '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      note.updatedAt = Date.now();
      api.saveNote(note);
      els.saveState.textContent = '已自动保存 ✓';
    }, 350);
  }

  /* ---------------- 标题栏 ---------------- */

  function bindTitlebar() {
    els.title.addEventListener('input', () => {
      note.title = els.title.value;
      markDirty();
    });
    els.btnNew.addEventListener('click', () => api.newNote());
    els.btnMin.addEventListener('click', () => api.minimize());
    els.btnClose.addEventListener('click', () => api.close());
    els.btnPin.addEventListener('click', async () => {
      const s = await api.toggleTopmost();
      els.btnPin.classList.toggle('active', !!s.isTop);
      toast(s.isTop ? '📌 已置顶' : '🔓 已取消置顶');
    });
  }

  /* ---------------- 添加事项 ---------------- */

  function bindAdder() {
    const add = () => {
      const v = els.input.value.trim();
      if (!v) {
        els.input.focus();
        return;
      }
      note.items.push({ id: uid(), text: v, done: false, remindAt: null, remindFired: false });
      renderList();
      markDirty();
      els.input.value = '';
      els.input.focus();
      spawnHearts(els.add, 4, 14);
      const wrap = document.querySelector('.list-wrap');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    };
    els.add.addEventListener('click', add);
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
  }

  /* ---------------- 底部信息栏 ---------------- */

  function bindMeta() {
    els.saveHeart.addEventListener('click', () => {
      note.updatedAt = Date.now();
      api.saveNote(note);
      els.saveState.textContent = '已保存 ✓';
      spawnHearts(els.saveHeart, 6, 22);
    });
  }

  function tickClock() {
    const d = new Date();
    const week = '日一二三四五六'[d.getDay()];
    els.clock.textContent = `${d.getMonth() + 1}月${d.getDate()}日 周${week} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ---------------- 点击穿透 ---------------- */

  function bindPassthrough() {
    els.btnPass.addEventListener('click', () => setPassthrough(!passthrough));

    // 穿透开启后，鼠标悬停到工具区/缩放手柄时自动恢复点击
    document.addEventListener('mousemove', (e) => {
      if (!passthrough) return;
      const inIsland = e.target instanceof Element &&
        !!e.target.closest('.tools, .resize');
      if (inIsland && !islandActive) {
        islandActive = true;
        api.setPassthrough(false);
      } else if (!inIsland && islandActive) {
        islandActive = false;
        api.setPassthrough(true);
      }
    });
  }

  function setPassthrough(on, silent) {
    passthrough = !!on;
    islandActive = false;
    document.body.classList.toggle('passthrough', passthrough);
    els.btnPass.classList.toggle('active', passthrough);
    if (!silent) api.setPassthrough(passthrough);
    if (passthrough) toast('🐾 穿透模式已开启 · Ctrl+Alt+C 恢复');
  }

  /* ---------------- 缩放 ---------------- */

  function bindResize() {
    let resizeRaf = 0;
    let pendingSize = null;
    els.resize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      rz = {
        x: e.screenX,
        y: e.screenY,
        w: note.bounds.width,
        h: note.bounds.height,
      };
      document.body.classList.add('resizing');
    });
    window.addEventListener('mousemove', (e) => {
      if (!rz) return;
      const w = Math.max(260, rz.w + (e.screenX - rz.x));
      const h = Math.max(300, rz.h + (e.screenY - rz.y));
      note.bounds.width = w;
      note.bounds.height = h;
      // rAF 节流：每帧最多向主进程发一次缩放
      pendingSize = { w, h };
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (pendingSize) api.resize(pendingSize.w, pendingSize.h);
      });
    });
    window.addEventListener('mouseup', () => {
      if (!rz) return;
      rz = null;
      document.body.classList.remove('resizing');
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      if (pendingSize) api.resize(pendingSize.w, pendingSize.h);
      pendingSize = null;
    });
  }

  /* ---------------- 调色盘（主题） ---------------- */

  const DEFAULT_THEME = {
    bg: '#FFF7FA',
    bgDeep: '#FFEAF2',
    accent: '#F09CBB',
    accentDeep: '#E2789F',
    ink: '#000000',
    opacity: 0.98,
    doodle: 'star',
    mascot: 'kitty',
  };

  const THEME_FIELDS = [
    ['bg', 'cBg', 'tBg', '背景（浅）'],
    ['bgDeep', 'cBgDeep', 'tBgDeep', '背景（深）'],
    ['accent', 'cAccent', 'tAccent', '强调色'],
    ['accentDeep', 'cAccentDeep', 'tAccentDeep', '深强调'],
    ['ink', 'cInk', 'tInk', '文字色'],
  ];

  // 颜色主题预设：颜色与吉祥物一一对应（成套切换）
  const PRESETS = [
    { name: '红色', bg: '#FFF5F4', bgDeep: '#FFE2E1', accent: '#FF7B7B', accentDeep: '#E85D5D', ink: '#000000', opacity: 0.98, doodle: 'heart', mascot: 'redpanda' },
    { name: '粉色', bg: '#FFF5F8', bgDeep: '#FFDCE8', accent: '#F28BB4', accentDeep: '#DB5C8C', ink: '#000000', opacity: 0.98, doodle: 'heart', mascot: 'melody' },
    { name: '粉白', bg: '#FFF7FA', bgDeep: '#FFEAF2', accent: '#F09CBB', accentDeep: '#E2789F', ink: '#000000', opacity: 0.98, doodle: 'star', mascot: 'kitty' },
    { name: '橙色', bg: '#FFF9F2', bgDeep: '#FFEBD6', accent: '#FFA94D', accentDeep: '#F08C2E', ink: '#000000', opacity: 0.98, doodle: 'star', mascot: 'charmander' },
    { name: '黄色', bg: '#FFFDF2', bgDeep: '#FFF6D9', accent: '#FFD43B', accentDeep: '#EFB728', ink: '#000000', opacity: 0.98, doodle: 'star', mascot: 'pikachu' },
    { name: '绿色', bg: '#F4FBF5', bgDeep: '#DFF3E2', accent: '#6BCB77', accentDeep: '#4CAF57', ink: '#000000', opacity: 0.98, doodle: 'cloud', mascot: 'bulbasaur' },
    { name: '薄荷', bg: '#F4FBF8', bgDeep: '#DDF2E8', accent: '#7FC8A9', accentDeep: '#4FA383', ink: '#000000', opacity: 0.98, doodle: 'cloud', mascot: 'keropi' },
    { name: '蓝色', bg: '#F0F8FF', bgDeep: '#D8ECFA', accent: '#4DABF7', accentDeep: '#2B8AD6', ink: '#000000', opacity: 0.98, doodle: 'cloud', mascot: 'doraemon' },
    { name: '雾蓝', bg: '#F4F9FD', bgDeep: '#E2EEF6', accent: '#8FB8D8', accentDeep: '#5D8FB8', ink: '#000000', opacity: 0.98, doodle: 'cloud', mascot: 'cinnamoroll' },
    { name: '靛色', bg: '#F0F4FF', bgDeep: '#DDE4FA', accent: '#7C8CF8', accentDeep: '#5A6BD8', ink: '#000000', opacity: 0.98, doodle: 'star', mascot: 'littletwin' },
    { name: '紫色', bg: '#F9F5FF', bgDeep: '#EDE3FA', accent: '#B197FC', accentDeep: '#9163E0', ink: '#000000', opacity: 0.98, doodle: 'star', mascot: 'cheshire' },
    { name: '薰衣草', bg: '#F8F7FF', bgDeep: '#E9E6FA', accent: '#A79CE0', accentDeep: '#7E6FC9', ink: '#000000', opacity: 0.98, doodle: 'star', mascot: 'kuromi' },
    { name: '奶油黄', bg: '#FFFBF2', bgDeep: '#FFF0D4', accent: '#F2C14E', accentDeep: '#D99A2B', ink: '#000000', opacity: 0.98, doodle: 'heart', mascot: 'rilakkuma' },
  ];

  // 背景简笔画（线条风，颜色继承 --accent）
  const DOODLES = {
    none: '',
    kitty: '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M30 40 L26 17 L46 31 Z"/><path d="M70 40 L74 17 L54 31 Z"/><circle cx="50" cy="57" r="26"/><ellipse cx="40" cy="54" rx="2.8" ry="3.6" fill="currentColor" stroke="none"/><ellipse cx="60" cy="54" rx="2.8" ry="3.6" fill="currentColor" stroke="none"/><ellipse cx="50" cy="65" rx="4" ry="3" fill="currentColor" stroke="none"/><path d="M24 63 L11 59 M24 69 L12 70 M76 63 L89 59 M76 69 L88 70"/></svg>',
    star: '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M50 8 L58 42 L92 50 L58 58 L50 92 L42 58 L8 50 L42 42 Z"/><path d="M82 12 v10 M77 17 h10" stroke-linecap="round"/></svg>',
    cloud: '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="34" cy="52" r="13"/><circle cx="52" cy="42" r="17"/><circle cx="68" cy="52" r="13"/><path d="M21 52 h58"/><path d="M50 22 v-8 M42 26 l-5 -6 M58 26 l5 -6" opacity="0.7"/></svg>',
    heart: '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M50 84 C18 62 14 44 26 33 C36 24 47 30 50 39 C53 30 64 24 74 33 C86 44 82 62 50 84 Z"/><path d="M78 16 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" opacity="0.7"/></svg>',
    bear: '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="31" cy="33" r="10"/><circle cx="69" cy="33" r="10"/><circle cx="50" cy="56" r="26"/><ellipse cx="41" cy="52" rx="2.8" ry="3.6" fill="currentColor" stroke="none"/><ellipse cx="59" cy="52" rx="2.8" ry="3.6" fill="currentColor" stroke="none"/><ellipse cx="50" cy="64" rx="9" ry="7"/><path d="M50 71 v3 M50 74 q-5 4 -8 1 M50 74 q5 4 8 1"/></svg>',
    flower: '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="34" r="9"/><circle cx="50" cy="18" r="9"/><circle cx="66" cy="27" r="9"/><circle cx="62" cy="45" r="9"/><circle cx="38" cy="45" r="9"/><circle cx="34" cy="27" r="9"/><circle cx="50" cy="34" r="3.5" fill="currentColor" stroke="none"/><path d="M50 43 v34 M50 60 q-12 -2 -16 -12 M50 70 q12 -2 16 -12"/></svg>',
  };

  const DOODLE_OPTIONS = [
    ['star', '星星'],
    ['heart', '爱心'],
    ['cloud', '云朵'],
    ['flower', '小花'],
    ['none', '无'],
  ];

  const DOODLE_LAYOUT = [
    { left: '5%', top: '13%', size: 46, rotate: -12 },
    { left: '74%', top: '9%', size: 34, rotate: 14 },
    { left: '79%', top: '45%', size: 42, rotate: -8 },
    { left: '8%', top: '60%', size: 38, rotate: 10 },
    { left: '44%', top: '82%', size: 30, rotate: -16 },
  ];

  // 顶部吉祥物（会动的卡通角色，颜色跟随主题）
  const MASCOTS = {
    none: '',
    // Hello Kitty 风：粉色猫耳小生物
    kitty: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M16 36 c-2.5 -3 -7 -1 -6 3 c.8 3.6 6 7 6 7 s5.2 -3.4 6 -7 c1 -4 -3.5 -6 -6 -3 z" opacity=".8"/>
        <path class="m-h2" d="M102 46 c-2 -2.4 -5.6 -.8 -4.8 2.4 c.6 2.9 4.8 5.6 4.8 5.6 s4.2 -2.7 4.8 -5.6 c.8 -3.2 -2.8 -4.8 -4.8 -2.4 z" opacity=".65"/>
        <path class="m-h3" d="M96 18 c-1.6 -2 -4.5 -.7 -3.9 2 c.5 2.4 3.9 4.6 3.9 4.6 s3.4 -2.2 3.9 -4.6 c.6 -2.7 -2.3 -4 -3.9 -2 z" opacity=".5"/>
      </g>
      <g class="m-ear-l"><path d="M30 46 L25 15 L54 33 Z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/><path d="M33 40 L30 23 L47 33 Z" fill="var(--accent-deep)" opacity=".35"/></g>
      <g class="m-ear-r"><path d="M90 46 L95 15 L66 33 Z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/><path d="M87 40 L90 23 L73 33 Z" fill="var(--accent-deep)" opacity=".35"/></g>
      <path d="M60 22 q-3 -9 5 -11" stroke="var(--accent-deep)" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="60" cy="55" rx="35" ry="31" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <ellipse cx="60" cy="64" rx="25" ry="19" fill="var(--mascot-cream)"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="47" cy="52" rx="4.2" ry="5.8"/><ellipse cx="73" cy="52" rx="4.2" ry="5.8"/></g>
      <circle cx="48.6" cy="49.5" r="1.5" fill="#fff"/><circle cx="74.6" cy="49.5" r="1.5" fill="#fff"/>
      <path d="M60 59 l-2.6 2.8 h5.2 z" fill="var(--accent-deep)"/>
      <path d="M60 62 q-4.5 5.5 -9 2.5 M60 62 q4.5 5.5 9 2.5" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="37" cy="61" rx="5.5" ry="3.2" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="83" cy="61" rx="5.5" ry="3.2" fill="var(--accent-deep)" opacity=".4"/>
      <path d="M41 82 q19 -7 38 0 q5 17 -1 24 h-36 q-6 -7 -1 -24 z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/>
      <ellipse cx="60" cy="94" rx="11" ry="8.5" fill="var(--mascot-cream)"/>
      <g class="m-arm"><path d="M85 86 q16 -8 20 -26" stroke="var(--accent-deep)" stroke-width="7" stroke-linecap="round"/><circle cx="106" cy="57" r="6.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/></g>
      <path d="M35 86 q-11 5 -15 14" stroke="var(--accent-deep)" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="49" cy="108" rx="7.5" ry="4.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <ellipse cx="71" cy="108" rx="7.5" ry="4.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
    </svg>`,
    // 库诺米风：紫色小恶魔头巾猫
    kuromi: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M18 32 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 z" opacity=".8"/>
        <path class="m-h2" d="M100 22 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 z" opacity=".65"/>
        <path class="m-h3" d="M104 54 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6 z" opacity=".5"/>
      </g>
      <g class="m-ear-l"><path d="M28 44 L12 6 L54 28 Z" fill="var(--accent-deep)"/></g>
      <g class="m-ear-r"><path d="M92 44 L108 6 L66 28 Z" fill="var(--accent-deep)"/></g>
      <path d="M25 56 a35 32 0 0 1 70 0 q-8 6 -35 6 q-27 0 -35 -6 z" fill="var(--accent-deep)"/>
      <ellipse cx="60" cy="62" rx="30" ry="25" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <circle cx="60" cy="36" r="6" fill="var(--mascot-cream)"/>
      <circle cx="58" cy="35" r="1.4" fill="var(--ink)"/><circle cx="62" cy="35" r="1.4" fill="var(--ink)"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="49" cy="60" rx="4" ry="5.6"/><ellipse cx="71" cy="60" rx="4" ry="5.6"/></g>
      <circle cx="50.4" cy="57.6" r="1.4" fill="#fff"/><circle cx="72.4" cy="57.6" r="1.4" fill="#fff"/>
      <path d="M44 53 l-4 -3 M76 53 l4 -3" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M60 67 l-2.4 2.6 h4.8 z" fill="var(--accent-deep)"/>
      <path d="M60 70 q-5 6 -9 3 M60 70 q5 6 9 3" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="39" cy="68" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="81" cy="68" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <path d="M42 84 q18 -6 36 0 q4 14 -2 20 h-32 q-6 -6 -2 -20 z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/>
      <path d="M22 44 q-6 4 -6 12 q6 4 10 -2" fill="var(--accent-deep)"/>
      <path d="M98 44 q6 4 6 12 q-6 4 -10 -2" fill="var(--accent-deep)"/>
      <path d="M78 92 q14 -4 18 -18" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M96 72 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5 -8 -8 -3.5 8 -3.5 z" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="2" stroke-linejoin="round"/>
      <path d="M42 92 q-12 0 -16 10" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M26 102 l-8 6 10 0" fill="var(--accent-deep)"/>
    </svg>`,
    // 红色小火怪
    fire: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M18 34 c-2.5 -3 -7 -1 -6 3 c.8 3.6 6 7 6 7 s5.2 -3.4 6 -7 c1 -4 -3.5 -6 -6 -3 z" opacity=".75"/>
        <path class="m-h2" d="M100 30 c-2 -2.4 -5.6 -.8 -4.8 2.4 c.6 2.9 4.8 5.6 4.8 5.6 s4.2 -2.7 4.8 -5.6 c.8 -3.2 -2.8 -4.8 -4.8 -2.4 z" opacity=".55"/>
      </g>
      <path d="M60 4 c7 13 17 17 17 30 c0 9 -8 14 -17 14 s-17 -5 -17 -14 c0 -13 10 -17 17 -30 z" fill="var(--accent-deep)"/>
      <path d="M60 18 c3.4 7.6 8.6 9.8 8.6 17.2 c0 4.4 -3.9 7.4 -8.6 7.4 s-8.6 -3 -8.6 -7.4 c0 -7.4 5.2 -9.6 8.6 -17.2 z" fill="var(--mascot-cream)"/>
      <path d="M38 46 L29 30 L49 39 Z" fill="var(--accent-deep)"/>
      <path d="M82 46 L91 30 L71 39 Z" fill="var(--accent-deep)"/>
      <ellipse cx="60" cy="78" rx="30" ry="27" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <ellipse cx="60" cy="86" rx="17" ry="13" fill="var(--mascot-cream)"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="50" cy="72" rx="3.6" ry="5"/><ellipse cx="70" cy="72" rx="3.6" ry="5"/></g>
      <circle cx="51.4" cy="70" r="1.3" fill="#fff"/><circle cx="71.4" cy="70" r="1.3" fill="#fff"/>
      <path d="M60 80 q-3.5 4.5 -7 2.5 M60 80 q3.5 4.5 7 2.5" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="40" cy="80" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="80" cy="80" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <g class="m-arm"><path d="M86 76 q15 -6 18 -22" stroke="var(--accent-deep)" stroke-width="7" stroke-linecap="round"/><circle cx="105" cy="51" r="6.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/></g>
      <path d="M34 76 q-12 3 -14 13" stroke="var(--accent-deep)" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="48" cy="106" rx="7" ry="4.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <ellipse cx="72" cy="106" rx="7" ry="4.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
    </svg>`,
    // 粉色小恶魔（带头饰与翅膀）
    pinkdevil: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M16 40 c-2.5 -3 -7 -1 -6 3 c.8 3.6 6 7 6 7 s5.2 -3.4 6 -7 c1 -4 -3.5 -6 -6 -3 z" opacity=".75"/>
        <path class="m-h2" d="M102 36 c-2 -2.4 -5.6 -.8 -4.8 2.4 c.6 2.9 4.8 5.6 4.8 5.6 s4.2 -2.7 4.8 -5.6 c.8 -3.2 -2.8 -4.8 -4.8 -2.4 z" opacity=".55"/>
      </g>
      <path d="M28 78 q-18 -6 -20 -26 q16 2 22 14 z" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M92 78 q18 -6 20 -26 q-16 2 -22 14 z" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M36 42 L28 20 L52 34 Z" fill="var(--accent-deep)"/>
      <path d="M84 42 L92 20 L68 34 Z" fill="var(--accent-deep)"/>
      <path d="M28 18 l-8 -5 a3.4 3.4 0 0 0 1 7 z M28 18 l8 -5 a3.4 3.4 0 0 1 -1 7 z" fill="var(--accent-deep)"/>
      <circle cx="28" cy="19" r="3" fill="var(--mascot-cream)"/>
      <ellipse cx="60" cy="56" rx="30" ry="27" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="49" cy="53" rx="4" ry="5.6"/><ellipse cx="71" cy="53" rx="4" ry="5.6"/></g>
      <circle cx="50.4" cy="50.6" r="1.4" fill="#fff"/><circle cx="72.4" cy="50.6" r="1.4" fill="#fff"/>
      <path d="M44 47 l-4 -3 M76 47 l4 -3" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M60 61 l-2.4 2.6 h4.8 z" fill="var(--accent-deep)"/>
      <path d="M60 64 q-4 5 -8 2.5 M60 64 q4 5 8 2.5" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="39" cy="62" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="81" cy="62" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <path d="M44 84 q16 -6 32 0 q4 12 -2 16 h-28 q-6 -4 -2 -16 z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/>
      <g class="m-arm"><path d="M84 88 q16 -6 19 -22" stroke="var(--accent-deep)" stroke-width="7" stroke-linecap="round"/><circle cx="104" cy="63" r="6.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/></g>
      <path d="M36 88 q-13 2 -15 12" stroke="var(--accent-deep)" stroke-width="7" stroke-linecap="round"/>
      <path d="M78 98 q16 2 20 -6 q-4 12 -18 10 z" fill="var(--accent-deep)"/>
      <path d="M98 92 l7 -5 3 8 -8 3 z" fill="var(--accent-deep)"/>
    </svg>`,
    // 橙色小太阳
    sun: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-rays" stroke="var(--accent-deep)" stroke-width="5" stroke-linecap="round">
        <path d="M60 6 v-0 M60 6 v10 M60 114 v10 M6 60 h10 M104 60 h10 M22 22 l7 7 M91 91 l7 7 M98 22 l-7 7 M29 91 l-7 7"/>
      </g>
      <circle cx="60" cy="60" r="27" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <path d="M48 55 q4 4.5 8 0 M64 55 q4 4.5 8 0" stroke="var(--ink)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M60 66 q-5 6 -9 3 M60 66 q5 6 9 3" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="44" cy="64" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="76" cy="64" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <g class="m-arm"><path d="M84 70 q12 -4 15 -14" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/></g>
      <path d="M36 70 q-12 -4 -15 -14" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <ellipse cx="50" cy="93" rx="7" ry="4.5" fill="var(--accent-deep)"/>
      <ellipse cx="70" cy="93" rx="7" ry="4.5" fill="var(--accent-deep)"/>
    </svg>`,
    // 黄色小鸡（持星星棒）
    chick: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M18 30 l2.2 5.2 5.2 2.2 -5.2 2.2 -2.2 5.2 -2.2 -5.2 -5.2 -2.2 5.2 -2.2 z" opacity=".7"/>
        <path class="m-h2" d="M100 40 l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8 z" opacity=".5"/>
      </g>
      <path d="M60 16 q-2 -8 4 -10 M56 18 q-6 -4 -8 -9 M64 18 q6 -4 8 -9" stroke="var(--accent-deep)" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="60" cy="66" rx="31" ry="29" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <ellipse cx="60" cy="76" rx="18" ry="15" fill="var(--mascot-cream)"/>
      <path d="M60 58 l-4 4.4 h8 z" fill="var(--accent-deep)"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="49" cy="52" rx="3.8" ry="5.2"/><ellipse cx="71" cy="52" rx="3.8" ry="5.2"/></g>
      <circle cx="50.4" cy="50" r="1.3" fill="#fff"/><circle cx="72.4" cy="50" r="1.3" fill="#fff"/>
      <ellipse cx="38" cy="60" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="82" cy="60" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="34" cy="72" rx="8" ry="11" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5" transform="rotate(14 34 72)"/>
      <g class="m-arm"><path d="M84 74 q14 -6 17 -20" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/><path d="M101 54 l3 7.4 7.4 3 -7.4 3 -3 7.4 -3 -7.4 -7.4 -3 7.4 -3 z" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="2" stroke-linejoin="round"/></g>
      <path d="M52 96 v6 M68 96 v6" stroke="var(--accent-deep)" stroke-width="4" stroke-linecap="round"/>
      <path d="M46 102 h12 M62 102 h12" stroke="var(--accent-deep)" stroke-width="4" stroke-linecap="round"/>
    </svg>`,
    // 绿色小树
    tree: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M18 32 c-2 -2.4 -5.6 -.8 -4.8 2.4 c.6 2.9 4.8 5.6 4.8 5.6 s4.2 -2.7 4.8 -5.6 c.8 -3.2 -2.8 -4.8 -4.8 -2.4 z" opacity=".6"/>
        <path class="m-h2" d="M100 28 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 z" opacity=".5"/>
      </g>
      <rect x="53" y="66" width="14" height="32" rx="6" fill="var(--accent-deep)"/>
      <circle cx="60" cy="44" r="21" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <circle cx="40" cy="58" r="15" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <circle cx="80" cy="58" r="15" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="52" cy="48" rx="3.4" ry="4.8"/><ellipse cx="68" cy="48" rx="3.4" ry="4.8"/></g>
      <circle cx="53.3" cy="46.2" r="1.2" fill="#fff"/><circle cx="69.3" cy="46.2" r="1.2" fill="#fff"/>
      <path d="M60 55 q-3 4 -6 2.2 M60 55 q3 4 6 2.2" stroke="var(--accent-deep)" stroke-width="1.9" stroke-linecap="round" fill="none"/>
      <ellipse cx="43" cy="55" rx="4.2" ry="2.6" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="77" cy="55" rx="4.2" ry="2.6" fill="var(--accent-deep)" opacity=".4"/>
      <g class="m-arm"><path d="M40 74 q-13 -4 -16 -16" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/></g>
      <path d="M80 74 q13 -4 16 -16" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M40 100 q20 6 40 0" stroke="var(--accent-deep)" stroke-width="3" stroke-linecap="round" fill="none" opacity=".6"/>
    </svg>`,
    // 蓝色小鲸鱼
    whale: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M52 14 c-2 -2.6 -6 -.8 -5 2.6 c.7 3 5 5.8 5 5.8 s4.3 -2.8 5 -5.8 c1 -3.4 -3 -5.2 -5 -2.6 z" opacity=".8"/>
        <path class="m-h2" d="M70 8 c-1.6 -2.2 -5 -.7 -4.2 2.2 c.6 2.5 4.2 4.9 4.2 4.9 s3.6 -2.4 4.2 -4.9 c.8 -2.9 -2.6 -4.4 -4.2 -2.2 z" opacity=".6"/>
        <path class="m-h3" d="M36 20 c-1.4 -1.8 -4 -.6 -3.4 1.8 c.5 2 3.4 4 3.4 4 s2.9 -2 3.4 -4 c.7 -2.3 -2 -3.6 -3.4 -1.8 z" opacity=".5"/>
      </g>
      <path d="M82 54 l24 -16 v44 z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/>
      <ellipse cx="48" cy="62" rx="38" ry="27" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <ellipse cx="44" cy="72" rx="25" ry="15" fill="var(--mascot-cream)"/>
      <circle cx="30" cy="54" r="3.4" fill="var(--ink)"/>
      <circle cx="31.2" cy="52.8" r="1.2" fill="#fff"/>
      <path d="M28 62 q6 6 13 3" stroke="var(--accent-deep)" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <ellipse cx="22" cy="63" rx="4.4" ry="2.7" fill="var(--accent-deep)" opacity=".4"/>
      <path d="M14 94 q10 -8 20 0 M86 94 q10 -8 20 0" stroke="var(--accent-deep)" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="24" cy="100" r="2.6" fill="var(--accent-deep)" opacity=".7"/>
      <circle cx="96" cy="100" r="2.6" fill="var(--accent-deep)" opacity=".7"/>
    </svg>`,
    // 靛色月亮
    moon: `<svg viewBox="0 0 120 120" fill="none">
      <circle cx="60" cy="60" r="36" fill="var(--pink-white-deep)" stroke="var(--accent-deep)" stroke-width="2.5" opacity=".9"/>
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M22 26 l2.2 5.2 5.2 2.2 -5.2 2.2 -2.2 5.2 -2.2 -5.2 -5.2 -2.2 5.2 -2.2 z" opacity=".8"/>
        <path class="m-h2" d="M98 34 l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8 z" opacity=".6"/>
        <path class="m-h3" d="M94 92 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 z" opacity=".5"/>
      </g>
      <circle cx="58" cy="60" r="26" fill="var(--accent-deep)"/>
      <circle cx="72" cy="50" r="21" fill="var(--pink-white-deep)"/>
      <path d="M42 56 q4 4.5 8 0" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M46 68 q-3.5 4.5 -7 2.5 M46 68 q3.5 4.5 7 2.5" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="40" cy="64" rx="4.2" ry="2.6" fill="#fff" opacity=".35"/>
    </svg>`,
    // 紫色小葡萄
    grapes: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M20 34 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 z" opacity=".7"/>
        <path class="m-h2" d="M98 28 l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8 z" opacity=".55"/>
      </g>
      <path d="M60 40 v-12" stroke="var(--accent-deep)" stroke-width="4" stroke-linecap="round"/>
      <path d="M60 30 q-14 -12 -24 -4 q-2 12 16 10 z" fill="var(--accent-deep)"/>
      <circle cx="60" cy="48" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="46" cy="60" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="74" cy="60" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="36" cy="72" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="60" cy="72" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="84" cy="72" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="46" cy="84" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="74" cy="84" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="60" cy="95" r="9.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="55" cy="46" rx="2.8" ry="3.8"/><ellipse cx="65" cy="46" rx="2.8" ry="3.8"/></g>
      <circle cx="56" cy="44.6" r="1" fill="#fff"/><circle cx="66" cy="44.6" r="1" fill="#fff"/>
      <path d="M60 52 q-2.2 3 -4.5 1.7 M60 52 q2.2 3 4.5 1.7" stroke="var(--accent-deep)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <ellipse cx="49" cy="52" rx="3" ry="1.9" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="71" cy="52" rx="3" ry="1.9" fill="var(--accent-deep)" opacity=".4"/>
      <g class="m-arm"><path d="M88 66 q14 -6 17 -20" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/><path d="M105 46 l3 7.4 7.4 3 -7.4 3 -3 7.4 -3 -7.4 -7.4 -3 7.4 -3 z" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="2" stroke-linejoin="round"/></g>
      <path d="M32 66 q-14 -6 -17 -20" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
    </svg>`,
    // 爱心角色
    heart: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M20 28 c-2 -2.4 -5.6 -.8 -4.8 2.4 c.6 2.9 4.8 5.6 4.8 5.6 s4.2 -2.7 4.8 -5.6 c.8 -3.2 -2.8 -4.8 -4.8 -2.4 z" opacity=".75"/>
        <path class="m-h2" d="M98 36 c-2 -2.4 -5.6 -.8 -4.8 2.4 c.6 2.9 4.8 5.6 4.8 5.6 s4.2 -2.7 4.8 -5.6 c.8 -3.2 -2.8 -4.8 -4.8 -2.4 z" opacity=".55"/>
      </g>
      <path d="M30 80 q-14 -2 -18 -16" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M90 80 q14 -2 18 -16" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M60 102 C28 76 22 56 38 44 C51 34 60 45 60 54 C60 45 69 34 82 44 C98 56 92 76 60 102 Z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="49" cy="56" rx="3.8" ry="5.2"/><ellipse cx="71" cy="56" rx="3.8" ry="5.2"/></g>
      <circle cx="50.4" cy="54" r="1.3" fill="#fff"/><circle cx="72.4" cy="54" r="1.3" fill="#fff"/>
      <path d="M60 65 q-3.5 4.5 -7 2.5 M60 65 q3.5 4.5 7 2.5" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="41" cy="65" rx="4.5" ry="2.8" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="79" cy="65" rx="4.5" ry="2.8" fill="var(--accent-deep)" opacity=".4"/>
    </svg>`,
    // 星星角色
    star: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M18 30 l2.2 5.2 5.2 2.2 -5.2 2.2 -2.2 5.2 -2.2 -5.2 -5.2 -2.2 5.2 -2.2 z" opacity=".75"/>
        <path class="m-h2" d="M100 40 l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8 z" opacity=".55"/>
      </g>
      <path d="M32 88 q-13 -2 -17 -14" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M88 88 q13 -2 17 -14" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M60 8 L73 44 L110 50 L82 73 L90 110 L60 89 L30 110 L38 73 L10 50 L47 44 Z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="50" cy="56" rx="3.8" ry="5.2"/><ellipse cx="70" cy="56" rx="3.8" ry="5.2"/></g>
      <circle cx="51.4" cy="54" r="1.3" fill="#fff"/><circle cx="71.4" cy="54" r="1.3" fill="#fff"/>
      <path d="M60 64 q-3.5 4.5 -7 2.5 M60 64 q3.5 4.5 7 2.5" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="42" cy="64" rx="4.5" ry="2.8" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="78" cy="64" rx="4.5" ry="2.8" fill="var(--accent-deep)" opacity=".4"/>
    </svg>`,
    // 云朵角色（打瞌睡）
    cloud: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <text class="m-z1" x="90" y="30" font-size="13" font-weight="700" opacity=".7">Z</text>
        <text class="m-z2" x="100" y="20" font-size="10" font-weight="700" opacity=".5">Z</text>
      </g>
      <path d="M30 84 q-12 -2 -16 -12" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <path d="M90 84 q12 -2 16 -12" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <circle cx="38" cy="60" r="17" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="3"/>
      <circle cx="62" cy="47" r="21" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="3"/>
      <circle cx="82" cy="60" r="15" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="3"/>
      <path d="M22 60 h76" stroke="var(--accent-deep)" stroke-width="3" stroke-linecap="round"/>
      <path d="M42 57 q4 4 8 0 M64 57 q4 4 8 0" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M54 70 q6 5 12 0" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="35" cy="68" rx="4.5" ry="2.8" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="81" cy="68" rx="4.5" ry="2.8" fill="var(--accent-deep)" opacity=".4"/>
    </svg>`,
    // 小熊角色
    bear: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M100 30 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 z" opacity=".6"/>
        <path class="m-h2" d="M18 38 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6 z" opacity=".5"/>
      </g>
      <g class="m-ear-l"><circle cx="32" cy="32" r="11" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/><circle cx="32" cy="32" r="5" fill="var(--accent-deep)" opacity=".4"/></g>
      <g class="m-ear-r"><circle cx="88" cy="32" r="11" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/><circle cx="88" cy="32" r="5" fill="var(--accent-deep)" opacity=".4"/></g>
      <circle cx="60" cy="58" r="30" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3"/>
      <ellipse cx="60" cy="66" rx="17" ry="13" fill="var(--mascot-cream)"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="49" cy="53" rx="3.8" ry="5"/><ellipse cx="71" cy="53" rx="3.8" ry="5"/></g>
      <circle cx="50.4" cy="51" r="1.3" fill="#fff"/><circle cx="72.4" cy="51" r="1.3" fill="#fff"/>
      <ellipse cx="60" cy="63" rx="5" ry="4" fill="var(--accent-deep)"/>
      <path d="M60 67 v3 M60 70 q-5 4 -8 1 M60 70 q5 4 8 1" stroke="var(--accent-deep)" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="38" cy="63" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="82" cy="63" rx="5" ry="3" fill="var(--accent-deep)" opacity=".4"/>
      <path d="M42 88 q18 -6 36 0 q4 12 -2 16 h-32 q-6 -4 -2 -16 z" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="3" stroke-linejoin="round"/>
      <ellipse cx="60" cy="96" rx="9" ry="6" fill="var(--mascot-cream)"/>
      <g class="m-arm"><path d="M40 90 q-14 -6 -18 -20" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/></g>
      <path d="M80 90 q14 -6 18 -20" stroke="var(--accent-deep)" stroke-width="6" stroke-linecap="round"/>
      <ellipse cx="48" cy="106" rx="7" ry="4.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <ellipse cx="72" cy="106" rx="7" ry="4.5" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
    </svg>`,
    // 小花角色
    flower: `<svg viewBox="0 0 120 120" fill="none">
      <g class="m-float" fill="var(--accent-deep)">
        <path class="m-h1" d="M20 28 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 z" opacity=".7"/>
        <path class="m-h2" d="M98 36 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6 z" opacity=".5"/>
      </g>
      <path d="M60 100 v-22" stroke="var(--accent-deep)" stroke-width="4" stroke-linecap="round"/>
      <path d="M60 84 q-12 -2 -15 -12 M60 90 q12 -2 15 -12" stroke="var(--accent-deep)" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="60" cy="20" r="10" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="79" cy="31" r="10" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="74" cy="52" r="10" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="46" cy="52" r="10" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="41" cy="31" r="10" fill="var(--accent)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <circle cx="60" cy="38" r="15" fill="var(--mascot-cream)" stroke="var(--accent-deep)" stroke-width="2.5"/>
      <g class="m-eyes" fill="var(--ink)"><ellipse cx="54" cy="36" rx="2.8" ry="3.8"/><ellipse cx="66" cy="36" rx="2.8" ry="3.8"/></g>
      <circle cx="55" cy="34.6" r="1" fill="#fff"/><circle cx="67" cy="34.6" r="1" fill="#fff"/>
      <path d="M60 41 q-2.5 3.2 -5 1.8 M60 41 q2.5 3.2 5 1.8" stroke="var(--accent-deep)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <ellipse cx="49" cy="42" rx="3.2" ry="2" fill="var(--accent-deep)" opacity=".4"/>
      <ellipse cx="71" cy="42" rx="3.2" ry="2" fill="var(--accent-deep)" opacity=".4"/>
    </svg>`,
  };

  const MASCOT_PHRASES = [
    '今天也超级可爱！',
    '加油加油～',
    '记得喝水哦 💧',
    '休息一下吧 ☁️',
    '你最棒啦 ✨',
    '慢慢来，不着急 🍀',
    '写完这一条就奖励自己 🍰',
  ];

  let theme = { ...DEFAULT_THEME };
  let themeSaveTimer = null;

  function normalizeHex(v) {
    let h = String(v == null ? '' : v).trim();
    if (/^#?[0-9a-fA-F]{3}$/.test(h)) {
      h = h.replace(/^#/, '').split('').map((c) => c + c).join('');
    } else {
      h = h.replace(/^#/, '');
    }
    return /^[0-9a-fA-F]{6}$/.test(h) ? ('#' + h.toUpperCase()) : null;
  }

  function hexToRgb(hex) {
    const h = normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function applyTheme(t) {
    theme = { ...DEFAULT_THEME, ...(t || {}) };
    const root = document.documentElement.style;
    const bg = hexToRgb(theme.bg) || hexToRgb(DEFAULT_THEME.bg);
    const bgD = hexToRgb(theme.bgDeep) || hexToRgb(DEFAULT_THEME.bgDeep);
    const ac = hexToRgb(theme.accent) || hexToRgb(DEFAULT_THEME.accent);
    const acd = hexToRgb(theme.accentDeep) || hexToRgb(DEFAULT_THEME.accentDeep);
    const a = Math.min(1, Math.max(0.6, Number(theme.opacity) || DEFAULT_THEME.opacity));

    // 背景
    root.setProperty('--note-bg',
      `linear-gradient(165deg, rgba(${bg.r},${bg.g},${bg.b},${a}) 0%, rgba(${bgD.r},${bgD.g},${bgD.b},${a}) 100%)`);
    // 基础色
    root.setProperty('--pink-white', theme.bg);
    root.setProperty('--pink-white-deep', theme.bgDeep);
    root.setProperty('--accent', theme.accent);
    root.setProperty('--accent-deep', theme.accentDeep);
    root.setProperty('--ink', theme.ink);
    // 派生色（虚线、阴影、波浪线、发光等都跟随主题）
    root.setProperty('--accent-soft', `rgba(${ac.r},${ac.g},${ac.b},0.6)`);
    root.setProperty('--accent-softer', `rgba(${ac.r},${ac.g},${ac.b},0.32)`);
    root.setProperty('--accent-tint', `rgba(${ac.r},${ac.g},${ac.b},0.16)`);
    root.setProperty('--accent-deep-soft', `rgba(${acd.r},${acd.g},${acd.b},0.5)`);
    root.setProperty('--shadow-soft', `rgba(${acd.r},${acd.g},${acd.b},0.3)`);
    root.setProperty('--shadow-softer', `rgba(${acd.r},${acd.g},${acd.b},0.18)`);
    root.setProperty('--wave-url',
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='8' viewBox='0 0 24 8'%3E%3Cpath d='M0 4 Q6 0 12 4 T24 4' fill='none' stroke='${encodeURIComponent(theme.accent)}' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E")`);

    applyDoodles(theme.doodle);
    applyMascot(theme.mascot);
  }

  let currentDoodle = null;

  function applyDoodles(type) {
    const t = DOODLES[type] !== undefined ? type : 'kitty';
    theme.doodle = t;
    if (t === currentDoodle) return; // 结构没变，颜色由 CSS 变量自动驱动
    currentDoodle = t;
    els.doodles.innerHTML = '';
    const svg = DOODLES[t];
    if (!svg) return;
    DOODLE_LAYOUT.forEach((d, i) => {
      const span = document.createElement('span');
      span.className = 'doodle';
      span.style.left = d.left;
      span.style.top = d.top;
      span.style.width = d.size + 'px';
      span.style.height = d.size + 'px';
      span.style.setProperty('--rot', d.rotate + 'deg');
      span.style.animationDelay = (i * 1.4).toFixed(1) + 's';
      span.innerHTML = svg;
      els.doodles.appendChild(span);
    });
  }

  // 精致 PNG 形象（AI 生成，透明底）：替代部分简笔 SVG
  const MASCOT_IMAGES = {
    kitty: 'assets/mascot-kitty.png',
    kuromi: 'assets/mascot-kuromi.png',
    melody: 'assets/mascot-melody.png',
    pikachu: 'assets/mascot-pikachu.png',
    doraemon: 'assets/mascot-doraemon.png',
    cinnamoroll: 'assets/mascot-cinnamoroll.png',
    redpanda: 'assets/mascot-redpanda.png',
    charmander: 'assets/mascot-charmander.png',
    bulbasaur: 'assets/mascot-bulbasaur.png',
    keropi: 'assets/mascot-keropi.png',
    littletwin: 'assets/mascot-littletwin.png',
    cheshire: 'assets/mascot-cheshire.png',
    rilakkuma: 'assets/mascot-rilakkuma.png',
    // 旧 key 别名（兼容历史主题存档）
    pinkdevil: 'assets/mascot-melody.png',
    chick: 'assets/mascot-pikachu.png',
    whale: 'assets/mascot-doraemon.png',
    cloud: 'assets/mascot-cinnamoroll.png',
    fire: 'assets/mascot-redpanda.png',
    sun: 'assets/mascot-charmander.png',
    tree: 'assets/mascot-bulbasaur.png',
    flower: 'assets/mascot-keropi.png',
    moon: 'assets/mascot-littletwin.png',
    grapes: 'assets/mascot-cheshire.png',
    bear: 'assets/mascot-rilakkuma.png',
  };

  function mascotHtml(t) {
    if (MASCOT_IMAGES[t]) {
      return `<img class="mascot-img" src="${MASCOT_IMAGES[t]}" alt="" draggable="false">`;
    }
    return MASCOTS[t] || '';
  }

  let currentMascot = null;

  function applyMascot(type) {
    const t = (MASCOTS[type] !== undefined || MASCOT_IMAGES[type]) ? type : 'kitty';
    theme.mascot = t;
    if (t === currentMascot) return; // 结构没变，颜色由 CSS 变量自动驱动
    currentMascot = t;
    els.mascot.innerHTML = mascotHtml(t);
    els.mascot.classList.toggle('has-mascot', !!(MASCOTS[t] || MASCOT_IMAGES[t]));
  }

  // 点击吉祥物：跳跃 + 爱心 + 随机鼓励语
  function bindMascotInteraction() {
    const react = () => {
      if (!currentMascot || currentMascot === 'none') return;
      els.mascot.classList.remove('jump');
      void els.mascot.offsetWidth;
      els.mascot.classList.add('jump');
      spawnHearts(els.mascot, 5, 26);
      toast(MASCOT_PHRASES[Math.floor(Math.random() * MASCOT_PHRASES.length)]);
      setTimeout(() => els.mascot.classList.remove('jump'), 700);
    };
    els.mascot.addEventListener('click', react);
    els.mascot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        react();
      }
    });
  }

  function saveTheme() {
    clearTimeout(themeSaveTimer);
    themeSaveTimer = setTimeout(() => api.saveTheme(theme), 300);
  }

  function bindTheme() {
    buildThemeRows();
    buildDoodlePicker();
    bindMascotInteraction();

    // 颜色卡片懒加载：首次打开调色盘时才构建（避免启动时加载全部吉祥物图片）
    let presetsBuilt = false;
    els.btnTheme.addEventListener('click', () => {
      els.themePanel.hidden = !els.themePanel.hidden;
      if (!els.themePanel.hidden) {
        if (!presetsBuilt) {
          buildThemePresets();
          presetsBuilt = true;
        }
        syncThemePanel();
      }
    });
    els.btnThemeClose.addEventListener('click', () => { els.themePanel.hidden = true; });
    els.btnThemeReset.addEventListener('click', () => {
      applyTheme(DEFAULT_THEME);
      syncThemePanel();
      saveTheme();
      toast('🎨 已恢复默认配色');
    });
    els.rOpacity.addEventListener('input', () => {
      theme.opacity = Number(els.rOpacity.value) / 100;
      els.vOpacity.textContent = els.rOpacity.value + '%';
      applyTheme(theme);
      saveTheme();
    });
  }

  function buildThemeRows() {
    THEME_FIELDS.forEach(([key, colorId, hexId, label]) => {
      const row = document.createElement('div');
      row.className = 'theme-row';

      const lb = document.createElement('label');
      lb.textContent = label;
      lb.htmlFor = hexId;

      const color = document.createElement('input');
      color.type = 'color';
      color.id = colorId;

      const hex = document.createElement('input');
      hex.type = 'text';
      hex.id = hexId;
      hex.className = 'hex';
      hex.maxLength = 7;
      hex.spellcheck = false;

      color.addEventListener('input', () => {
        theme[key] = color.value.toUpperCase();
        hex.value = theme[key];
        hex.classList.remove('invalid');
        applyTheme(theme);
        saveTheme();
        syncPresetActive();
      });

      hex.addEventListener('change', () => {
        const v = normalizeHex(hex.value);
        if (!v) {
          hex.classList.add('invalid');
          hex.value = theme[key];
          return;
        }
        hex.classList.remove('invalid');
        theme[key] = v;
        color.value = v;
        hex.value = v;
        applyTheme(theme);
        saveTheme();
        syncPresetActive();
      });

      row.appendChild(lb);
      row.appendChild(color);
      row.appendChild(hex);
      els.themeRows.appendChild(row);
    });
  }

  function buildThemePresets() {
    PRESETS.forEach((p) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card';
      card.title = p.name + '主题';
      card.style.background = `linear-gradient(150deg, ${p.bg}, ${p.bgDeep})`;

      // 卡片内的小吉祥物使用该主题自己的颜色
      const icon = document.createElement('span');
      icon.className = 'theme-card-icon';
      icon.style.setProperty('--accent', p.accent);
      icon.style.setProperty('--accent-deep', p.accentDeep);
      icon.style.setProperty('--ink', p.ink);
      icon.style.setProperty('--mascot-cream', p.bg);
      icon.style.setProperty('--pink-white-deep', p.bgDeep);
      icon.innerHTML = mascotHtml(p.mascot);

      const label = document.createElement('span');
      label.className = 'theme-card-name';
      label.textContent = p.name;

      card.appendChild(icon);
      card.appendChild(label);
      card.addEventListener('click', () => {
        applyTheme(p);
        syncThemePanel();
        saveTheme();
        toast('🎨 已切换：' + p.name);
      });
      els.themePresets.appendChild(card);
    });
  }

  function syncThemePanel() {
    THEME_FIELDS.forEach(([key, colorId, hexId]) => {
      const c = document.getElementById(colorId);
      const h = document.getElementById(hexId);
      if (c) c.value = theme[key];
      if (h) h.value = theme[key];
    });
    els.rOpacity.value = Math.round((theme.opacity || 0.98) * 100);
    els.vOpacity.textContent = els.rOpacity.value + '%';
    syncPresetActive();
    syncDoodleActive();
  }

  function buildDoodlePicker() {
    DOODLE_OPTIONS.forEach(([type, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'doodle-opt';
      b.title = label;
      b.dataset.doodle = type;
      b.innerHTML = DOODLES[type] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>';
      b.addEventListener('click', () => {
        applyDoodles(type);
        syncDoodleActive();
        saveTheme();
        toast('🖌️ 背景简笔画：' + label);
      });
      els.doodlePicker.appendChild(b);
    });
  }

  function syncDoodleActive() {
    const btns = els.doodlePicker.children;
    for (let i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.doodle === theme.doodle);
    }
  }

  function syncPresetActive() {
    const btns = els.themePresets.children;
    for (let i = 0; i < btns.length; i++) {
      const p = PRESETS[i];
      const same = normalizeHex(p.bg) === normalizeHex(theme.bg) &&
        normalizeHex(p.accent) === normalizeHex(theme.accent);
      btns[i].classList.toggle('active', same);
    }
  }

  /* ---------------- 提醒触发 ---------------- */

  function onReminder(payload) {
    const li = els.list.querySelector('.item[data-id="' + payload.id + '"]');
    els.note.classList.remove('reminding');
    void els.note.offsetWidth;
    els.note.classList.add('reminding');
    playChime();
    toast('⏰ 该做啦：' + (payload.text || '一件事'));
    if (li) {
      li.scrollIntoView({ block: 'nearest' });
      li.classList.add('flash');
      setTimeout(() => li.classList.remove('flash'), 2800);
    }
    clearTimeout(remindTimer);
    remindTimer = setTimeout(() => els.note.classList.remove('reminding'), 6500);
  }

  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [880, 1174.7].forEach((freq, i) => {
        const t = now + i * 0.18;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      });
    } catch (e) { /* 音频不可用时静默 */ }
  }

  /* ---------------- 光标小星星 ---------------- */

  function bindCaretStar() {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateCaretStar();
      });
    };
    ['keyup', 'input', 'mouseup', 'focus'].forEach((ev) =>
      document.addEventListener(ev, schedule));
    document.addEventListener('selectionchange', schedule);
  }

  function updateCaretStar() {
    const active = document.activeElement;
    const star = els.star;
    if (!active) {
      star.style.opacity = '0';
      return;
    }

    let rect = null;

    if (active.isContentEditable) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !active.contains(sel.anchorNode)) {
        star.style.opacity = '0';
        return;
      }
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      rect = range.getClientRects()[0];
      if (!rect) {
        // 空行：插入零宽字符临时测量
        const span = document.createElement('span');
        span.textContent = '\u200B';
        range.insertNode(span);
        rect = span.getBoundingClientRect();
        const parent = span.parentNode;
        span.remove();
        if (parent && parent.normalize) parent.normalize();
      }
    } else if (active.tagName === 'INPUT' && active.type === 'text') {
      const idx = active.selectionStart == null ? active.value.length : active.selectionStart;
      const canvas = updateCaretStar._canvas ||
        (updateCaretStar._canvas = document.createElement('canvas'));
      const ctx = canvas.getContext('2d');
      ctx.font = getComputedStyle(active).font;
      const textW = ctx.measureText(active.value.slice(0, idx)).width;
      const r = active.getBoundingClientRect();
      const cs = getComputedStyle(active);
      const left = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + textW;
      rect = { left: Math.min(left, r.right - 2), top: r.top + parseFloat(cs.paddingTop) };
    }

    if (!rect) {
      star.style.opacity = '0';
      return;
    }
    star.style.opacity = '1';
    star.style.left = Math.max(2, Math.min(rect.left, window.innerWidth - 14)) + 'px';
    star.style.top = Math.max(2, rect.top - 13) + 'px';
  }

  /* ---------------- 爱心飘出 ---------------- */

  function spawnHearts(anchor, count, spread) {
    const r = anchor.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < count; i++) {
      const h = document.createElement('span');
      h.className = 'heart-fly';
      h.textContent = Math.random() < 0.3 ? '💗' : '♥';
      h.style.left = cx + 'px';
      h.style.top = cy + 'px';
      h.style.setProperty('--dx', (Math.random() * spread - spread / 2).toFixed(1) + 'px');
      h.style.setProperty('--rot', (Math.random() * 60 - 30).toFixed(0) + 'deg');
      h.style.fontSize = (10 + Math.random() * 8).toFixed(0) + 'px';
      h.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1400);
    }
  }

  /* ---------------- 工具函数 ---------------- */

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function toLocalInputValue(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatRemind(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now.getTime() + 86400000).toDateString() === d.toDateString();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (sameDay) return `今天 ${hm}`;
    if (tomorrow) return `明天 ${hm}`;
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  }

  init();
})();
