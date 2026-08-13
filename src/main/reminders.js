'use strict';

/**
 * Eslatma qachon chiqishi kerakligini hisoblaydi.
 * Electron'ga bog'liq emas — shuning uchun oddiy Node bilan tekshirsa bo'ladi
 * (scripts/db-test.js).
 */

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function at(day, hh, mm) {
  const x = new Date(day);
  x.setHours(hh, mm, 0, 0);
  return x;
}

const MORNING = 9; // vaqti ko'rsatilmagan vazifalar uchun ertalabki soat

/**
 * Vazifa uchun eslatmaning navbatdagi payti.
 *
 *   muddat hali uzoq      -> ogohlantirish oynasi boshlanadigan kun, 9:00
 *   ogohlantirish oynasida-> BUGUN 9:00
 *   bugun, vaqti bor      -> BUGUN o'sha vaqtda (masalan 18:09)
 *   muddati o'tgan        -> BUGUN 9:00
 *
 * Natija hech qachon o'tmishdagi kunga tushmaydi — shu sababli "oxirgi marta
 * qachon eslatilgan" bilan solishtirib, har kuni bir marta eslatish mumkin
 * bo'ladi va bugungi aniq vaqt ham o'tkazib yuborilmaydi.
 *
 * @returns {Date|null} muddatsiz vazifa uchun null
 */
function reminderMoment(task, remindDays, now = new Date()) {
  if (!task || !task.due_date) return null;

  const [y, m, d] = task.due_date.split('-').map(Number);
  if (!y || !m || !d) return null;

  const due = new Date(y, m - 1, d);
  const today = startOfDay(now);

  // Ogohlantirish oynasi muddatdan `remindDays` kun oldin ochiladi.
  const windowStart = new Date(due);
  windowStart.setDate(windowStart.getDate() - Math.max(0, Number(remindDays) || 0));
  if (today < startOfDay(windowStart)) return at(windowStart, MORNING, 0);

  if (due.getTime() === today.getTime() && task.due_time) {
    const [hh, mm] = task.due_time.split(':').map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) return at(today, hh, mm);
  }
  return at(today, MORNING, 0);
}

/** Oldingi versiyalarda `last_notified` faqat sana ('2026-08-13') bo'lgan. */
function parseNotified(value) {
  if (!value) return null;
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Payti kelgan va hali eslatilmagan vazifalar.
 * Har biriga `remindAt` (shu safargi payt) qo'shiladi — keyin shu qiymat
 * `last_notified` ga yoziladi.
 */
function duePending(tasks, remindDays, now = new Date()) {
  return tasks
    .map((t) => ({ task: t, remindAt: reminderMoment(t, remindDays, now) }))
    .filter(({ task, remindAt }) => {
      if (!remindAt || remindAt > now) return false;
      const last = parseNotified(task.last_notified);
      return !last || last < remindAt;
    })
    .map(({ task, remindAt }) => ({ ...task, remindAt: remindAt.toISOString() }))
    .sort((a, b) => (a.due_date + (a.due_time || '')).localeCompare(b.due_date + (b.due_time || '')));
}

module.exports = { reminderMoment, duePending, parseNotified };
