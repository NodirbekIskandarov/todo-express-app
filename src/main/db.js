'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

let db = null;

/** Bazani ochadi va sxemani tayyorlaydi. */
function init(userDataDir) {
  close(); // qayta chaqirilsa eski ulanish ochiq qolib ketmasin
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = path.join(userDataDir, 'vazifalar.db');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate();
  seedIfEmpty();
  return file;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      color      TEXT    NOT NULL DEFAULT '#6366f1',
      position   REAL    NOT NULL DEFAULT 0,
      archived   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      position   REAL    NOT NULL DEFAULT 0,
      collapsed  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      section_id    INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      title         TEXT    NOT NULL,
      note          TEXT    NOT NULL DEFAULT '',
      due_date      TEXT,
      due_time      TEXT,
      priority      INTEGER NOT NULL DEFAULT 0,
      repeat_kind   TEXT,
      repeat_every  INTEGER NOT NULL DEFAULT 1,
      done          INTEGER NOT NULL DEFAULT 0,
      done_at       TEXT,
      position      REAL    NOT NULL DEFAULT 0,
      last_notified TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, done);
    CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(section_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(due_date) WHERE done = 0;
    CREATE INDEX IF NOT EXISTS idx_sections_proj ON sections(project_id);
  `);

  // Eski versiyada yaratilgan bazalarga yangi ustunlarni qo'shish.
  ensureColumn('tasks', 'repeat_kind', 'repeat_kind TEXT');
  ensureColumn('tasks', 'repeat_every', 'repeat_every INTEGER NOT NULL DEFAULT 1');
}

function close() {
  if (!db) return;
  try { db.close(); } catch { /* allaqachon yopilgan */ }
  db = null;
}

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function seedIfEmpty() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM projects').get();
  if (c > 0) return;
  const id = createProject({ name: 'Birinchi loyiham', color: '#6366f1' }).id;
  const sections = listSections(id);
  const sid = sections[0].id;
  createTask({ projectId: id, sectionId: sid, title: 'Bu — namuna vazifa. Belgilab ko‘ring.' });
  createTask({ projectId: id, sectionId: sid, title: 'Muddat qo‘yib ko‘ring — yaqinlashsa rangi o‘zgaradi', dueDate: todayISO() });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowISO() {
  return new Date().toISOString();
}

/* -------------------------------------------------- takrorlanish (recurring) */

const REPEAT_KINDS = ['daily', 'weekly', 'monthly', 'yearly'];

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Oy qo'shish. Kerakli kun yo'q bo'lsa (31-fevral) — oyning oxirgi kuniga tushadi. */
function addMonths(date, n) {
  const day = date.getDate();
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * Takrorlanuvchi vazifaning keyingi muddati.
 * Hisob joriy muddatdan boshlanadi — shunda "har dushanba" dushanbaligicha qoladi,
 * kechikib bajarilsa ham. Natija bugundan keyinga tushguncha oldinga suriladi.
 */
function nextDueDate(iso, kind, every) {
  if (!iso || !REPEAT_KINDS.includes(kind)) return null;
  const step = Math.min(99, Math.max(1, Number(every) || 1));
  const [y, m, d] = iso.split('-').map(Number);
  let date = new Date(y, m - 1, d);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let guard = 0; guard < 600; guard++) {
    if (kind === 'daily') date.setDate(date.getDate() + step);
    else if (kind === 'weekly') date.setDate(date.getDate() + 7 * step);
    else if (kind === 'monthly') date = addMonths(date, step);
    else date = addMonths(date, 12 * step);

    if (date > today) break;
  }
  return fmtDate(date);
}

/** Ro'yxat oxiriga qo'yish uchun keyingi position qiymati. */
function nextPos(table, whereSql, params = []) {
  const row = db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM ${table} ${whereSql}`).get(...params);
  return row.p + 1000;
}

/* ---------------------------------------------------------------- loyihalar */

function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY archived, position, id').all();
}

