'use strict';

const { app, BrowserWindow, ipcMain, Notification, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');

// Bitta nusxa yetarli — ikkinchi marta ochilsa, mavjud oyna ko'tariladi.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let dbFile = null;
let reminderTimer = null;

const DEFAULTS = {
  theme: 'system',        // 'light' | 'dark' | 'system'
  remindDays: 2,          // necha kun qolganda ogohlantirilsin
  notificationsOn: true,
  windowBounds: null,
};

function settings() {
  return { ...DEFAULTS, ...db.getSettings() };
}

function createWindow() {
  const s = settings();
  const b = s.windowBounds;

  win = new BrowserWindow({
    width: b?.width ?? 1180,
    height: b?.height ?? 780,
    x: b?.x,
    y: b?.y,
    minWidth: 820,
    minHeight: 520,
    show: false,
    backgroundColor: '#111318',
    title: 'Vazifalar',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Tekshirish rejimi: interfeys xatolari terminalga chiqadi.
  if (process.env.VAZIFA_DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${source}:${line})`);
    });
    win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer gone]', d));
  }

  if (process.env.VAZIFA_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const file = process.env.VAZIFA_SMOKE_SCRIPT || path.join(__dirname, '..', '..', 'scripts', 'smoke-checks.js');
      const report = await win.webContents.executeJavaScript(fs.readFileSync(file, 'utf8'), true);
      console.log('SMOKE_REPORT ' + JSON.stringify(report, null, 1));
      if (process.env.VAZIFA_SMOKE_SHOT) {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.VAZIFA_SMOKE_SHOT, img.toPNG());
      }
      app.quit();
    });
  }

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    db.setSetting('windowBounds', win.getNormalBounds());
  };
  win.on('resize', debounce(saveBounds, 400));
  win.on('move', debounce(saveBounds, 400));
  win.on('closed', () => { win = null; });

  // Tashqi havolalar tizim brauzerida ochilsin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------------------------------------------ ogohlantirishlar */

function plural(n) {
  return n === 1 ? '1 ta vazifa' : `${n} ta vazifa`;
}

function checkReminders() {
  const s = settings();
  if (!s.notificationsOn || !Notification.isSupported()) return;

  const due = db.tasksNeedingReminder(s.remindDays);
  if (!due.length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = due.filter((t) => new Date(t.due_date + 'T00:00:00') < today);
  const soon = due.filter((t) => !overdue.includes(t));

  const lines = [];
  if (overdue.length) lines.push(`Muddati o‘tgan: ${plural(overdue.length)}`);
  if (soon.length) lines.push(`Muddati yaqin: ${plural(soon.length)}`);

  const preview = due.slice(0, 3).map((t) => `• ${t.title} (${t.project_name})`).join('\n');
  const more = due.length > 3 ? `\n…va yana ${due.length - 3} ta` : '';

  const n = new Notification({
    title: lines.join(' · '),
    body: preview + more,
    silent: false,
  });
  n.on('click', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('navigate', { view: 'soon' });
    }
  });
  n.show();

  db.markNotified(due.map((t) => t.id));
  if (win && !win.isDestroyed()) win.webContents.send('data-changed');
}

function startReminderLoop() {
  clearInterval(reminderTimer);
  // Dastur ochilganda bir marta, keyin har 30 daqiqada tekshiriladi.
  setTimeout(checkReminders, 4000);
  reminderTimer = setInterval(checkReminders, 30 * 60 * 1000);
}

/* -------------------------------------------------------------------- IPC */

/** Renderer'dan kelgan chaqiruvlarni bitta joyda ro'yxatga oladi va xatolarni o'raydi. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, payload) => {
    try {
      return { ok: true, data: await fn(payload) };
    } catch (err) {
      console.error(`[${channel}]`, err);
      return { ok: false, error: err.message };
    }
  });
}

function registerIpc() {
  handle('state:get', () => db.getState());

  handle('project:create', (p) => db.createProject(p));
  handle('project:update', (p) => db.updateProject(p));
  handle('project:delete', (id) => db.deleteProject(id));
  handle('project:reorder', (ids) => db.reorderProjects(ids));

  handle('section:create', (p) => db.createSection(p));
  handle('section:update', (p) => db.updateSection(p));
  handle('section:delete', (id) => db.deleteSection(id));
  handle('section:reorder', (ids) => db.reorderSections(ids));

  handle('task:create', (p) => db.createTask(p));
  handle('task:update', (p) => db.updateTask(p));
  handle('task:delete', (id) => db.deleteTask(id));
  handle('task:move', (p) => db.moveTask(p));
  handle('task:clearDone', (projectId) => db.clearDone(projectId));

  handle('settings:get', () => settings());
  handle('settings:set', ({ key, value }) => {
    db.setSetting(key, value);
    if (key === 'remindDays' || key === 'notificationsOn') startReminderLoop();
    return settings();
  });

  handle('reminders:check', () => { checkReminders(); return true; });

  handle('db:path', () => dbFile);
  handle('db:reveal', () => { shell.showItemInFolder(dbFile); return true; });

  handle('backup:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(win, {
      title: 'Zaxira nusxasini saqlash',
      defaultPath: path.join(app.getPath('documents'), `vazifalar-zaxira-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, JSON.stringify(db.exportAll(), null, 2), 'utf8');
    return { canceled: false, path: res.filePath };
  });

  handle('backup:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Zaxira faylini tanlang',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const raw = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
    return { canceled: false, stats: db.importAll(raw) };
  });

  handle('confirm', async ({ title, message, detail, confirmLabel }) => {
    const res = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [confirmLabel || 'Ha', 'Bekor qilish'],
      defaultId: 0,
      cancelId: 1,
      title: title || 'Tasdiqlang',
      message: message || '',
      detail: detail || '',
      noLink: true,
    });
    return res.response === 0;
  });
}

/* ------------------------------------------------------------------- ishga tushish */

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  dbFile = db.init(app.getPath('userData'));
  registerIpc();
  Menu.setApplicationMenu(null);
  createWindow();
  startReminderLoop();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
