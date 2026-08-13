'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

let db = null;

/** Bazani ochadi va sxemani tayyorlaydi. */
function init(userDataDir) {
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

function createTask({ projectId, sectionId, title, note = '', dueDate = null, dueTime = null, priority = 0 }) {
  const pos = nextPos('tasks', 'WHERE section_id = ? AND done = 0', [sectionId]);
  const info = db.prepare(`
    INSERT INTO tasks (project_id, section_id, title, note, due_date, due_time, priority, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, sectionId, title.trim(), note, dueDate || null, dueTime || null, priority, pos);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(info.lastInsertRowid));
}

const TASK_FIELDS = {
  title: 'title', note: 'note', dueDate: 'due_date', dueTime: 'due_time',
  priority: 'priority', sectionId: 'section_id', projectId: 'project_id',
};

function updateTask(patch) {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(patch.id);
  if (!cur) return null;

  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(TASK_FIELDS)) {
    if (patch[key] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(typeof patch[key] === 'string' && key === 'title' ? patch[key].trim() : (patch[key] ?? null));
  }
  // Muddat o'zgarsa, ogohlantirish qaytadan yuborilishi kerak.
  if (patch.dueDate !== undefined && patch.dueDate !== cur.due_date) sets.push('last_notified = NULL');

  if (patch.done !== undefined) {
    const done = patch.done ? 1 : 0;
    sets.push('done = ?'); params.push(done);
    sets.push('done_at = ?'); params.push(done ? nowISO() : null);
    if (done) {
      // Bajarilganlar ro'yxatining boshiga chiqsin (eng oxirgi bajarilgan — tepada).
      sets.push('position = ?'); params.push(-Date.now());
    } else {
      sets.push('position = ?'); params.push(nextPos('tasks', 'WHERE section_id = ? AND done = 0', [cur.section_id]));
    }
  }
  if (!sets.length) return cur;

  params.push(patch.id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(patch.id);
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
 * Muddati yaqinlashgan yoki o'tib ketgan, bugun hali eslatilmagan vazifalar.
 * @param {number} withinDays necha kun oldin ogohlantirish kerak
 */
function tasksNeedingReminder(withinDays) {
  return db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.done = 0
      AND t.due_date IS NOT NULL
      AND date(t.due_date) <= date('now', 'localtime', '+' || ? || ' days')
      AND (t.last_notified IS NULL OR t.last_notified < date('now', 'localtime'))
    ORDER BY t.due_date, t.due_time
  `).all(String(withinDays));
}

function markNotified(ids) {
  if (!ids.length) return;
  const stmt = db.prepare("UPDATE tasks SET last_notified = date('now', 'localtime') WHERE id = ?");
  for (const id of ids) stmt.run(id);
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
        });
        if (t.done) updateTask({ id: nt.id, done: true });
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
  init,
  getState,
  listProjects, createProject, updateProject, deleteProject, reorderProjects,
  listSections, createSection, updateSection, deleteSection, reorderSections,
  listTasks, createTask, updateTask, deleteTask, moveTask, clearDone,
  getSettings, setSetting,
  tasksNeedingReminder, markNotified,
  exportAll, importAll,
};