function createProject({ name, color = '#6366f1' }) {
  const pos = nextPos('projects', '');
  const info = db.prepare('INSERT INTO projects (name, color, position) VALUES (?, ?, ?)').run(name.trim(), color, pos);
  const id = Number(info.lastInsertRowid);
  // Har bir loyiha kamida bitta mavzuga ega bo'lsin.
  db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)').run(id, 'Umumiy', 1000);
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function updateProject({ id, name, color, archived }) {
  const cur = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!cur) return null;
  db.prepare('UPDATE projects SET name = ?, color = ?, archived = ? WHERE id = ?').run(
    name === undefined ? cur.name : name.trim(),
    color === undefined ? cur.color : color,
    archived === undefined ? cur.archived : (archived ? 1 : 0),
    id
  );
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return true;
}

function reorderProjects(ids) {
  const stmt = db.prepare('UPDATE projects SET position = ? WHERE id = ?');
  ids.forEach((id, i) => stmt.run((i + 1) * 1000, id));
  return true;
}

/* ------------------------------------------------------------------ mavzular */

function listSections(projectId) {
  return db.prepare('SELECT * FROM sections WHERE project_id = ? ORDER BY position, id').all(projectId);
}

function createSection({ projectId, name }) {
  const pos = nextPos('sections', 'WHERE project_id = ?', [projectId]);
  const info = db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)').run(projectId, name.trim(), pos);
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(Number(info.lastInsertRowid));
}

function updateSection({ id, name, collapsed }) {
  const cur = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  if (!cur) return null;
  db.prepare('UPDATE sections SET name = ?, collapsed = ? WHERE id = ?').run(
    name === undefined ? cur.name : name.trim(),
    collapsed === undefined ? cur.collapsed : (collapsed ? 1 : 0),
    id
  );
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
}

/** Mavzuni o'chiradi. Ichidagi vazifalar loyihaning boshqa mavzusiga ko'chadi. */
function deleteSection(id) {
  const sec = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  if (!sec) return false;
  const others = db.prepare('SELECT * FROM sections WHERE project_id = ? AND id != ? ORDER BY position, id')
    .all(sec.project_id, id);
  if (others.length === 0) {
    // Oxirgi mavzu — o'rniga bo'sh "Umumiy" yaratamiz.
    const fresh = createSection({ projectId: sec.project_id, name: 'Umumiy' });
    db.prepare('UPDATE tasks SET section_id = ? WHERE section_id = ?').run(fresh.id, id);
  } else {
    db.prepare('UPDATE tasks SET section_id = ? WHERE section_id = ?').run(others[0].id, id);
  }
  db.prepare('DELETE FROM sections WHERE id = ?').run(id);
  return true;
}

function reorderSections(ids) {
  const stmt = db.prepare('UPDATE sections SET position = ? WHERE id = ?');
  ids.forEach((id, i) => stmt.run((i + 1) * 1000, id));
  return true;
}

/* ------------------------------------------------------------------ vazifalar */

function listTasks({ projectId = null, includeDone = true } = {}) {
  let sql = 'SELECT * FROM tasks';
  const where = [];
  const params = [];
  if (projectId != null) { where.push('project_id = ?'); params.push(projectId); }
  if (!includeDone) where.push('done = 0');
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY position, id';
  return db.prepare(sql).all(...params);
}

