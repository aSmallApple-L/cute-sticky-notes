/**
 * 计时器 - 渲染进程
 * 负责：翻页时钟渲染 / 正计时与倒计时 / 时长设置 / 主题同步 /
 *       拖动缩放 / 状态持久化
 */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const api = window.sticky;

  const els = {
    card: $('#tCard'),
    title: $('#tTitle'),
    mascot: $('#tMascot'),
    btnClose: $('#btnTClose'),
    flip: $('#tFlip'),
    bar: $('#tBar'),
    barFill: $('#tBarFill'),
    status: $('#tStatus'),
    seg: $('#tSeg'),
    dur: $('#tDur'),
    durH: $('#durH'),
    durM: $('#durM'),
    durS: $('#durS'),
    chips: $('#tChips'),
    btnStart: $('#btnTStart'),
    btnReset: $('#btnTReset'),
    resize: $('#tResize'),
    toast: $('#toast'),
  };

  // 计时器状态（与主进程保持同一份数据结构）
  let state = {
    mode: 'down',        // 'down' 倒计时 | 'up' 正计时
    durationMs: 300000,  // 倒计时总时长（5 分钟）
    valueMs: 300000,     // 剩余 / 已用毫秒
    running: false,
    updatedAt: Date.now(),
  };

  let theme = {};
  let lastSave = 0;
  let tickTimer = null;
  let toastTimer = null;
  let rz = null;

  const MASCOT_PHRASES = [
    '加油加油～',
    '专注一小会儿 🍀',
    '你可以的 ✨',
    '做完就休息 ☁️',
    '慢慢来，不着急 🍰',
  ];

  // 计时器卡片角落的小吉祥物（跟随调色盘）
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
  };

  /* ---------------- 初始化 ---------------- */

  async function init() {
    if (!api) {
      document.body.innerHTML = '<p style="padding:24px;color:#000">请在 Electron 环境中运行</p>';
      return;
    }

    try {
      const loaded = await api.getTimerState();
      if (loaded) state = { ...state, ...loaded };
    } catch (e) { /* 用默认状态 */ }

    try {
      theme = await api.getTheme();
      applyTheme(theme);
    } catch (e) { /* noop */ }

    buildFlips();
    syncInputsFromState();
    renderAll(true);

    bindControls();
    bindResize();

    api.onThemeChanged((t) => { theme = t || {}; applyTheme(theme); });

    tickTimer = setInterval(tick, 250);
  }

  /* ---------------- 主题 ---------------- */

  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length === 3) {
      const s = h.split('').map((c) => c + c).join('');
      return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  function applyTheme(t) {
    theme = t || {};
    const root = document.documentElement.style;
    const bg = hexToRgb(theme.bg) || { r: 255, g: 247, b: 250 };
    const bgD = hexToRgb(theme.bgDeep) || { r: 255, g: 234, b: 242 };
    const ac = hexToRgb(theme.accent) || { r: 240, g: 156, b: 187 };
    const acd = hexToRgb(theme.accentDeep) || { r: 226, g: 120, b: 159 };
    const a = Math.min(1, Math.max(0.6, Number(theme.opacity) || 0.98));

    root.setProperty('--note-bg',
      `linear-gradient(165deg, rgba(${bg.r},${bg.g},${bg.b},${a}) 0%, rgba(${bgD.r},${bgD.g},${bgD.b},${a}) 100%)`);
    root.setProperty('--pink-white', theme.bg || '#FFF7FA');
    root.setProperty('--pink-white-deep', theme.bgDeep || '#FFEAF2');
    root.setProperty('--accent', theme.accent || '#F09CBB');
    root.setProperty('--accent-deep', theme.accentDeep || '#E2789F');
    root.setProperty('--ink', theme.ink || '#4A2A36');
    root.setProperty('--accent-soft', `rgba(${ac.r},${ac.g},${ac.b},0.6)`);
    root.setProperty('--accent-softer', `rgba(${ac.r},${ac.g},${ac.b},0.32)`);
    root.setProperty('--accent-deep-soft', `rgba(${acd.r},${acd.g},${acd.b},0.5)`);
    root.setProperty('--shadow-soft', `rgba(${acd.r},${acd.g},${acd.b},0.3)`);
    root.setProperty('--shadow-softer', `rgba(${acd.r},${acd.g},${acd.b},0.18)`);
    root.setProperty('--wave-url',
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='8' viewBox='0 0 24 8'%3E%3Cpath d='M0 4 Q6 0 12 4 T24 4' fill='none' stroke='${encodeURIComponent(theme.accent || '#F09CBB')}' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E")`);

    const m = MASCOT_IMAGES[theme.mascot];
    els.mascot.innerHTML = m ? `<img src="${m}" alt="" draggable="false">` : '';
  }

  /* ---------------- 翻页时钟 ---------------- */

  const digits = {};

  function buildFlips() {
    els.flip.querySelectorAll('.flip').forEach((el) => {
      el.innerHTML =
        '<div class="half top"><span>0</span></div>' +
        '<div class="half bottom"><span>0</span></div>' +
        '<div class="leaf leaf-front"><span>0</span></div>' +
        '<div class="leaf leaf-back"><span>0</span></div>';
      digits[el.dataset.unit] = {
        el,
        top: el.querySelector('.half.top span'),
        bottom: el.querySelector('.half.bottom span'),
        front: el.querySelector('.leaf-front span'),
        back: el.querySelector('.leaf-back span'),
        value: '0',
        flipping: false,
        timer: 0,
      };
    });
  }

  // 单个数字翻页：上片先落下露出新数字，下片再翻起落地
  function setDigit(unit, ch, animate) {
    const d = digits[unit];
    if (!d || d.value === ch) return;
    const old = d.value;
    d.value = ch;

    if (!animate || d.flipping) {
      clearTimeout(d.timer);
      d.top.textContent = ch;
      d.bottom.textContent = ch;
      d.front.textContent = ch;
      d.back.textContent = ch;
      d.el.classList.remove('flipping');
      d.flipping = false;
      return;
    }

    d.top.textContent = ch;
    d.bottom.textContent = old;
    d.front.textContent = old;
    d.back.textContent = ch;
    d.flipping = true;
    d.el.classList.remove('flipping');
    void d.el.offsetWidth;
    d.el.classList.add('flipping');
    clearTimeout(d.timer);
    d.timer = setTimeout(() => {
      d.bottom.textContent = ch;
      d.el.classList.remove('flipping');
      d.flipping = false;
    }, 460);
  }

  function showTime(totalSec, animate) {
    const t = Math.max(0, Math.min(99 * 3600 + 3599, Math.floor(totalSec)));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const str = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0');
    setDigit('h1', str[0], animate);
    setDigit('h2', str[1], animate);
    setDigit('m1', str[2], animate);
    setDigit('m2', str[3], animate);
    setDigit('s1', str[4], animate);
    setDigit('s2', str[5], animate);
  }

  /* ---------------- 计时核心 ---------------- */

  // 依据时间戳推算当前值：即使窗口被隐藏或重启也不会走偏
  function currentMs() {
    if (!state.running) return state.valueMs;
    const delta = Date.now() - state.updatedAt;
    return state.mode === 'down'
      ? Math.max(0, state.valueMs - delta)
      : state.valueMs + delta;
  }

  function fmt(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function tick() {
    const ms = currentMs();

    // 倒计时归零
    if (state.running && state.mode === 'down' && ms <= 0) {
      finish();
      return;
    }

    renderAll(false, ms);

    // 运行中每 5 秒落盘一次，重启后能接着算
    if (state.running && Date.now() - lastSave > 5000) {
      state.valueMs = ms;
      state.updatedAt = Date.now();
      save();
    }
  }

  function renderAll(force, msOverride) {
    const ms = msOverride == null ? currentMs() : msOverride;
    showTime(ms / 1000, !force);

    // 进度条：倒计时显示剩余比例，正计时显示本分钟内进度
    let ratio;
    if (state.mode === 'down') {
      ratio = state.durationMs > 0 ? ms / state.durationMs : 0;
    } else {
      ratio = (ms % 60000) / 60000;
    }
    els.barFill.style.width = (Math.max(0, Math.min(1, ratio)) * 100).toFixed(2) + '%';

    // 状态文字
    let text;
    let hurry = false;
    const restSec = Math.ceil(ms / 1000);
    if (state.mode === 'down') {
      if (state.running) {
        if (restSec <= 10) { text = '最后 ' + restSec + ' 秒，冲鸭！'; hurry = true; }
        else text = '倒计时中… 还剩 ' + fmt(ms);
      } else if (ms <= 0) {
        text = '时间到啦 🎉';
      } else {
        text = '已暂停 · 还剩 ' + fmt(ms);
      }
    } else if (state.running) {
      text = '已专注 ' + fmt(ms) + ' ✨';
    } else {
      text = state.valueMs > 0 ? '已暂停 · 共 ' + fmt(ms) : '点击开始，记录专注时间';
    }
    els.status.textContent = text;
    els.status.classList.toggle('hurry', hurry);

    els.btnStart.textContent = state.running ? '⏸ 暂停' : (state.valueMs > 0 ? '▶ 继续' : '▶ 开始');
    els.dur.hidden = state.mode !== 'down';
    syncSeg();
    syncChips();
  }

  function syncSeg() {
    els.seg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });
  }

  function syncChips() {
    els.chips.querySelectorAll('.t-chip').forEach((c) => {
      c.classList.toggle('active', Number(c.dataset.sec) === state.durationMs);
    });
  }

  function syncInputsFromState() {
    const t = Math.floor(state.durationMs / 1000);
    els.durH.value = Math.floor(t / 3600);
    els.durM.value = Math.floor((t % 3600) / 60);
    els.durS.value = t % 60;
  }

  /* ---------------- 控制 ---------------- */

  function bindControls() {
    els.btnClose.addEventListener('click', () => api.closeTimer());

    els.seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => switchMode(b.dataset.mode));
    });

    els.btnStart.addEventListener('click', toggleRun);
    els.btnReset.addEventListener('click', reset);

    [els.durH, els.durM, els.durS].forEach((input) => {
      input.addEventListener('change', applyDurationFromInputs);
    });

    els.chips.querySelectorAll('.t-chip').forEach((c) => {
      c.addEventListener('click', () => {
        state.durationMs = Number(c.dataset.sec) * 1000;
        state.valueMs = state.durationMs;
        state.running = false;
        syncInputsFromState();
        renderAll(true);
        save();
        toast('⏳ 已设为 ' + fmt(state.durationMs));
      });
    });

    // 点吉祥物：鼓励一下
    const cheer = () => {
      spawnHearts(els.mascot, 4, 18);
      toast(MASCOT_PHRASES[Math.floor(Math.random() * MASCOT_PHRASES.length)]);
    };
    els.mascot.addEventListener('click', cheer);
  }

  function switchMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    state.valueMs = mode === 'down' ? state.durationMs : 0;
    state.running = false;
    renderAll(true);
    save();
    toast(mode === 'down' ? '⏳ 倒计时模式' : '⏱ 正计时模式');
  }

  function toggleRun() {
    if (state.running) {
      // 暂停：把推算值写回，避免暂停期间继续走动
      state.valueMs = currentMs();
      state.running = false;
    } else {
      if (state.mode === 'down' && state.valueMs <= 0) state.valueMs = state.durationMs;
      if (state.mode === 'up' && state.valueMs < 0) state.valueMs = 0;
      state.running = true;
    }
    state.updatedAt = Date.now();
    renderAll(true);
    save();
  }

  function reset() {
    state.valueMs = state.mode === 'down' ? state.durationMs : 0;
    state.running = false;
    state.updatedAt = Date.now();
    Object.keys(digits).forEach((k) => digits[k].el.classList.remove('done'));
    renderAll(true);
    save();
    toast('↺ 已重置');
  }

  function applyDurationFromInputs() {
    const h = Math.max(0, Math.min(99, Number(els.durH.value) || 0));
    const m = Math.max(0, Math.min(59, Number(els.durM.value) || 0));
    const s = Math.max(0, Math.min(59, Number(els.durS.value) || 0));
    state.durationMs = ((h * 3600) + (m * 60) + s) * 1000;
    state.valueMs = state.durationMs;
    state.running = false;
    state.updatedAt = Date.now();
    syncInputsFromState();
    renderAll(true);
    save();
  }

  function finish() {
    state.valueMs = 0;
    state.running = false;
    state.updatedAt = Date.now();
    renderAll(true, 0);
    save();
    Object.keys(digits).forEach((k) => {
      digits[k].el.classList.remove('done');
      void digits[k].el.offsetWidth;
      digits[k].el.classList.add('done');
    });
    playChime();
    spawnHearts(els.btnStart, 8, 30);
    toast('🎉 时间到啦！休息一下吧～');
    els.status.textContent = '时间到啦 🎉';
    api.notifyDone('计时结束，起来活动一下呀～');
  }

  /* ---------------- 持久化 ---------------- */

  function save() {
    lastSave = Date.now();
    api.saveTimer({
      mode: state.mode,
      durationMs: state.durationMs,
      valueMs: state.valueMs,
      running: state.running,
      updatedAt: state.updatedAt,
    });
  }

  /* ---------------- 缩放 ---------------- */

  function bindResize() {
    els.resize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      rz = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
      document.body.classList.add('resizing');
    });
    window.addEventListener('mousemove', (e) => {
      if (!rz) return;
      api.resizeTimer(
        Math.max(470, rz.w + (e.screenX - rz.x)),
        Math.max(320, rz.h + (e.screenY - rz.y))
      );
    });
    window.addEventListener('mouseup', () => {
      if (!rz) return;
      rz = null;
      document.body.classList.remove('resizing');
    });
  }

  /* ---------------- 小玩意儿 ---------------- */

  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [880, 1174.7, 1567.98].forEach((freq, i) => {
        const t = now + i * 0.16;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      });
    } catch (e) { /* 音频不可用时静默 */ }
  }

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

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  window.addEventListener('beforeunload', () => {
    if (state.running) {
      state.valueMs = currentMs();
      state.updatedAt = Date.now();
      state.running = false;
      save();
    }
  });

  init();
})();
