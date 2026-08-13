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

const now = atISO('2026-08-13T18:10:00');
const today = day(now);

// Bugungi, vaqti bor: aynan o'sha vaqtda chiqishi kerak.
const timed = { due_date: today, due_time: '18:09' };
const tm = reminderMoment(timed, 2, now);
check('vaqtli vazifa: aynan o‘sha vaqtda', day(tm) === today && hhmm(tm) === '18:09', `${day(tm)} ${hhmm(tm)}`);
check('vaqtli vazifa: 18:10 da payti kelgan', duePending([timed], 2, now).length === 1);
check('vaqtli vazifa: 18:08 da hali erta',
  duePending([timed], 2, atISO('2026-08-13T18:08:00')).length === 0);

// Bugungi, vaqtsiz: ertalab 9:00.
const plain = { due_date: today, due_time: null };
check('vaqtsiz bugungi: soat 9:00', hhmm(reminderMoment(plain, 2, now)) === '09:00');
check('vaqtsiz bugungi: 08:00 da erta',
  duePending([plain], 2, atISO('2026-08-13T08:00:00')).length === 0);
check('vaqtsiz bugungi: 09:30 da payti kelgan',
  duePending([plain], 2, atISO('2026-08-13T09:30:00')).length === 1);

// Muddati o'tgan: bugun ertalabdan boshlab, dastur ochilishi bilan.
const late = { due_date: '2026-08-10', due_time: null };
check('kechikkan: bugungi 9:00', hhmm(reminderMoment(late, 2, now)) === '09:00');
check('kechikkan: kun boshida hali erta',
  duePending([late], 2, atISO('2026-08-13T00:05:00')).length === 0);
check('kechikkan: kunduzi chiqadi', duePending([late], 2, now).length === 1);

// Oldindan ogohlantirish.
const future = { due_date: '2026-08-15', due_time: '10:00' };
const fm = reminderMoment(future, 2, now);
check('oldindan: bugun 9:00', day(fm) === today && hhmm(fm) === '09:00', `${day(fm)} ${hhmm(fm)}`);
check('oldindan: chegaradan tashqarida chiqmaydi',
  duePending([{ due_date: '2026-08-20', due_time: null }], 2, now).length === 0);

check('muddatsiz: eslatma yo‘q', reminderMoment({ due_date: null }, 2, now) === null);

/* --- ASOSIY XATO: ertalab eslatilgan vazifa o'z vaqtida yana eslatilishi kerak --- */
const morningDone = { due_date: today, due_time: '18:09', last_notified: '2026-08-13T09:00:00.000+05:00' };
check('ertalab eslatilgan bo‘lsa ham, 18:09 da yana chiqadi',
  duePending([morningDone], 2, now).length === 1, morningDone.last_notified);

// Eski format (faqat sana) — yangilangandan keyin ham to'g'ri ishlashi kerak.
const oldFormat = { due_date: today, due_time: '18:09', last_notified: '2026-08-13' };
check('eski formatdagi belgi to‘sib qo‘ymaydi', duePending([oldFormat], 2, now).length === 1);

// O'z vaqtida eslatilgandan keyin takrorlanmasligi kerak.
const alreadyAt = { due_date: today, due_time: '18:09', last_notified: '2026-08-13T18:09:00.000+05:00' };
check('o‘z vaqtida eslatilgach takrorlanmaydi', duePending([alreadyAt], 2, now).length === 0);

// Ertasi kuni yana eslatiladi (kechikkan holatda).
check('ertasi kuni yana eslatiladi',
  duePending([{ due_date: today, due_time: '18:09', last_notified: '2026-08-13T18:09:00.000+05:00' }],
    2, atISO('2026-08-14T09:30:00')).length === 1);

// remindAt qo'shilishi kerak — u last_notified ga yoziladi.
const withAt = duePending([timed], 2, now)[0];
check('remindAt qo‘shildi', !!withAt.remindAt && new Date(withAt.remindAt).getHours() === 18, withAt.remindAt);

// Tartib: eng shoshilinchi birinchi.
const order = duePending([
  { due_date: today, due_time: '17:00' },
  { due_date: '2026-08-11', due_time: null },
  { due_date: today, due_time: '08:00' },
], 2, now);
check('tartib: kechikkan birinchi', order[0].due_date === '2026-08-11', order.map((t) => t.due_date));
check('tartib: erta vaqt oldinda', order[1].due_time === '08:00', order.map((t) => t.due_time));

