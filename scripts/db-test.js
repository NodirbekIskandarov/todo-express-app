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

/* ---------------------------------------------------- 3. eslatma vaqti */

const { reminderMoment, duePending } = require('../src/main/reminders');

const atISO = (s) => new Date(s);                      // '2026-08-13T17:41:00'
const day = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const hhmm = (dt) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

const now = atISO('2026-08-13T17:41:00');
const today = day(now);

// Bugungi, vaqti bor: aynan o'sha vaqtda chiqishi kerak.
const timed = { due_date: today, due_time: '17:40' };
const tm = reminderMoment(timed, 2, now);
check('vaqtli vazifa: aynan o‘sha vaqtda', day(tm) === today && hhmm(tm) === '17:40', `${day(tm)} ${hhmm(tm)}`);
check('vaqtli vazifa: 17:41 da payti kelgan', duePending([timed], 2, now).length === 1);
check('vaqtli vazifa: 17:39 da hali erta',
  duePending([timed], 2, atISO('2026-08-13T17:39:00')).length === 0);

// Bugungi, vaqtsiz: ertalab 9:00.
const plain = { due_date: today, due_time: null };
const pm = reminderMoment(plain, 2, now);
check('vaqtsiz bugungi: soat 9:00', hhmm(pm) === '09:00', hhmm(pm));
check('vaqtsiz bugungi: 08:00 da erta',
  duePending([plain], 2, atISO('2026-08-13T08:00:00')).length === 0);
check('vaqtsiz bugungi: 09:30 da payti kelgan',
  duePending([plain], 2, atISO('2026-08-13T09:30:00')).length === 1);

// Muddati o'tgan: darhol.
check('kechikkan: darhol',
  duePending([{ due_date: '2026-08-10', due_time: null }], 2, atISO('2026-08-13T00:05:00')).length === 1);

// Oldindan ogohlantirish: remindDays kun oldin, 9:00 da.
const future = { due_date: '2026-08-15', due_time: '10:00' };
const fm = reminderMoment(future, 2, now);
check('oldindan: 2 kun oldin 9:00', day(fm) === '2026-08-13' && hhmm(fm) === '09:00', `${day(fm)} ${hhmm(fm)}`);
check('oldindan: chegaradan tashqarida chiqmaydi',
  duePending([{ due_date: '2026-08-20', due_time: null }], 2, now).length === 0);

check('muddatsiz: eslatma yo‘q', reminderMoment({ due_date: null }, 2, now) === null);

// Tartib: eng shoshilinchi birinchi.
const order = duePending([
  { due_date: today, due_time: '17:00' },
  { due_date: '2026-08-11', due_time: null },
  { due_date: today, due_time: '08:00' },
], 2, now);
check('tartib: kechikkan birinchi', order[0].due_date === '2026-08-11', order.map((t) => t.due_date + ' ' + (t.due_time || '')));
check('tartib: erta vaqt oldinda', order[1].due_time === '08:00', order.map((t) => t.due_time));

/* ---------------------------------------------------- natija */

db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* vaqtinchalik papka — muhim emas */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '  ok  ' : ' XATO '} ${r.name}${r.ok ? '' : '  → ' + JSON.stringify(r.extra)}`);
console.log(`\njami: ${results.length} ta, xato: ${failed.length} ta`);
process.exit(failed.length ? 1 : 0);
