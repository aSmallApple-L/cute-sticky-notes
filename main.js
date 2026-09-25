'use strict';

/**
 * 粉色悬浮便签 - Electron 主进程
 * 负责：透明无边框置顶窗口、托盘、快捷键、开机自启、
 *       本地 JSON 数据持久化、定时提醒引擎、点击穿透控制。
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  globalShortcut,
  shell,
  screen,
} = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// Windows 通知需要 AppUserModelID
if (isWin) app.setAppUserModelId('com.cute.stickynotes');

// 单实例：第二次启动时唤起已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showAllWindows());
}

const DATA_FILE = path.join(app.getPath('userData'), 'sticky-notes.json');
const TRAY_ICON = path.join(__dirname, 'assets', 'tray-icon.png');
const WINDOW_ICON = path.join(__dirname, 'assets', 'icon.png');

const noteWindows = new Map(); // id -> BrowserWindow
let tray = null;
let quitting = false;

// 全局主题（所有便签共享）
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

// 背景简笔画装饰类型
const DOODLE_TYPES = ['none', 'star', 'cloud', 'heart', 'flower'];
// 顶部吉祥物类型
const MASCOT_TYPES = [
  'none',
  'kitty', 'kuromi', 'melody', 'pikachu', 'doraemon', 'cinnamoroll',
  'redpanda', 'charmander', 'bulbasaur', 'keropi', 'littletwin',
  'cheshire', 'rilakkuma',
  // 旧 key 兼容
  'pinkdevil', 'fire', 'sun', 'chick', 'tree', 'whale', 'moon',
  'grapes', 'heart', 'star', 'cloud', 'bear', 'flower',
];

let db = { notes: [], autoLaunch: false, theme: { ...DEFAULT_THEME } };

function normalizeHex(v) {
  let h = String(v == null ? '' : v).trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = '#' + h.slice(1).split('').map((c) => c + c).join('');
  }
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : null;
}

function sanitizeTheme(t) {
  const out = { ...DEFAULT_THEME };
  const src = t || {};
  for (const k of ['bg', 'bgDeep', 'accent', 'accentDeep', 'ink']) {
    const v = normalizeHex(src[k]);
    if (v) out[k] = v;
  }
  const o = Number(src.opacity);
  if (!isNaN(o)) out.opacity = Math.min(1, Math.max(0.6, o));
  const d = String(src.doodle || '');
  if (DOODLE_TYPES.includes(d)) out.doodle = d;
  const m = String(src.mascot || '');
  if (MASCOT_TYPES.includes(m)) out.mascot = m;
  return out;
}

/* ---------------- 数据存取 ---------------- */

function loadDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.notes)) {
      db = {
        notes: parsed.notes,
        autoLaunch: !!parsed.autoLaunch,
        theme: sanitizeTheme(parsed.theme),
      };
      return;
    }
  } catch (e) {
    /* 首次运行或文件损坏，使用默认数据 */
  }
  db = { notes: [], autoLaunch: false, theme: { ...DEFAULT_THEME } };
}

function saveDB() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('保存数据失败:', e);
  }
}

function newId() {
  return 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultBounds(index) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 340;
  const height = 470;
  const step = (index % 6) * 30;
  return {
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - 40 - step),
    y: Math.round(workArea.y + 40 + step),
  };
}

/* ---------------- 便签数据 ---------------- */