/* --- vaqt o'zgarsa "eslatilgan" belgisi tozalanishi kerak --- */
{
  const t2 = db.createTask({ projectId: p.id, sectionId: db.listSections(p.id)[0].id, title: 'Vaqt sinovi', dueDate: '2026-08-13', dueTime: '17:40' });
  db.markNotified([{ id: t2.id, remindAt: '2026-08-13T17:40:00.000+05:00' }]);
  const marked = db.listTasks({ projectId: p.id }).find((x) => x.id === t2.id);
  check('markNotified vaqtni yozdi', !!marked.last_notified && marked.last_notified.includes('17:40'), marked.last_notified);

  const moved = db.updateTask({ id: t2.id, dueTime: '18:09' });
  check('vaqt o‘zgarganda belgi tozalandi', moved.last_notified === null, moved.last_notified);

  const sameAgain = db.updateTask({ id: t2.id, priority: 1 });
  check('boshqa o‘zgarish belgiga tegmaydi', sameAgain.due_time === '18:09');
}

/* --- foydalanuvchi duch kelgan holat, boshdan-oxir baza orqali --- */
{
  const sec2 = db.listSections(p.id)[0];
  const d = new Date();
  const todayReal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const t3 = db.createTask({ projectId: p.id, sectionId: sec2.id, title: 'Kechqurungi ish', dueDate: todayReal, dueTime: '18:09' });
  // Ertalab boshqa vazifalar bilan birga eslatilgan deb belgilaymiz (eski format ham shunday edi).
  db.markNotified([{ id: t3.id, remindAt: todayReal }]);

  const at1808 = new Date(`${todayReal}T18:08:00`);
  const at1810 = new Date(`${todayReal}T18:10:00`);
  const pending08 = duePending(db.openDatedTasks(), 2, at1808).filter((x) => x.id === t3.id);
  const pending10 = duePending(db.openDatedTasks(), 2, at1810).filter((x) => x.id === t3.id);

  check('18:08 da hali chiqmaydi', pending08.length === 0, pending08.length);
  check('18:10 da CHIQADI (asosiy xato tuzatildi)', pending10.length === 1, pending10.length);

  // "OK" bosilgandan keyin qayta chiqmasligi kerak.
  db.markNotified(pending10.map((x) => ({ id: x.id, remindAt: x.remindAt })));
  const after = duePending(db.openDatedTasks(), 2, at1810).filter((x) => x.id === t3.id);
  check('OK bosilgach takrorlanmaydi', after.length === 0, after.length);
}

/* --- kunlik ish bajarilganda muddat ertangi kunga o'tishi --- */
{
  const sec3 = db.listSections(p.id)[0];
  const d = new Date();
  const todayReal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(d); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowReal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  const daily = db.createTask({
    projectId: p.id, sectionId: sec3.id, title: 'Ertalabki reja',
    dueDate: todayReal, dueTime: '08:30', repeatKind: 'daily',
  });

  const res = db.updateTask({ id: daily.id, done: true });

  check('kunlik: yangi nusxa ochildi', !!res.spawned);
  check('kunlik: muddat ERTAGA', res.spawned && res.spawned.due_date === tomorrowReal, res.spawned && res.spawned.due_date);
  check('kunlik: vaqt o‘zgarmadi', res.spawned && res.spawned.due_time === '08:30', res.spawned && res.spawned.due_time);
  check('kunlik: yangisi ham takrorlanadi', res.spawned && res.spawned.repeat_kind === 'daily');
  check('kunlik: yangisi eslatilmagan', res.spawned && res.spawned.last_notified === null);
  check('kunlik: bajarilgani bugungi sanada qoldi', res.due_date === todayReal, res.due_date);
  check('kunlik: bajarilgani "Bajarilgan"da', res.done === 1);

  const openSame = db.listTasks({ projectId: p.id, includeDone: false }).filter((t) => t.title === 'Ertalabki reja');
  check('kunlik: ochiq nusxa faqat bitta', openSame.length === 1, openSame.length);

  // Kechikib bajarish: 3 kun oldingi kunlik ish ham ertangi kunga o'tadi.
  const past = new Date(d); past.setDate(past.getDate() - 3);
  const pastReal = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
  const lateDaily = db.createTask({
    projectId: p.id, sectionId: sec3.id, title: 'Kechikkan kunlik',
    dueDate: pastReal, dueTime: '08:30', repeatKind: 'daily',
  });
  const lateRes = db.updateTask({ id: lateDaily.id, done: true });
  check('kechikkan kunlik: ertangi kunga o‘tdi', lateRes.spawned && lateRes.spawned.due_date === tomorrowReal, lateRes.spawned && lateRes.spawned.due_date);
}

/* ---------------------------------------------------- natija */

db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* vaqtinchalik papka — muhim emas */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '  ok  ' : ' XATO '} ${r.name}${r.ok ? '' : '  → ' + JSON.stringify(r.extra)}`);
console.log(`\njami: ${results.length} ta, xato: ${failed.length} ta`);
process.exit(failed.length ? 1 : 0);
