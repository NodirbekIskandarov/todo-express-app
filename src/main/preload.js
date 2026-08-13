'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Har bir chaqiruv {ok, data|error} qaytaradi; xato bo'lsa istisno tashlaymiz. */
async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

contextBridge.exposeInMainWorld('api', {
  getState: () => call('state:get'),

  project: {
    create: (p) => call('project:create', p),
    update: (p) => call('project:update', p),
    remove: (id) => call('project:delete', id),
    reorder: (ids) => call('project:reorder', ids),
  },
  section: {
    create: (p) => call('section:create', p),
    update: (p) => call('section:update', p),
    remove: (id) => call('section:delete', id),
    reorder: (ids) => call('section:reorder', ids),
  },
  task: {
    create: (p) => call('task:create', p),
    update: (p) => call('task:update', p),
    remove: (id) => call('task:delete', id),
    move: (p) => call('task:move', p),
    clearDone: (projectId) => call('task:clearDone', projectId),
  },
  settings: {
    get: () => call('settings:get'),
    set: (key, value) => call('settings:set', { key, value }),
  },

  checkReminders: () => call('reminders:check'),
  dbPath: () => call('db:path'),
  revealDb: () => call('db:reveal'),
  exportBackup: () => call('backup:export'),
  importBackup: () => call('backup:import'),
  confirm: (opts) => call('confirm', opts),

  onDataChanged: (cb) => ipcRenderer.on('data-changed', () => cb()),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, payload) => cb(payload)),
});