function seedNote() {
  const note = {
    id: newId(),
    title: '今天要加油鸭 🐣',
    items: [
      { id: 'i_' + Math.random().toString(36).slice(2, 8), text: '喝一杯温水 💧', done: false, remindAt: null, remindFired: false },
      { id: 'i_' + Math.random().toString(36).slice(2, 8), text: '给桌面小绿植浇水 🌱', done: false, remindAt: null, remindFired: false },
      { id: 'i_' + Math.random().toString(36).slice(2, 8), text: '完成今天的代码 ✨', done: false, remindAt: null, remindFired: false },
      { id: 'i_' + Math.random().toString(36).slice(2, 8), text: '对自己说一句辛苦啦 💗', done: true, remindAt: null, remindFired: false },
    ],
    bounds: defaultBounds(0),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.notes.push(note);
  return note;
}

function createNoteFlow() {
  const note = {
    id: newId(),
    title: '新的便签',
    items: [],
    bounds: defaultBounds(db.notes.length),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.notes.push(note);
  saveDB();
  const win = createNoteWindow(note);
  if (win) win.show();
}

/* ---------------- 窗口 ---------------- */

function createNoteWindow(note) {
  const b = note.bounds || defaultBounds(0);

  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 260,
    minHeight: 300,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    icon: isWin ? WINDOW_ICON : TRAY_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.loadFile('index.html', { query: { note: note.id } });

  noteWindows.set(note.id, win);

  // 关闭 = 最小化到托盘（后台运行）
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => noteWindows.delete(note.id));

  // 位置 / 尺寸变化 -> 持久化 + 同步给渲染进程
  let persistTimer = null;
  let syncTimer = null;
  const persistBounds = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const n = db.notes.find((x) => x.id === note.id);
      if (n && !win.isDestroyed()) {
        n.bounds = win.getBounds();
        saveDB();
      }
    }, 250);
  };
  const syncBounds = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send('note:bounds', win.getBounds());
        } catch (e) { /* 窗口已销毁 */ }
      }
    }, 120);
  };
  win.on('move', () => { persistBounds(); syncBounds(); });
  win.on('resize', () => { persistBounds(); syncBounds(); });

  return win;
}

function showAllWindows() {
  for (const w of noteWindows.values()) {
    if (!w.isDestroyed()) {
      w.show();
      w.setAlwaysOnTop(true, 'floating');
    }
  }
}

function hideAllWindows() {
  for (const w of noteWindows.values()) {
    if (!w.isDestroyed()) w.hide();
  }
}

function toggleAllWindows() {
  let anyVisible = false;
  for (const w of noteWindows.values()) {
    if (!w.isDestroyed() && w.isVisible()) anyVisible = true;
  }
  anyVisible ? hideAllWindows() : showAllWindows();
}

function setAllTopmost(on) {
  for (const w of noteWindows.values()) {
    if (!w.isDestroyed()) {
      w.setAlwaysOnTop(!!on, on ? 'floating' : 'normal');
      try { w.webContents.send('topmost:state', !!on); } catch (e) { /* noop */ }
    }
  }
}

function setAllPassthrough(on) {
  for (const w of noteWindows.values()) {
    if (!w.isDestroyed()) {
      w.setIgnoreMouseEvents(!!on, { forward: true });
      try { w.webContents.send('passthrough:state', !!on); } catch (e) { /* noop */ }
    }
  }
}

/* ---------------- 托盘 ---------------- */

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '📝 新建便签', accelerator: 'Control+Alt+N', click: createNoteFlow },
    { label: '👀 显示 / 隐藏全部', accelerator: 'Control+Alt+H', click: toggleAllWindows },
    { type: 'separator' },
    { label: '📌 全部置顶', accelerator: 'Control+Alt+T', click: () => setAllTopmost(true) },
    { label: '🔓 取消全部置顶', click: () => setAllTopmost(false) },
    { label: '🐾 关闭点击穿透', accelerator: 'Control+Alt+C', click: () => setAllPassthrough(false) },
    { type: 'separator' },
    {
      label: '🚀 开机自启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => {
        app.setLoginItemSettings({ openAtLogin: mi.checked, openAsHidden: true });
        db.autoLaunch = mi.checked;
        saveDB();
      },
    },
    { label: '📂 打开数据文件夹', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '💗 退出', click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(TRAY_ICON);
  tray.setToolTip('粉色悬浮便签');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => toggleAllWindows());
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
}

// 托盘提示显示未完成数量，不打开便签也能看到
function updateTrayTooltip() {
  if (!tray || tray.isDestroyed()) return;
  let undone = 0;
  for (const n of db.notes) {
    for (const it of n.items || []) {
      if (!it.done) undone++;
    }
  }
  tray.setToolTip(undone > 0 ? `粉色悬浮便签 · ${undone} 条未完成` : '粉色悬浮便签 · 全部完成啦');
}

/* ---------------- 提醒引擎 ---------------- */

function notify(title, body, noteId) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: TRAY_ICON });
  n.on('click', () => {
    const w = noteWindows.get(noteId);
    if (w && !w.isDestroyed()) {
      w.show();
      w.focus();
    }
  });
  n.show();
}

