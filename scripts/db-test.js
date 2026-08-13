'use strict';

/**
 * Baza qatlamining tekshiruvi — Electron kerak emas, oddiy Node bilan ishlaydi:
 *   node scripts/db-test.js
 *
 * Ikki narsani tekshiradi:
 *   1) eski bazaga yangi ustunlar to'g'ri qo'shiladimi (migratsiya);
 *   2) takrorlanish sanasi to'g'ri hisoblanadimi (oy oxiri, hafta kuni, oraliq).
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const db = require('../src/main/db');

const results = [];
const check = (name, ok, extra) => results.push({ name, ok: !!ok, extra: ok ? undefined : extra });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vazifalar-test-'));
const file = path.join(dir, 'vazifalar.db');

/* ---------------------------------------------------- 1. migratsiya */

db.init(dir);
const p = db.createProject({ name: 'Test' });
const sec = db.listSections(p.id)[0];
const t = db.createTask({ projectId: p.id, sectionId: sec.id, title: 'Eski vazifa', dueDate: '2026-03-10' });
check('boshlang‘ich bazada ustunlar bor', 'repeat_kind' in t && 'repeat_every' in t, Object.keys(t));

// Eski versiyaning bazasini taqlid qilamiz: ustunlarni olib tashlaymiz.
{
  const raw = new DatabaseSync(file);
  raw.exec('ALTER TABLE tasks DROP COLUMN repeat_kind');
  raw.exec('ALTER TABLE tasks DROP COLUMN repeat_every');
  const cols = raw.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
  check('taqlid: ustunlar olib tashlandi', !cols.includes('repeat_kind') && !cols.includes('repeat_every'), cols);
  raw.close();
}

// Dastur qayta ochilgandek init qilamiz — migratsiya ustunlarni tiklashi kerak.
db.init(dir);
const after = db.listTasks({ projectId: p.id })[0];
check('migratsiya: repeat_kind qo‘shildi', 'repeat_kind' in after, Object.keys(after));
check('migratsiya: repeat_every qo‘shildi', after.repeat_every === 1, after.repeat_every);
check('migratsiya: eski ma‘lumot saqlandi', after.title === 'Eski vazifa' && after.due_date === '2026-03-10', after);

// Ikkinchi marta chaqirilganda xato bermasligi kerak (idempotent).
let twice = true;
try { db.init(dir); } catch (e) { twice = false; check('migratsiya: takroran xavfsiz', false, e.message); }
if (twice) check('migratsiya: takroran xavfsiz', true);

/* ---------------------------------------------------- 2. sana hisobi */

const { nextDueDate } = db;
const Y = new Date().getFullYear() + 1; // kelajakdagi yil — natija bir qadamda chiqadi
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

check('kunlik: +1 kun', nextDueDate(`${Y}-05-10`, 'daily', 1) === `${Y}-05-11`, nextDueDate(`${Y}-05-10`, 'daily', 1));
check('kunlik: +3 kun', nextDueDate(`${Y}-05-10`, 'daily', 3) === `${Y}-05-13`, nextDueDate(`${Y}-05-10`, 'daily', 3));
check('haftalik: +7 kun', nextDueDate(`${Y}-05-10`, 'weekly', 1) === `${Y}-05-17`, nextDueDate(`${Y}-05-10`, 'weekly', 1));
check('har 2 hafta: +14 kun', nextDueDate(`${Y}-05-10`, 'weekly', 2) === `${Y}-05-24`, nextDueDate(`${Y}-05-10`, 'weekly', 2));
check('oylik: keyingi oy, kun o‘sha', nextDueDate(`${Y}-05-10`, 'monthly', 1) === `${Y}-06-10`, nextDueDate(`${Y}-05-10`, 'monthly', 1));
check('oylik: yil oshib ketishi', nextDueDate(`${Y}-12-15`, 'monthly', 1) === `${Y + 1}-01-15`, nextDueDate(`${Y}-12-15`, 'monthly', 1));
check('yillik: +1 yil', nextDueDate(`${Y}-05-10`, 'yearly', 1) === `${Y + 1}-05-10`, nextDueDate(`${Y}-05-10`, 'yearly', 1));

// Oyning 31-kuni: fevralda bunday kun yo'q — oxirgi kunga tushishi kerak.
const febLast = isLeap(Y) ? 29 : 28;
check('oy oxiri: 31-yanvar → fevral oxiri',
  nextDueDate(`${Y}-01-31`, 'monthly', 1) === `${Y}-02-${febLast}`,
  nextDueDate(`${Y}-01-31`, 'monthly', 1));

// Kechikkan haftalik vazifa: kelajakka surilishi, lekin hafta kuni o'zgarmasligi kerak.
const past = new Date();
past.setDate(past.getDate() - 30);
const pastIso = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
const nx = nextDueDate(pastIso, 'weekly', 1);
const dayOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
const nxDate = (() => { const [y, m, d] = nx.split('-').map(Number); return new Date(y, m - 1, d); })();
check('kechikkan haftalik: kelajakka surildi', nxDate > todayMid, nx);
check('kechikkan haftalik: hafta kuni saqlandi', dayOf(nx) === dayOf(pastIso), `${pastIso} → ${nx}`);

check('takrorlanishsiz: null', nextDueDate(`${Y}-05-10`, null, 1) === null);
check('muddatsiz: null', nextDueDate(null, 'weekly', 1) === null);

/* ---------------------------------------------------- natija */

db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* vaqtinchalik papka — muhim emas */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '  ok  ' : ' XATO '} ${r.name}${r.ok ? '' : '  → ' + JSON.stringify(r.extra)}`);
console.log(`\njami: ${results.length} ta, xato: ${failed.length} ta`);
process.exit(failed.length ? 1 : 0);
