'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const { duePending } = require('./reminders');

// Ma'lumotlar papkasi ishlab chiqish va o'rnatilgan versiyada bir xil bo'lsin:
// %APPDATA%\Vazifalar\vazifalar.db
app.setName('Vazifalar');

// Windows toast bildirishnomalari faqat AppUserModelID Start menyusidagi yorliqning
// AUMID'i bilan aynan mos kelganda ko'rinadi. O'rnatgich yorliqqa Electron'ning
// standart qiymatini yozadi — shuni aniq belgilab qo'yamiz, tasodifga qoldirmaymiz.
const APP_USER_MODEL_ID = 'electron.app.Vazifalar';
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

// Bitta nusxa yetarli — ikkinchi marta ochilsa, mavjud oyna ko'tariladi.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let reminderWin = null;
let dbFile = null;
let reminderTimer = null;

const DEFAULTS = {
  theme: 'system',        // 'light' | 'dark' | 'system'
  remindDays: 2,          // necha kun qolganda ogohlantirilsin
  notificationsOn: true,
  autoStart: false,       // Windows bilan birga ishga tushsinmi
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

  // Windows bilan birga ochilganda oyna ekranni to'sib turmasin.
  const quiet = process.argv.includes('--autostart');
  win.once('ready-to-show', () => {
    win.show();
    if (quiet) win.minimize();
  });

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
        // Eslatma oynasi ochilgan bo'lsa — o'shani suratga olamiz.
        const target = reminderWin && !reminderWin.isDestroyed() ? reminderWin : win;
        // Yangi ochilgan oyna darhol suratga tushmaydi (UnknownVizError) — qayta urinamiz.
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 700));
          try {
            const img = await target.webContents.capturePage();
            if (img.getSize().width > 0) {
              fs.writeFileSync(process.env.VAZIFA_SMOKE_SHOT, img.toPNG());
              break;
            }
          } catch (e) {
            console.log(`[surat ${i + 1}] ${e.message}`);
          }
        }
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

/** Windows bilan birga ishga tushish. Eslatma faqat dastur ochiq bo'lganda chiqadi. */
function applyAutoStart(on) {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--autostart'] });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------------------------------------------ ogohlantirishlar */

function checkReminders() {
  const s = settings();
  if (!s.notificationsOn) return 0;
  const due = duePending(db.tasksNeedingReminder(s.remindDays), s.remindDays);
  if (!due.length) return 0;
  showReminderWindow(due);
  return due.length;
}

function startReminderLoop() {
  clearInterval(reminderTimer);
  // Dastur ochilgach bir marta, keyin har daqiqada — muddat vaqti aniq ushlanishi uchun.
  setTimeout(checkReminders, 4000);
  reminderTimer = setInterval(checkReminders, 60 * 1000);
}

/* ---------------------------------------------------------- eslatma oynasi */

/**
 * Eslatma ekran markazida, barcha oynalar ustida chiqadi va "OK" bosilmaguncha
 * yopilmaydi. Windows toast'idan farqli — o'zi yo'qolib ketmaydi va
 * "Focus assist" kabi tizim sozlamalari uni to'sib qo'ymaydi.
 */
function showReminderWindow(tasks) {
  const payload = {
    theme: settings().theme || 'system',
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      note: t.note,
      dueDate: t.due_date,
      dueTime: t.due_time,
      priority: t.priority,
      project: t.project_name,
    })),
  };

  if (reminderWin && !reminderWin.isDestroyed()) {
    reminderWin.webContents.send('reminder:data', payload);
    reminderWin.show();
    reminderWin.focus();
    return;
  }

  const height = Math.min(560, 172 + payload.tasks.length * 64);
  reminderWin = new BrowserWindow({
    width: 480,
    height,
    center: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    // Shaffof oyna Windows'da ishonchsiz (rendering va surat olishda nosozliklar),
    // shuning uchun oddiy oyna — fon rangi mavzuga moslanadi.
    backgroundColor: (settings().theme === 'dark'
      || (settings().theme !== 'light' && nativeTheme.shouldUseDarkColors)) ? '#171a21' : '#ffffff',
    title: 'Eslatma',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  reminderWin.loadFile(path.join(__dirname, '..', 'renderer', 'reminder.html'));
  reminderWin.once('ready-to-show', () => {
    reminderWin.webContents.send('reminder:data', payload);
    reminderWin.show();
    reminderWin.focus();
    // Boshqa dastur ustida ishlayotgan bo'lsa ham ko'zga tashlansin.
    reminderWin.setAlwaysOnTop(true, 'screen-saver');
  });
  reminderWin.on('closed', () => { reminderWin = null; });
}

function closeReminderWindow(markIds) {
  if (Array.isArray(markIds) && markIds.length) db.markNotified(markIds);
  if (reminderWin && !reminderWin.isDestroyed()) reminderWin.destroy();
  reminderWin = null;
  if (win && !win.isDestroyed()) win.webContents.send('data-changed');
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
    if (key === 'autoStart') applyAutoStart(value);
    return settings();
  });

  handle('reminders:check', () => checkReminders());

  handle('reminder:ok', (ids) => { closeReminderWindow(ids); return true; });

  handle('reminder:open', (ids) => {
    closeReminderWindow(ids);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('navigate', { view: 'today' });
    }
    return true;
  });

  // Sozlamalardagi "Sinab ko'rish" tugmasi — eslatma oynasi qanday chiqishini ko'rsatadi.
  handle('reminder:test', () => {
    const now = new Date();
    showReminderWindow([{
      id: -1,
      title: 'Sinov eslatmasi — hammasi joyida',
      note: 'Bu haqiqiy vazifa emas. Shu oyna ko‘rinayotgan bo‘lsa, eslatmalar ishlayapti.',
      due_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      due_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      priority: 0,
      project_name: 'Sinov',
    }]);
    return true;
  });

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
  applyAutoStart(settings().autoStart);
  // Tekshiruv rejimida eslatma oynasi o'z-o'zidan ochilib testlarga xalaqit bermasin.
  if (!process.env.VAZIFA_SMOKE) startReminderLoop();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