function startReminderEngine() {
  setInterval(() => {
    const now = Date.now();
    for (const note of db.notes) {
      for (const item of note.items || []) {
        if (!item.remindAt || item.done || item.remindFired) continue;
        const t = new Date(item.remindAt).getTime();
        if (isNaN(t) || now < t) continue;

        item.remindFired = true;
        saveDB();

        const win = noteWindows.get(note.id);
        if (win && !win.isDestroyed()) {
          win.show();
          win.setAlwaysOnTop(true, 'floating');
          try {
            win.webContents.send('reminder:fire', {
              id: item.id,
              text: item.text || '一件事',
              time: item.remindAt,
            });
          } catch (e) { /* noop */ }
        }
        notify('⏰ 便签提醒', item.text || '该做事啦~', note.id);
      }
    }
  }, 1000);
}

/* ---------------- IPC ---------------- */

ipcMain.handle('note:load', (e, id) => {
  let note = db.notes.find((n) => n.id === id);
  if (!note) {
    note = {
      id,
      title: '新的便签',
      items: [],
      bounds: defaultBounds(db.notes.length),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.notes.push(note);
    saveDB();
  }
  return note;
});

ipcMain.on('note:save', (e, incoming) => {
  if (!incoming || !incoming.id) return;
  const idx = db.notes.findIndex((n) => n.id === incoming.id);
  if (idx === -1) {
    db.notes.push(incoming);
  } else {
    const prev = db.notes[idx];
    // 提醒时间被修改时重置“已触发”标记
    (incoming.items || []).forEach((it) => {
      const old = (prev.items || []).find((o) => o.id === it.id);
      if (!old || old.remindAt !== it.remindAt) it.remindFired = false;
    });
    db.notes[idx] = incoming;
  }
  saveDB();
  updateTrayTooltip();
});

ipcMain.on('note:minimize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.hide();
});

ipcMain.on('note:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.hide();
});

ipcMain.on('note:new', () => createNoteFlow());

ipcMain.on('note:set-passthrough', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(!!on, { forward: true });
  }
});

ipcMain.handle('note:toggle-topmost', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return { isTop: true };
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, next ? 'floating' : 'normal');
  return { isTop: next };
});

/* ---- 主题（调色盘） ---- */

ipcMain.handle('theme:load', () => db.theme);

ipcMain.on('theme:save', (e, theme) => {
  db.theme = sanitizeTheme(theme);
  saveDB();
  // 广播给所有便签窗口，保持多窗口主题一致
  for (const w of noteWindows.values()) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.send('theme:changed', db.theme);
    } catch (err) { /* 窗口已销毁 */ }
  }
});

ipcMain.on('note:resize', (e, width, height) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  win.setBounds({
    x: b.x,
    y: b.y,
    width: Math.max(260, Math.round(width)),
    height: Math.max(300, Math.round(height)),
  });
});

/* ---------------- 生命周期 ---------------- */

app.whenReady().then(() => {
  loadDB();
  createTray();

  // 全局快捷键（被占用时自动尝试备选组合）
  const shortcuts = [
    ['Control+Alt+N', ['Control+Shift+N'], createNoteFlow],
    ['Control+Alt+T', ['Control+Alt+P'], () => {
      let allTop = true;
      for (const w of noteWindows.values()) {
        if (!w.isDestroyed() && !w.isAlwaysOnTop()) allTop = false;
      }
      setAllTopmost(!allTop);
    }],
    ['Control+Alt+H', ['Control+Alt+S'], toggleAllWindows],
    ['Control+Alt+C', ['Control+Alt+X', 'Control+Alt+Z', 'Control+Alt+E'], () => setAllPassthrough(false)],
  ];
  for (const [preferred, fallbacks, fn] of shortcuts) {
    const registered = [preferred, ...fallbacks].find((accel) => globalShortcut.register(accel, fn));
    if (!registered) {
      console.warn('快捷键注册失败（均被占用）:', preferred);
    } else if (registered !== preferred) {
      console.warn(`快捷键 ${preferred} 被占用，已降级为 ${registered}`);
    }
  }

  startReminderEngine();

  if (db.notes.length === 0) {
    seedNote();
    saveDB();
  }
  for (const note of db.notes) createNoteWindow(note);
  updateTrayTooltip();

  // 作为桌面小组件，macOS 下默认隐藏 Dock 图标（只留托盘）
  if (isMac && app.dock) app.dock.hide();
});

app.on('window-all-closed', () => {
  // 托盘常驻，不退出
});

app.on('before-quit', () => {
  quitting = true;
  saveDB();
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