function createTask({
  projectId, sectionId, title, note = '', dueDate = null, dueTime = null,
  priority = 0, repeatKind = null, repeatEvery = 1,
}) {
  const pos = nextPos('tasks', 'WHERE section_id = ? AND done = 0', [sectionId]);
  const info = db.prepare(`
    INSERT INTO tasks (project_id, section_id, title, note, due_date, due_time,
                       priority, repeat_kind, repeat_every, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, sectionId, title.trim(), note, dueDate || null, dueTime || null,
    priority, REPEAT_KINDS.includes(repeatKind) ? repeatKind : null,
    Math.min(99, Math.max(1, Number(repeatEvery) || 1)), pos);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(info.lastInsertRowid));
}

const TASK_FIELDS = {
  title: 'title', note: 'note', dueDate: 'due_date', dueTime: 'due_time',
  priority: 'priority', sectionId: 'section_id', projectId: 'project_id',
  repeatKind: 'repeat_kind', repeatEvery: 'repeat_every',
};

function updateTask(patch) {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(patch.id);
  if (!cur) return null;

  const sets = [];
  const params = [];
  const put = (col, value) => { sets.push(`${col} = ?`); params.push(value); };

  for (const [key, col] of Object.entries(TASK_FIELDS)) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (key === 'title') value = String(value).trim();
    if (key === 'repeatKind') value = REPEAT_KINDS.includes(value) ? value : null;
    if (key === 'repeatEvery') value = Math.min(99, Math.max(1, Number(value) || 1));
    put(col, value ?? null);
  }

  // Takrorlanish muddatsiz ma'noga ega emas — sana bo'lmasa, bugundan boshlanadi.
  if (patch.repeatKind && REPEAT_KINDS.includes(patch.repeatKind) && !cur.due_date && patch.dueDate === undefined) {
    put('due_date', todayISO());
  }
  // Muddat yoki VAQT o'zgarsa, eslatma qaytadan chiqishi kerak.
  const rescheduled = (patch.dueDate !== undefined && patch.dueDate !== cur.due_date)
    || (patch.dueTime !== undefined && (patch.dueTime || null) !== cur.due_time);
  if (rescheduled) sets.push('last_notified = NULL');

  // Bajarilgan deb belgilangan takrorlanuvchi vazifa: bajarilgani tarixda qoladi,
  // o'rniga keyingi muddat bilan yangi nusxa ochiladi.
  let spawned = null;
  const repeats = patch.done === true && cur.done === 0 && REPEAT_KINDS.includes(cur.repeat_kind);
  const nextDate = repeats ? nextDueDate(cur.due_date || todayISO(), cur.repeat_kind, cur.repeat_every) : null;

  if (patch.done !== undefined) {
    const done = patch.done ? 1 : 0;
    put('done', done);
    put('done_at', done ? nowISO() : null);
    if (done) {
      // Bajarilganlar ro'yxatining boshiga chiqsin (eng oxirgi bajarilgan — tepada).
      put('position', -Date.now());
      // Takrorlanish yangi nusxaga o'tadi, aks holda qayta belgilanganda ikkilanadi.
      if (nextDate) put('repeat_kind', null);
    } else {
      put('position', nextPos('tasks', 'WHERE section_id = ? AND done = 0', [cur.section_id]));
    }
  }
  if (!sets.length) return cur;

  params.push(patch.id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  if (nextDate) {
    spawned = createTask({
      projectId: cur.project_id,
      sectionId: cur.section_id,
      title: cur.title,
      note: cur.note,
      dueDate: nextDate,
      dueTime: cur.due_time,
      priority: cur.priority,
      repeatKind: cur.repeat_kind,
      repeatEvery: cur.repeat_every,
    });
  }

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(patch.id);
  return spawned ? { ...row, spawned } : row;
}

function deleteTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return true;
}

/** Vazifani boshqa mavzu/loyihaga ko'chiradi va yangi tartibda joylashtiradi. */
function moveTask({ id, sectionId, beforeId = null }) {
  const sec = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
  if (!sec) return null;
  const siblings = db.prepare('SELECT id, position FROM tasks WHERE section_id = ? AND done = 0 AND id != ? ORDER BY position, id')
    .all(sectionId, id);

  let pos;
  const idx = beforeId == null ? siblings.length : siblings.findIndex((t) => t.id === beforeId);
  if (idx <= 0) {
    pos = siblings.length ? siblings[0].position - 1000 : 1000;
  } else if (idx >= siblings.length) {
    pos = siblings[siblings.length - 1].position + 1000;
  } else {
    pos = (siblings[idx - 1].position + siblings[idx].position) / 2;
  }

  db.prepare('UPDATE tasks SET section_id = ?, project_id = ?, position = ? WHERE id = ?')
    .run(sectionId, sec.project_id, pos, id);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function clearDone(projectId = null) {
  if (projectId == null) db.prepare('DELETE FROM tasks WHERE done = 1').run();
  else db.prepare('DELETE FROM tasks WHERE done = 1 AND project_id = ?').run(projectId);
  return true;
}

/* ------------------------------------------------- to'liq holat (bir so'rovda) */

function getState() {
  return {
    projects: listProjects(),
    sections: db.prepare('SELECT * FROM sections ORDER BY position, id').all(),
    tasks: db.prepare('SELECT * FROM tasks ORDER BY position, id').all(),
    settings: getSettings(),
  };
}

/* ------------------------------------------------------------------ sozlamalar */

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
  return true;
}

/* --------------------------------------------------------- ogohlantirish uchun */

/**
 * Muddati bor barcha ochiq vazifalar. Qaysi biriga eslatma kerakligini
 * reminders.js hal qiladi — sana/vaqt hisobi bir joyda turgani ma'qul.
 */
function openDatedTasks() {
  return db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.done = 0 AND t.due_date IS NOT NULL
    ORDER BY t.due_date, t.due_time
  `).all();
}

