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

/**
 * Vazifa uchun eslatma chiqishi kerak bo'lgan aniq payt:
 *
 *   muddati o'tgan       -> darhol
 *   bugun, vaqti bor     -> aynan o'sha vaqtda (masalan 17:40)
 *   bugun, vaqti yo'q    -> ertalab soat 9:00 da
 *   kelajakdagi muddat   -> muddatdan `remindDays` kun oldin, soat 9:00 da
 *
 * @returns {Date|null} muddatsiz vazifa uchun null
 */
function reminderMoment(task, remindDays, now = new Date()) {
  if (!task || !task.due_date) return null;

  const [y, m, d] = task.due_date.split('-').map(Number);
  if (!y || !m || !d) return null;

  const due = new Date(y, m - 1, d);
  const today = startOfDay(now);

  if (due < today) return new Date(0); // kechikkan — kechiktirmaymiz

  if (due.getTime() === today.getTime()) {
    if (task.due_time) {
      const [hh, mm] = task.due_time.split(':').map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) return new Date(y, m - 1, d, hh, mm, 0, 0);
    }
    return new Date(y, m - 1, d, 9, 0, 0, 0);
  }

  const warn = new Date(due);
  warn.setDate(warn.getDate() - Math.max(0, Number(remindDays) || 0));
  warn.setHours(9, 0, 0, 0);
  return warn;
}

/** Payti kelgan eslatmalar, muddat bo'yicha tartiblangan. */
function duePending(tasks, remindDays, now = new Date()) {
  return tasks
    .filter((t) => {
      const at = reminderMoment(t, remindDays, now);
      return at !== null && at <= now;
    })
    .sort((a, b) => (a.due_date + (a.due_time || '')).localeCompare(b.due_date + (b.due_time || '')));
}

module.exports = { reminderMoment, duePending };
