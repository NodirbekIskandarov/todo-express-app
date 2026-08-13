'use strict';

/* Eslatma oynasi: ekran markazida, hamma oynalar ustida. OK bosilmaguncha yopilmaydi. */

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const $ = (s) => document.querySelector(s);

let ids = [];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

/** Muddat holati: qizil — kechikkan/bugungi, sariq — yaqin, kulrang — keyinroq. */
function dueBadge(task) {
  const days = daysUntil(task.dueDate);
  const time = task.dueTime ? ` ${task.dueTime}` : '';
  if (days < 0) {
    const n = -days;
    return { cls: 'alarm', text: `⚠ ${n === 1 ? 'Kecha edi' : `${n} kun kechikdi`}${time}` };
  }
  if (days === 0) return { cls: 'alarm', text: `🔔 Bugun${time}` };
  if (days === 1) return { cls: 'warn', text: `⏰ Ertaga${time}` };
  const [y, m, d] = task.dueDate.split('-').map(Number);
  return { cls: 'warn', text: `⏰ ${d}-${MONTHS[m - 1]}${time} · ${days} kun qoldi` };
}

function render(payload) {
  const dark = payload.theme === 'dark'
    || (payload.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  const tasks = payload.tasks || [];
  ids = tasks.map((t) => t.id);

  const today = todayISO();
  const late = tasks.filter((t) => t.dueDate < today).length;
  const now = tasks.filter((t) => t.dueDate === today).length;

  $('#head-title').textContent = tasks.length === 1 ? 'Vazifa eslatmasi' : 'Vazifalar eslatmasi';

  const parts = [];
  if (late) parts.push(`${late} ta kechikkan`);
  if (now) parts.push(`${now} ta bugungi`);
  const soon = tasks.length - late - now;
  if (soon > 0) parts.push(`${soon} ta yaqin`);
  $('#head-sub').textContent = parts.join(' · ');

  $('#list').innerHTML = tasks.map((t) => {
    const b = dueBadge(t);
    const prio = t.priority === 2 ? '<span class="prio p2">⚑</span>'
      : t.priority === 1 ? '<span class="prio p1">⚑</span>' : '';
    return `
      <div class="item">
        <span class="mark">${t.dueDate < today ? '⚠' : '•'}</span>
        <div class="body">
          <div class="t">${esc(t.title)}</div>
          <div class="m">
            <span class="badge ${b.cls}">${esc(b.text)}</span>
            ${t.project ? `<span>${esc(t.project)}</span>` : ''}
            ${prio}
          </div>
        </div>
      </div>`;
  }).join('');
}

$('#btn-ok').addEventListener('click', () => window.api.reminder.ok(ids));
$('#btn-open').addEventListener('click', () => window.api.reminder.openApp(ids));

// Enter va Esc ham "OK" hisoblanadi — lekin oyna o'zi yo'qolmaydi.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') window.api.reminder.ok(ids);
});

window.api.reminder.onData(render);
$('#btn-ok').focus();