/**
 * Eslatilgan deb belgilaydi.
 * @param {Array<{id:number, remindAt:string}>} entries eslatma payti bilan
 */
function markNotified(entries) {
  if (!entries || !entries.length) return;
  const stmt = db.prepare('UPDATE tasks SET last_notified = ? WHERE id = ?');
  for (const e of entries) stmt.run(e.remindAt || new Date().toISOString(), e.id);
}

/* ------------------------------------------------------- zaxira nusxa (backup) */

function exportAll() {
  return {
    version: 1,
    exportedAt: nowISO(),
    projects: listProjects(),
    sections: db.prepare('SELECT * FROM sections ORDER BY position, id').all(),
    tasks: db.prepare('SELECT * FROM tasks ORDER BY position, id').all(),
  };
}

/** Zaxiradan tiklaydi: mavjud loyihalarga qo'shib qo'yadi (o'chirmaydi). */
function importAll(data) {
  if (!data || !Array.isArray(data.projects)) throw new Error('Fayl formati noto‘g‘ri');
  const stats = { projects: 0, sections: 0, tasks: 0 };
  db.exec('BEGIN');
  try {
    for (const p of data.projects) {
      const np = createProject({ name: p.name, color: p.color || '#6366f1' });
      stats.projects++;
      // createProject standart "Umumiy" mavzusini yaratadi — importda u kerak emas.
      db.prepare('DELETE FROM sections WHERE project_id = ?').run(np.id);

      const secs = (data.sections || []).filter((s) => s.project_id === p.id);
      const secMap = new Map();
      for (const s of secs) {
        const ns = createSection({ projectId: np.id, name: s.name });
        secMap.set(s.id, ns.id);
        stats.sections++;
      }
      if (secs.length === 0) {
        const ns = createSection({ projectId: np.id, name: 'Umumiy' });
        secMap.set(null, ns.id);
        stats.sections++;
      }
      const fallback = secMap.values().next().value;

      for (const t of (data.tasks || []).filter((x) => x.project_id === p.id)) {
        const nt = createTask({
          projectId: np.id,
          sectionId: secMap.get(t.section_id) || fallback,
          title: t.title,
          note: t.note || '',
          dueDate: t.due_date,
          dueTime: t.due_time,
          priority: t.priority || 0,
          repeatKind: t.repeat_kind || null,
          repeatEvery: t.repeat_every || 1,
        });
        // done=true bilan yangilash takrorlanuvchi vazifada keyingi nusxani
        // ochib yuboradi — zaxiradan tiklashda bu keraksiz, shuning uchun to'g'ridan-to'g'ri.
        if (t.done) {
          db.prepare("UPDATE tasks SET done = 1, done_at = ?, repeat_kind = NULL, position = ? WHERE id = ?")
            .run(t.done_at || nowISO(), -Date.now(), nt.id);
        }
        stats.tasks++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return stats;
}

module.exports = {
  init, close,
  getState,
  listProjects, createProject, updateProject, deleteProject, reorderProjects,
  listSections, createSection, updateSection, deleteSection, reorderSections,
  listTasks, createTask, updateTask, deleteTask, moveTask, clearDone,
  getSettings, setSetting,
  openDatedTasks, markNotified,
  exportAll, importAll,
  nextDueDate, // tekshiruvlar uchun
};
