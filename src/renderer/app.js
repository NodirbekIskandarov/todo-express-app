'use strict';

/* ============================================================ holat */

let state = { projects: [], sections: [], tasks: [], settings: {} };

const ui = {
  view: 'all',          // all | today | soon | overdue | project
  projectId: null,
  search: '',
  openTask: null,       // tafsilot ochiq vazifa
  editingTask: null,    // sarlavhasi tahrirlanayotgan vazifa
  focusKey: null,       // qayta chizishdan keyin fokus qaytariladigan element
  caret: null,
  dragTaskId: null,
  dragProjectId: null,
};

const PALETTE = ['#5b5fdd', '#e0533d', '#e8952b', '#17936a', '#2c8cd6', '#9b5bd6', '#d64d8f', '#5c6b7a'];

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

const $ = (sel) => document.querySelector(sel);

/* ============================================================ yordamchilar */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Qidiruv so'zini matn ichida ajratib ko'rsatadi. */
function hl(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const needle = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(needle, 'gi'), (m) => `<mark>${m}</mark>`);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ikki sana orasidagi kun farqi (mahalliy vaqt bo'yicha, soatlarsiz). */
function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const thisYear = new Date().getFullYear();
  return `${d}-${MONTHS[m - 1]}${y === thisYear ? '' : ' ' + y}`;
}

/**
 * Muddat holati: rang sinfi va o'zbekcha yozuv.
 * Bu yerda "yaqinlashdi" chegarasi sozlamalardagi kun soniga bog'liq.
 */
function dueInfo(task) {
  if (!task.due_date) return null;
  const days = daysUntil(task.due_date);
  const time = task.due_time ? ` ${task.due_time}` : '';
  const warnAt = Number(state.settings.remindDays ?? 2);

  if (days < 0) {
    const n = -days;
    return { cls: 'alarm', icon: '⚠', label: n === 1 ? 'Kecha edi' : `${n} kun kechikdi`, pulse: true, days };
  }
  if (days === 0) return { cls: 'alarm', icon: '🔔', label: `Bugun${time}`, pulse: true, days };
  if (days === 1) return { cls: 'warn', icon: '⏰', label: `Ertaga${time}`, pulse: false, days };
  if (days <= warnAt) return { cls: 'warn', icon: '⏰', label: `${days} kun qoldi`, pulse: false, days };
  if (days <= 7) {
    const [y, m, d] = task.due_date.split('-').map(Number);
    return { cls: 'gray', icon: '📅', label: `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} · ${days} kun`, pulse: false, days };
  }
  return { cls: 'gray', icon: '📅', label: formatDate(task.due_date), pulse: false, days };
}

const PRIO = [null, { mark: '⚑', cls: 'p1', name: 'O‘rta' }, { mark: '⚑', cls: 'p2', name: 'Yuqori' }];

const REPEAT_UNITS = { daily: 'kun', weekly: 'hafta', monthly: 'oy', yearly: 'yil' };

/** Muddat sanasidan hafta kunini oladi (0 = yakshanba). */
function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function monthDayOf(iso) {
  return Number(iso.split('-')[2]);
}

/** Sanani ISO ko'rinishga o'giradi. */
function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Tanlangan hafta kuniga to'g'ri keladigan eng yaqin sana (bugundan boshlab). */
function nextDateForWeekday(weekday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return isoOf(d);
}

/** Oyning tanlangan sanasi. O'tib ketgan bo'lsa — keyingi oy. Qisqa oyda oxirgi kunga tushadi. */
function nextDateForMonthDay(day) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastThis = new Date(y, m + 1, 0).getDate();
  const thisMonth = new Date(y, m, Math.min(day, lastThis));
  if (thisMonth >= now) return isoOf(thisMonth);
  const lastNext = new Date(y, m + 2, 0).getDate();
  return isoOf(new Date(y, m + 1, Math.min(day, lastNext)));
}

/** "har dushanba", "har oyning 5-sanasi" — vazifa qatorida ko'rsatiladigan yozuv. */
function repeatLabel(task) {
  if (!task.repeat_kind || !task.due_date) return REPEAT_UNITS[task.repeat_kind] ? 'har ' + REPEAT_UNITS[task.repeat_kind] : null;
  switch (task.repeat_kind) {
    case 'daily': return 'har kuni';
    case 'weekly': return `har ${WEEKDAYS[weekdayOf(task.due_date)]}`;
    case 'monthly': return `har oyning ${monthDayOf(task.due_date)}-sanasi`;
    case 'yearly': {
      const [, m, d] = task.due_date.split('-').map(Number);
      return `har yili ${d}-${MONTHS[m - 1]}`;
    }
    default: return null;
  }
}

/** Tafsilot oynasidagi tushuntirish: qachon va soat nechada eslatiladi. */
function repeatSummary(task) {
  const when = repeatLabel(task);
  if (!when) return '';
  const time = task.due_time
    ? `soat <b>${esc(task.due_time)}</b> da`
    : 'ertalab <b>9:00</b> da (vaqt belgilanmagan)';
  return `<b>${esc(when)}</b>, ${time} eslatiladi.`;
}

function projectById(id) { return state.projects.find((p) => p.id === id); }
function sectionsOf(pid) { return state.sections.filter((s) => s.project_id === pid); }
function tasksOf(sid) { return state.tasks.filter((t) => t.section_id === sid && !t.done); }
function doneOf(pid) { return state.tasks.filter((t) => t.project_id === pid && t.done); }
function openTasksOf(pid) { return state.tasks.filter((t) => t.project_id === pid && !t.done); }

function collapsedProjects() {
  return new Set(state.settings.collapsedProjects || []);
}
function collapsedDone() {
  return new Set(state.settings.openDone || []);
}

/* ============================================================ ma'lumot yuklash */

async function reload() {
  state = await window.api.getState();
  render();
}

/** Har qanday o'zgarishdan keyin: bazadan qayta o'qib, ekranni yangilaydi. */
async function mutate(fn) {
  try {
    const out = await fn();
    state = await window.api.getState();
    render();
    return out;
  } catch (err) {
    toast(`Xatolik: ${err.message}`);
    throw err;
  }
}

async function saveSetting(key, value) {
  state.settings[key] = value;
  await window.api.settings.set(key, value);
}

/* ============================================================ chizish */

function render() {
  captureFocus();
  renderSidebar();
  renderTopbar();
  renderContent();
  restoreFocus();
}

/**
 * render() butun ro'yxatni innerHTML bilan qaytadan quradi, ya'ni yozilayotgan
 * matn DOM bilan birga yo'q bo'ladi. Shuning uchun fokusdagi maydonning
 * qiymati ham, kursor o'rni ham chizishdan oldin olinadi va keyin qaytariladi.
 */
function captureFocus() {
  const el = document.activeElement;
  if (el && el.dataset && el.dataset.fk) {
    ui.focusKey = el.dataset.fk;
    ui.focusValue = typeof el.value === 'string' ? el.value : null;
    ui.caret = typeof el.selectionStart === 'number' ? el.selectionStart : null;
  } else {
    ui.focusKey = null;
    ui.focusValue = null;
    ui.caret = null;
  }
}

function restoreFocus() {
  if (!ui.focusKey) return;
  const el = document.querySelector(`[data-fk="${CSS.escape(ui.focusKey)}"]`);
  if (!el) { ui.focusKey = null; ui.focusValue = null; return; }
  if (ui.focusValue != null && typeof el.value === 'string' && el.value !== ui.focusValue) {
    el.value = ui.focusValue;
  }
  el.focus();
  if (ui.caret != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(ui.caret, ui.caret); } catch { /* e'tiborsiz */ }
  }
}

/* ------------------------------------------------------------ chap panel */

function renderSidebar() {
  const today = todayISO();
  const week = addDaysISO(7);
  const undone = state.tasks.filter((t) => !t.done);

  const overdue = undone.filter((t) => t.due_date && t.due_date < today).length;
  const dueToday = undone.filter((t) => t.due_date && t.due_date === today).length;
  const soon = undone.filter((t) => t.due_date && t.due_date <= week).length;

  const views = [
    { key: 'all', ico: '🗂', label: 'Hammasi', count: undone.length, cls: '' },
    { key: 'today', ico: '📌', label: 'Bugun', count: overdue + dueToday, cls: overdue + dueToday ? 'alarm' : '' },
    { key: 'soon', ico: '⏳', label: 'Yaqin 7 kun', count: soon, cls: soon ? 'warn' : '' },
    { key: 'overdue', ico: '⚠', label: 'Muddati o‘tgan', count: overdue, cls: overdue ? 'alarm' : '' },
  ];

  $('#views').innerHTML = views.map((v) => `
    <div class="nav-item ${ui.view === v.key ? 'active' : ''}" data-act="view" data-view="${v.key}">
      <span class="ico">${v.ico}</span>
      <span class="label">${v.label}</span>
      ${v.count ? `<span class="count ${v.cls}">${v.count}</span>` : ''}
    </div>`).join('');

  $('#projects').innerHTML = state.projects.map((p) => {
    const open = openTasksOf(p.id);
    const late = open.filter((t) => t.due_date && t.due_date <= today).length;
    const active = ui.view === 'project' && ui.projectId === p.id;
    return `
      <div class="nav-item ${active ? 'active' : ''}" draggable="true"
           data-act="view" data-view="project" data-project="${p.id}">
        <span class="dot" style="background:${esc(p.color)}"></span>
        <span class="label" title="${esc(p.name)}">${esc(p.name)}</span>
        ${late ? `<span class="count alarm">${late}</span>` : open.length ? `<span class="count">${open.length}</span>` : ''}
      </div>`;
  }).join('') || '<div class="hint" style="padding:6px 10px">Hali loyiha yo‘q</div>';
}

/* ------------------------------------------------------------ yuqori panel */

function renderTopbar() {
  const titles = {
    all: 'Hammasi', today: 'Bugun', soon: 'Yaqin 7 kun', overdue: 'Muddati o‘tgan',
  };
  let title = titles[ui.view] || '';
  let sub = '';

  if (ui.view === 'project') {
    const p = projectById(ui.projectId);
    title = p ? p.name : 'Loyiha';
    if (p) {
      const open = openTasksOf(p.id).length;
      const done = doneOf(p.id).length;
      sub = `${open} ta ochiq · ${done} ta bajarilgan`;
    }
  } else {
    const undone = state.tasks.filter((t) => !t.done).length;
    sub = `${undone} ta ochiq vazifa`;
  }
  if (ui.search) sub = 'qidiruv natijalari';

  $('#view-title').textContent = title;
  $('#view-sub').textContent = sub;
  $('#search-clear').hidden = !ui.search;
}

/* ------------------------------------------------------------ mazmun */

function renderContent() {
  const box = $('#content');
  const scrollTop = box.scrollTop;

  if (ui.search) box.innerHTML = renderSearchResults();
  else if (ui.view === 'project') box.innerHTML = renderProjectTree([projectById(ui.projectId)].filter(Boolean), true);
  else if (ui.view === 'all') box.innerHTML = renderProjectTree(state.projects, false);
  else box.innerHTML = renderFiltered();

  box.scrollTop = scrollTop;
}

function emptyBox(icon, lead, hint) {
  return `<div class="empty"><div class="big">${icon}</div><div class="lead">${esc(lead)}</div>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}

/* ---------- daraxt ko'rinishi (Hammasi va alohida loyiha) ---------- */

function renderProjectTree(projects, single) {
  if (!projects.length) {
    return emptyBox('🗂', 'Hali loyiha yo‘q', 'Chapdagi “Loyihalar” yonidagi + tugmasi bilan birinchi loyihani yarating');
  }

  const collapsed = collapsedProjects();
  const doneOpen = collapsedDone();

  return projects.map((p) => {
    const isCollapsed = !single && collapsed.has(p.id);
    const open = openTasksOf(p.id);
    const done = doneOf(p.id);
    const today = todayISO();
    const late = open.filter((t) => t.due_date && t.due_date <= today).length;

    const head = single ? '' : `
      <div class="project-head ${isCollapsed ? 'collapsed' : ''}" data-act="toggle-project" data-project="${p.id}">
        <span class="twisty">▼</span>
        <span class="dot" style="background:${esc(p.color)}"></span>
        <span class="name">${esc(p.name)}</span>
        ${late ? `<span class="badge alarm">${late}</span>` : ''}
        <span class="meta">${open.length} ta</span>
        <span class="spacer"></span>
        <span class="row-actions">
          <button class="icon-btn" data-act="add-section" data-project="${p.id}" title="Yangi mavzu">＋</button>
          <button class="icon-btn" data-act="edit-project" data-project="${p.id}" title="Tahrirlash">✎</button>
          <button class="icon-btn danger" data-act="del-project" data-project="${p.id}" title="Loyihani o‘chirish">🗑</button>
        </span>
      </div>`;

    if (isCollapsed) return `<div class="project-block">${head}</div>`;

    // Bitta mavzuli loyihada mavzu sarlavhasi ortiqcha — vazifalar to'g'ridan-to'g'ri ko'rinadi.
    const secs = sectionsOf(p.id);
    const bare = secs.length === 1;
    const sections = secs.map((s) => renderSection(p, s, bare)).join('');
    const doneBlock = done.length ? renderDoneBlock(p, done, doneOpen.has(p.id)) : '';

    return `<div class="project-block">
      ${head}
      ${sections}
      <button class="add-section-btn" data-act="add-section" data-project="${p.id}">＋ mavzu</button>
      ${doneBlock}
    </div>`;
  }).join('');
}

function renderSection(project, section, bare = false) {
  const tasks = tasksOf(section.id);
  const isCollapsed = !bare && !!section.collapsed;

  const body = isCollapsed ? '' : `
    <div class="section-body" data-section="${section.id}" data-project="${project.id}">
      ${tasks.map((t) => renderTask(t, { crumb: false })).join('')}
      <div class="add-row ${tasks.length ? '' : 'always'}">
        <span class="plus">＋</span>
        <input class="add-input" type="text" placeholder="Vazifa qo‘shish…"
               data-act="add-task" data-section="${section.id}" data-project="${project.id}"
               data-fk="add-${section.id}" />
      </div>
    </div>`;

  const head = bare ? '' : `
    <div class="section-head ${isCollapsed ? 'collapsed' : ''}" data-act="toggle-section" data-section="${section.id}">
      <span class="twisty">▼</span>
      <span class="name">${esc(section.name)}</span>
      ${isCollapsed ? `<span class="count">${tasks.length}</span>` : ''}
      <span class="spacer"></span>
      <span class="row-actions">
        <button class="icon-btn" data-act="move-section" data-section="${section.id}" data-dir="-1" title="Yuqoriga">▲</button>
        <button class="icon-btn" data-act="move-section" data-section="${section.id}" data-dir="1" title="Pastga">▼</button>
        <button class="icon-btn" data-act="rename-section" data-section="${section.id}" title="Nomini o‘zgartirish">✎</button>
        <button class="icon-btn danger" data-act="del-section" data-section="${section.id}" title="Mavzuni o‘chirish">🗑</button>
      </span>
    </div>`;

  return `<div class="section-block ${bare ? 'bare' : ''}">${head}${body}</div>`;
}

function renderDoneBlock(project, done, isOpen) {
  const list = isOpen
    ? `<div class="done-body">${done.map((t) => renderTask(t, { crumb: true })).join('')}
         <div style="padding:6px 8px">
           <button class="ghost-btn" data-act="clear-done" data-project="${project.id}">Bajarilganlarni tozalash</button>
         </div>
       </div>`
    : '';

  return `<div class="done-block">
    <div class="done-head" data-act="toggle-done" data-project="${project.id}">
      <span class="twisty ${isOpen ? '' : 'collapsed'}">▼</span>
      <span>✓ Bajarilgan (${done.length})</span>
    </div>
    ${list}
  </div>`;
}

/* ---------- vazifa qatori ---------- */

function renderTask(task, { crumb = false } = {}) {
  const due = dueInfo(task);
  const prio = PRIO[task.priority];
  const isOpen = ui.openTask === task.id;
  const editing = ui.editingTask === task.id;

  const titleHtml = editing
    ? `<input class="task-title-input" type="text" value="${esc(task.title)}"
              data-act="save-title" data-id="${task.id}" data-fk="title-${task.id}" />`
    : `<div class="task-title" data-act="edit-title" data-id="${task.id}">${hl(task.title, ui.search)}</div>`;

  const sub = [];
  if (crumb) {
    const p = projectById(task.project_id);
    const s = state.sections.find((x) => x.id === task.section_id);
    if (p) {
      sub.push(`<span class="crumb" data-act="goto-project" data-project="${p.id}">
        <span class="dot" style="display:inline-block;background:${esc(p.color)}"></span>
        ${esc(p.name)}${s ? ' › ' + esc(s.name) : ''}</span>`);
    }
  }
  if (due && !task.done) {
    sub.push(`<span class="badge ${due.cls} ${due.pulse ? 'pulse' : ''}">${due.icon} ${esc(due.label)}</span>`);
  } else if (due && task.done) {
    sub.push(`<span class="badge gray">📅 ${esc(formatDate(task.due_date))}</span>`);
  }
  const rep = repeatLabel(task);
  if (rep && !task.done) sub.push(`<span class="badge gray" title="Takrorlanuvchi vazifa">🔁 ${esc(rep)}</span>`);
  if (prio) sub.push(`<span class="prio ${prio.cls}" title="Muhimlik: ${prio.name}">${prio.mark}</span>`);
  if (task.note) sub.push(`<span class="note-mark" title="Izoh bor">📝</span>`);

  return `
  <div class="task ${task.done ? 'done' : ''} ${isOpen ? 'open' : ''}" data-id="${task.id}"
       draggable="${task.done ? 'false' : 'true'}">
    <button class="check" data-act="toggle-done-task" data-id="${task.id}" title="Bajarildi deb belgilash">✓</button>
    <div class="task-main">
      ${titleHtml}
      ${sub.length ? `<div class="task-sub">${sub.join('')}</div>` : ''}
    </div>
    <span class="row-actions">
      <button class="icon-btn" data-act="open-task" data-id="${task.id}" title="Tafsilotlar / muddat">⋯</button>
      <button class="icon-btn danger" data-act="del-task" data-id="${task.id}" title="O‘chirish">🗑</button>
    </span>
  </div>
  ${isOpen ? renderDetail(task) : ''}`;
}

// Dushanbadan boshlanadigan tartib (JS'da 0 = yakshanba).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_SHORT = { 1: 'Du', 2: 'Se', 3: 'Ch', 4: 'Pa', 5: 'Ju', 6: 'Sh', 0: 'Ya' };

/** Takrorlanish sozlamalari: hafta kuni / oy sanasi va aniq vaqt. */
function renderRepeatBox(task) {
  const kind = task.repeat_kind;
  const wd = task.due_date ? weekdayOf(task.due_date) : null;
  const md = task.due_date ? monthDayOf(task.due_date) : null;

  const weekdayRow = kind !== 'weekly' ? '' : `
    <div class="field">
      <label>Hafta kuni</label>
      <div class="chips">
        ${WEEK_ORDER.map((n) => `<button class="chip ${wd === n ? 'on' : ''}"
          data-act="set-weekday" data-id="${task.id}" data-value="${n}"
          title="${esc(WEEKDAYS[n])}">${WEEK_SHORT[n]}</button>`).join('')}
      </div>
    </div>`;

  const monthDayRow = kind !== 'monthly' ? '' : `
    <div class="field">
      <label>Oyning sanasi</label>
      <select class="input" data-act="set-monthday" data-id="${task.id}">
        ${Array.from({ length: 31 }, (_, i) => i + 1).map((n) =>
          `<option value="${n}" ${md === n ? 'selected' : ''}>${n}-sana</option>`).join('')}
      </select>
    </div>`;

  return `
    <div class="repeat-box">
      <div class="detail-row">
        ${weekdayRow}
        ${monthDayRow}
        <div class="field">
          <label>Eslatma vaqti</label>
          <input class="input" type="time" value="${esc(task.due_time || '')}"
                 data-act="set-field" data-field="dueTime" data-id="${task.id}" />
        </div>
      </div>
      <div class="hint">${repeatSummary(task)}
        Bajarildi deb belgilaganingizda bu vazifa “Bajarilgan” bo‘limiga tushadi va
        o‘rniga keyingisi shu kun va vaqt bilan ochiladi.</div>
    </div>`;
}

function renderDetail(task) {
  const opts = state.projects.map((p) => {
    const inner = sectionsOf(p.id).map((s) =>
      `<option value="${s.id}" ${s.id === task.section_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<optgroup label="${esc(p.name)}">${inner}</optgroup>`;
  }).join('');

  const quick = [
    { label: 'Bugun', v: todayISO() },
    { label: 'Ertaga', v: addDaysISO(1) },
    { label: '3 kun', v: addDaysISO(3) },
    { label: '1 hafta', v: addDaysISO(7) },
  ];

  return `<div class="task-detail" data-id="${task.id}">
    <div class="detail-row">
      <div class="field">
        <label>Muddat</label>
        <input class="input" type="date" value="${esc(task.due_date || '')}"
               data-act="set-field" data-field="dueDate" data-id="${task.id}" />
      </div>
      <div class="field">
        <label>Vaqt (ixtiyoriy)</label>
        <input class="input" type="time" value="${esc(task.due_time || '')}"
               data-act="set-field" data-field="dueTime" data-id="${task.id}" />
      </div>
      <div class="field">
        <label>Tez tanlash</label>
        <div class="chips">
          ${quick.map((q) => `<button class="chip ${task.due_date === q.v ? 'on' : ''}"
             data-act="quick-due" data-id="${task.id}" data-value="${q.v}">${q.label}</button>`).join('')}
          ${task.due_date ? `<button class="chip" data-act="quick-due" data-id="${task.id}" data-value="">Muddatsiz</button>` : ''}
        </div>
      </div>
    </div>

    <div class="detail-row">
      <div class="field">
        <label>Takrorlanish</label>
        <div class="chips">
          ${[['', 'Yo‘q'], ['daily', 'Har kuni'], ['weekly', 'Har hafta'], ['monthly', 'Har oy'], ['yearly', 'Har yil']]
            .map(([v, n]) => `<button class="chip ${(task.repeat_kind || '') === v ? 'on' : ''}"
              data-act="set-repeat" data-id="${task.id}" data-value="${v}">${n}</button>`).join('')}
        </div>
      </div>
    </div>
    ${task.repeat_kind ? renderRepeatBox(task) : ''}

    <div class="detail-row">
      <div class="field">
        <label>Muhimlik</label>
        <div class="chips">
          ${[0, 1, 2].map((n) => `<button class="chip ${task.priority === n ? 'on' : ''}"
             data-act="set-prio" data-id="${task.id}" data-value="${n}">${['Oddiy', '⚑ O‘rta', '⚑ Yuqori'][n]}</button>`).join('')}
        </div>
      </div>
      <div class="field" style="flex:1;min-width:190px">
        <label>Joylashuvi (loyiha › mavzu)</label>
        <select class="input" data-act="set-field" data-field="sectionId" data-id="${task.id}">${opts}</select>
      </div>
    </div>

    <div class="field">
      <label>Izoh</label>
      <textarea class="input" placeholder="Qo‘shimcha ma'lumot, havola, eslatma…"
                data-act="set-field" data-field="note" data-id="${task.id}"
                data-fk="note-${task.id}">${esc(task.note || '')}</textarea>
    </div>

    <div class="detail-foot">
      <span class="hint">Yaratilgan: ${esc((task.created_at || '').slice(0, 10))}${
        task.done_at ? ` · Bajarilgan: ${esc(task.done_at.slice(0, 10))}` : ''}</span>
      <span>
        <button class="ghost-btn" data-act="open-task" data-id="${task.id}">Yopish</button>
        <button class="ghost-btn" style="color:var(--danger)" data-act="del-task" data-id="${task.id}">O‘chirish</button>
      </span>
    </div>
  </div>`;
}

/* ---------- sana bo'yicha filtrlangan ko'rinishlar ---------- */

function renderFiltered() {
  const today = todayISO();
  const week = addDaysISO(7);
  let list = state.tasks.filter((t) => !t.done && t.due_date);

  if (ui.view === 'today') list = list.filter((t) => t.due_date <= today);
  else if (ui.view === 'soon') list = list.filter((t) => t.due_date <= week);
  else if (ui.view === 'overdue') list = list.filter((t) => t.due_date < today);

  if (!list.length) {
    const msg = {
      today: ['🎉', 'Bugunga vazifa yo‘q', 'Muddati bugun yoki undan oldin bo‘lgan vazifalar shu yerda ko‘rinadi'],
      soon: ['🌤', 'Yaqin bir haftada muddatli vazifa yo‘q', ''],
      overdue: ['👍', 'Kechikkan vazifa yo‘q', 'Barcha muddatlar joyida'],
    }[ui.view];
    return emptyBox(msg[0], msg[1], msg[2]);
  }

  list.sort((a, b) => (a.due_date + (a.due_time || '')).localeCompare(b.due_date + (b.due_time || '')) ||
    b.priority - a.priority);

  // Muddatga qarab guruhlash — bir qarashda nima shoshilinchligi ko'rinsin.
  const groups = new Map();
  for (const t of list) {
    const d = daysUntil(t.due_date);
    const key = d < 0 ? 'Muddati o‘tgan' : d === 0 ? 'Bugun' : d === 1 ? 'Ertaga' : 'Keyingi kunlar';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  return [...groups].map(([name, tasks]) => `
    <div class="project-block">
      <div class="project-head" style="cursor:default">
        <span class="name">${esc(name)}</span>
        <span class="meta">${tasks.length} ta</span>
      </div>
      <div class="section-body" style="margin-left:7px">
        ${tasks.map((t) => renderTask(t, { crumb: true })).join('')}
      </div>
    </div>`).join('');
}

/* ---------- qidiruv ---------- */

function renderSearchResults() {
  const q = ui.search.toLowerCase();
  const matches = state.tasks.filter((t) => {
    if (t.title.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q)) return true;
    const s = state.sections.find((x) => x.id === t.section_id);
    const p = projectById(t.project_id);
    return (s && s.name.toLowerCase().includes(q)) || (p && p.name.toLowerCase().includes(q));
  });

  if (!matches.length) return emptyBox('🔍', `“${ui.search}” bo‘yicha hech narsa topilmadi`, 'Boshqa so‘z bilan urinib ko‘ring');

  const open = matches.filter((t) => !t.done);
  const done = matches.filter((t) => t.done);

  const block = (title, tasks) => tasks.length ? `
    <div class="project-block">
      <div class="project-head" style="cursor:default">
        <span class="name">${title}</span><span class="meta">${tasks.length} ta</span>
      </div>
      <div class="section-body" style="margin-left:7px">
        ${tasks.map((t) => renderTask(t, { crumb: true })).join('')}
      </div>
    </div>` : '';

  return block('Ochiq vazifalar', open) + block('Bajarilganlar', done);
}

/* ============================================================ hodisalar */

function findTask(id) { return state.tasks.find((t) => t.id === id); }

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = Number(el.dataset.id);
  const pid = Number(el.dataset.project);
  const sid = Number(el.dataset.section);

  switch (act) {
    case 'view':
      ui.view = el.dataset.view;
      ui.projectId = el.dataset.project ? pid : null;
      ui.openTask = null;
      render();
      break;

    case 'goto-project':
      e.stopPropagation();
      ui.view = 'project';
      ui.projectId = pid;
      ui.search = '';
      $('#search').value = '';
      render();
      break;

    case 'toggle-project': {
      if (e.target.closest('.row-actions')) return;
      const set = collapsedProjects();
      set.has(pid) ? set.delete(pid) : set.add(pid);
      await saveSetting('collapsedProjects', [...set]);
      render();
      break;
    }

    case 'toggle-section': {
      if (e.target.closest('.row-actions')) return;
      const sec = state.sections.find((s) => s.id === sid);
      await mutate(() => window.api.section.update({ id: sid, collapsed: !sec.collapsed }));
      break;
    }

    case 'toggle-done': {
      const set = collapsedDone();
      set.has(pid) ? set.delete(pid) : set.add(pid);
      await saveSetting('openDone', [...set]);
      render();
      break;
    }

    case 'toggle-done-task': {
      const t = findTask(id);
      const res = await mutate(() => window.api.task.update({ id, done: !t.done }));
      if (!t.done) {
        toast(res && res.spawned
          ? `✓ Bajarildi. Keyingisi: ${formatDate(res.spawned.due_date)}`
          : `✓ “${trim(t.title)}” bajarildi deb belgilandi`);
      }
      break;
    }

    case 'open-task':
      ui.openTask = ui.openTask === id ? null : id;
      ui.editingTask = null;
      render();
      break;

    case 'edit-title':
      ui.editingTask = id;
      ui.focusKey = `title-${id}`;
      ui.caret = null;
      render();
      break;

    case 'del-task': {
      const t = findTask(id);
      await mutate(() => window.api.task.remove(id));
      toast(`“${trim(t.title)}” o‘chirildi`, 'Qaytarish', async () => {
        await mutate(async () => {
          const nt = await window.api.task.create({
            projectId: t.project_id, sectionId: t.section_id, title: t.title,
            note: t.note, dueDate: t.due_date, dueTime: t.due_time, priority: t.priority,
            repeatKind: t.repeat_kind, repeatEvery: t.repeat_every,
          });
          if (t.done) await window.api.task.update({ id: nt.id, done: true });
        });
      });
      break;
    }

    case 'quick-due':
      await mutate(() => window.api.task.update({ id, dueDate: el.dataset.value || null }));
      break;

    case 'set-prio':
      await mutate(() => window.api.task.update({ id, priority: Number(el.dataset.value) }));
      break;

    case 'set-repeat': {
      const kind = el.dataset.value || null;
      const t = findTask(id);
      const patch = { id, repeatKind: kind };
      // Takrorlanuvchi ish aniq kun va aniq vaqtga bog'lanadi, aks holda
      // "har kuni" ning qachonligi noaniq bo'lib qoladi.
      if (kind) {
        if (!t.due_date) patch.dueDate = todayISO();
        if (!t.due_time) patch.dueTime = '09:00';
      }
      await mutate(() => window.api.task.update(patch));
      break;
    }

    case 'set-weekday':
      await mutate(() => window.api.task.update({ id, dueDate: nextDateForWeekday(Number(el.dataset.value)) }));
      break;

    case 'add-section': {
      e.stopPropagation();
      const name = await promptModal('Yangi mavzu', 'Mavzu nomi', '');
      if (name) {
        const sec = await mutate(() => window.api.section.create({ projectId: pid, name }));
        ui.focusKey = `add-${sec.id}`;
        render();
      }
      break;
    }

    case 'rename-section': {
      e.stopPropagation();
      const sec = state.sections.find((s) => s.id === sid);
      const name = await promptModal('Mavzu nomi', 'Nom', sec.name);
      if (name) await mutate(() => window.api.section.update({ id: sid, name }));
      break;
    }

    case 'move-section': {
      e.stopPropagation();
      const sec = state.sections.find((s) => s.id === sid);
      const sibs = sectionsOf(sec.project_id);
      const i = sibs.findIndex((s) => s.id === sid);
      const j = i + Number(el.dataset.dir);
      if (j < 0 || j >= sibs.length) return;
      [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
      await mutate(() => window.api.section.reorder(sibs.map((s) => s.id)));
      break;
    }

    case 'del-section': {
      e.stopPropagation();
      const sec = state.sections.find((s) => s.id === sid);
      const n = state.tasks.filter((t) => t.section_id === sid).length;
      const ok = await window.api.confirm({
        title: 'Mavzuni o‘chirish',
        message: `“${sec.name}” mavzusi o‘chirilsinmi?`,
        detail: n ? `Ichidagi ${n} ta vazifa o‘chmaydi — shu loyihaning birinchi mavzusiga ko‘chiriladi.` : 'Mavzu bo‘sh.',
        confirmLabel: 'O‘chirish',
      });
      if (ok) await mutate(() => window.api.section.remove(sid));
      break;
    }

    case 'edit-project':
      e.stopPropagation();
      openProjectModal(projectById(pid));
      break;

    case 'del-project': {
      e.stopPropagation();
      const p = projectById(pid);
      const n = state.tasks.filter((t) => t.project_id === pid).length;
      const ok = await window.api.confirm({
        title: 'Loyihani o‘chirish',
        message: `“${p.name}” loyihasi o‘chirilsinmi?`,
        detail: `Ichidagi ${n} ta vazifa ham o‘chadi. Bu amalni darhol “Qaytarish” tugmasi bilan bekor qilish mumkin.`,
        confirmLabel: 'O‘chirish',
      });
      if (!ok) return;
      const snapshot = {
        projects: [p],
        sections: sectionsOf(pid),
        tasks: state.tasks.filter((t) => t.project_id === pid),
      };
      await mutate(() => window.api.project.remove(pid));
      if (ui.projectId === pid) { ui.view = 'all'; ui.projectId = null; render(); }
      toast(`“${p.name}” o‘chirildi`, 'Qaytarish', () => restoreSnapshot(snapshot));
      break;
    }

    case 'clear-done': {
      const n = doneOf(pid).length;
      const ok = await window.api.confirm({
        title: 'Bajarilganlarni tozalash',
        message: `${n} ta bajarilgan vazifa butunlay o‘chirilsinmi?`,
        detail: 'Bu amalni qaytarib bo‘lmaydi.',
        confirmLabel: 'Tozalash',
      });
      if (ok) await mutate(() => window.api.task.clearDone(pid));
      break;
    }
  }
});

async function restoreSnapshot(snapshot) {
  await mutate(async () => {
    const np = await window.api.project.create({ name: snapshot.projects[0].name, color: snapshot.projects[0].color });
    const fresh = (await window.api.getState()).sections.filter((s) => s.project_id === np.id);
    const map = new Map();
    for (const s of snapshot.sections) {
      const ns = await window.api.section.create({ projectId: np.id, name: s.name });
      map.set(s.id, ns.id);
    }
    for (const f of fresh) await window.api.section.remove(f.id);
    const fallback = map.values().next().value;
    for (const t of snapshot.tasks) {
      const nt = await window.api.task.create({
        projectId: np.id, sectionId: map.get(t.section_id) || fallback, title: t.title,
        note: t.note, dueDate: t.due_date, dueTime: t.due_time, priority: t.priority,
        repeatKind: t.repeat_kind, repeatEvery: t.repeat_every,
      });
      if (t.done) await window.api.task.update({ id: nt.id, done: true });
    }
  });
}

function trim(s, n = 34) { return s.length > n ? s.slice(0, n) + '…' : s; }

/* ---------- klaviatura: vazifa qo'shish va sarlavha tahriri ---------- */

document.addEventListener('keydown', async (e) => {
  const el = e.target;

  if (el.dataset && el.dataset.act === 'add-task') {
    if (e.key === 'Enter') {
      const title = el.value.trim();
      if (!title) return;
      el.value = '';
      ui.focusKey = el.dataset.fk;
      ui.caret = 0;
      await mutate(() => window.api.task.create({
        projectId: Number(el.dataset.project),
        sectionId: Number(el.dataset.section),
        title,
      }));
    } else if (e.key === 'Escape') {
      el.value = '';
      el.blur();
    }
    return;
  }

  if (el.dataset && el.dataset.act === 'save-title') {
    if (e.key === 'Enter') { e.preventDefault(); await commitTitle(el); }
    else if (e.key === 'Escape') { ui.editingTask = null; render(); }
  }
});

document.addEventListener('focusout', async (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.act === 'save-title' && ui.editingTask) await commitTitle(el);
});

async function commitTitle(el) {
  const id = Number(el.dataset.id);
  const title = el.value.trim();
  const cur = findTask(id);
  ui.editingTask = null;
  if (!cur) return render();
  if (!title || title === cur.title) return render();
  await mutate(() => window.api.task.update({ id, title }));
}

/* ---------- tafsilot maydonlari ---------- */

document.addEventListener('change', async (e) => {
  const md = e.target.closest('[data-act="set-monthday"]');
  if (md) {
    await mutate(() => window.api.task.update({
      id: Number(md.dataset.id),
      dueDate: nextDateForMonthDay(Number(md.value)),
    }));
    return;
  }

  const el = e.target.closest('[data-act="set-field"]');
  if (!el) return;
  const id = Number(el.dataset.id);
  const field = el.dataset.field;
  let value = el.value;

  if (field === 'sectionId') {
    const sec = state.sections.find((s) => s.id === Number(value));
    await mutate(() => window.api.task.update({ id, sectionId: sec.id, projectId: sec.project_id }));
    return;
  }
  if ((field === 'dueDate' || field === 'dueTime') && value === '') value = null;
  await mutate(() => window.api.task.update({ id, [field]: value }));
});

// Izoh matni har bir harfda emas, yozish to'xtaganda saqlanadi.
let noteTimer = null;
document.addEventListener('input', (e) => {
  const el = e.target.closest('textarea[data-field="note"]');
  if (!el) return;
  clearTimeout(noteTimer);
  const id = Number(el.dataset.id);
  const value = el.value;
  noteTimer = setTimeout(async () => {
    await window.api.task.update({ id, note: value });
    state = await window.api.getState();
  }, 600);
});

/* ---------- sudrab ko'chirish ---------- */

document.addEventListener('dragstart', (e) => {
  const task = e.target.closest('.task[draggable="true"]');
  if (task) {
    ui.dragTaskId = Number(task.dataset.id);
    task.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(ui.dragTaskId));
    return;
  }
  const nav = e.target.closest('.nav-item[data-view="project"]');
  if (nav) {
    ui.dragProjectId = Number(nav.dataset.project);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'p' + ui.dragProjectId);
  }
});

document.addEventListener('dragend', () => {
  ui.dragTaskId = null;
  ui.dragProjectId = null;
  clearDropMarks();
});

function clearDropMarks() {
  document.querySelectorAll('.drop-above,.drop-below,.drop-target,.dragging')
    .forEach((n) => n.classList.remove('drop-above', 'drop-below', 'drop-target', 'dragging'));
}

document.addEventListener('dragover', (e) => {
  if (ui.dragTaskId) {
    const body = e.target.closest('.section-body[data-section]');
    if (!body) return;
    e.preventDefault();
    clearDropMarks();
    document.querySelector('.dragging')?.classList.add('dragging');

    const over = e.target.closest('.task');
    if (over && Number(over.dataset.id) !== ui.dragTaskId) {
      const r = over.getBoundingClientRect();
      over.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
    } else if (!over) {
      body.classList.add('drop-target');
    }
    return;
  }

  if (ui.dragProjectId) {
    const nav = e.target.closest('.nav-item[data-view="project"]');
    if (!nav) return;
    e.preventDefault();
    clearDropMarks();
    const r = nav.getBoundingClientRect();
    nav.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
  }
});

document.addEventListener('drop', async (e) => {
  if (ui.dragTaskId) {
    const body = e.target.closest('.section-body[data-section]');
    if (!body) return clearDropMarks();
    e.preventDefault();

    const dragId = ui.dragTaskId;
    const sectionId = Number(body.dataset.section);
    const over = e.target.closest('.task');
    let beforeId = null;
    if (over && Number(over.dataset.id) !== dragId) {
      const r = over.getBoundingClientRect();
      const overId = Number(over.dataset.id);
      if (e.clientY < r.top + r.height / 2) beforeId = overId;
      else {
        const list = [...body.querySelectorAll('.task')].map((n) => Number(n.dataset.id));
        const idx = list.indexOf(overId);
        beforeId = list[idx + 1] ?? null;
      }
    }
    clearDropMarks();
    ui.dragTaskId = null;
    await mutate(() => window.api.task.move({ id: dragId, sectionId, beforeId }));
    return;
  }

  if (ui.dragProjectId) {
    const nav = e.target.closest('.nav-item[data-view="project"]');
    if (!nav) return clearDropMarks();
    e.preventDefault();
    const dragId = ui.dragProjectId;
    const targetId = Number(nav.dataset.project);
    const r = nav.getBoundingClientRect();
    const above = e.clientY < r.top + r.height / 2;
    clearDropMarks();
    ui.dragProjectId = null;
    if (dragId === targetId) return;

    const ids = state.projects.map((p) => p.id).filter((x) => x !== dragId);
    const idx = ids.indexOf(targetId);
    ids.splice(above ? idx : idx + 1, 0, dragId);
    await mutate(() => window.api.project.reorder(ids));
  }
});

/* ============================================================ qidiruv */

let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => {
    ui.search = v.trim();
    ui.openTask = null;
    renderTopbar();
    renderContent();
  }, 120);
});

$('#search-clear').addEventListener('click', () => {
  $('#search').value = '';
  ui.search = '';
  render();
});

/* ============================================================ yuqori tugmalar */

$('#btn-new-task').addEventListener('click', focusFirstAdd);

$('#btn-new-project').addEventListener('click', () => openProjectModal(null));

$('#btn-expand-all').addEventListener('click', async () => {
  const anyOpen = state.sections.some((s) => !s.collapsed) || collapsedProjects().size === 0;
  await mutate(async () => {
    for (const s of state.sections) {
      if (!!s.collapsed === anyOpen) continue;
      await window.api.section.update({ id: s.id, collapsed: anyOpen });
    }
  });
  await saveSetting('collapsedProjects', anyOpen ? state.projects.map((p) => p.id) : []);
  render();
});

$('#btn-settings').addEventListener('click', openSettingsModal);

$('#btn-help').addEventListener('click', openHelpModal);

/** “+ Vazifa” — joriy ko'rinishdagi birinchi qo'shish maydoniga fokus beradi. */
function focusFirstAdd() {
  if (ui.view !== 'all' && ui.view !== 'project') {
    ui.view = 'all';
    ui.search = '';
    $('#search').value = '';
    render();
  }
  const input = document.querySelector('.add-input');
  if (input) {
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.focus();
  } else {
    toast('Avval loyiha yarating');
  }
}

/* ============================================================ tezkor tugmalar */

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openProjectModal(null);
    return;
  }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    focusFirstAdd();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#modal-backdrop').hidden) { closeModal(); return; }
    if (document.activeElement === $('#search')) {
      $('#search').value = '';
      ui.search = '';
      $('#search').blur();
      render();
      return;
    }
    if (ui.openTask && !typing) { ui.openTask = null; render(); }
  }
});

/* ============================================================ modal oynalar */

let modalCleanup = null;

function openModal(html, setup) {
  $('#modal').innerHTML = html;
  $('#modal-backdrop').hidden = false;
  modalCleanup = setup ? setup($('#modal')) : null;
  const first = $('#modal').querySelector('input, textarea, button');
  first?.focus();
  if (first?.select) first.select();
}

function closeModal() {
  $('#modal-backdrop').hidden = true;
  $('#modal').innerHTML = '';
  if (typeof modalCleanup === 'function') modalCleanup();
  modalCleanup = null;
}

$('#modal-backdrop').addEventListener('mousedown', (e) => {
  if (e.target === $('#modal-backdrop')) closeModal();
});

/** Oddiy matn so'rovchi oyna. Promise qaytaradi: matn yoki null. */
function promptModal(title, label, value) {
  return new Promise((resolve) => {
    openModal(`
      <h2>${esc(title)}</h2>
      <div class="field">
        <label>${esc(label)}</label>
        <input class="input" id="pm-input" type="text" value="${esc(value)}" />
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" id="pm-cancel">Bekor qilish</button>
        <button class="primary-btn" id="pm-ok">Saqlash</button>
      </div>`, (m) => {
      const input = m.querySelector('#pm-input');
      const ok = () => { const v = input.value.trim(); closeModal(); resolve(v || null); };
      m.querySelector('#pm-ok').onclick = ok;
      m.querySelector('#pm-cancel').onclick = () => { closeModal(); resolve(null); };
      input.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      return () => resolve(null);
    });
  });
}

function openProjectModal(project) {
  const isNew = !project;
  let color = project?.color || PALETTE[state.projects.length % PALETTE.length];

  openModal(`
    <h2>${isNew ? 'Yangi loyiha' : 'Loyihani tahrirlash'}</h2>
    <div class="field">
      <label>Nomi</label>
      <input class="input" id="p-name" type="text" value="${esc(project?.name || '')}" placeholder="Masalan: Sayt redizayn" />
    </div>
    <div class="field">
      <label>Rangi</label>
      <div class="color-grid" id="p-colors">
        ${PALETTE.map((c) => `<div class="color-swatch ${c === color ? 'on' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" id="p-cancel">Bekor qilish</button>
      <button class="primary-btn" id="p-save">${isNew ? 'Yaratish' : 'Saqlash'}</button>
    </div>`, (m) => {
    m.querySelector('#p-colors').onclick = (e) => {
      const sw = e.target.closest('.color-swatch');
      if (!sw) return;
      color = sw.dataset.color;
      m.querySelectorAll('.color-swatch').forEach((n) => n.classList.toggle('on', n === sw));
    };
    const save = async () => {
      const name = m.querySelector('#p-name').value.trim();
      if (!name) return m.querySelector('#p-name').focus();
      closeModal();
      if (isNew) {
        const p = await mutate(() => window.api.project.create({ name, color }));
        ui.view = 'project';
        ui.projectId = p.id;
        render();
        document.querySelector('.add-input')?.focus();
      } else {
        await mutate(() => window.api.project.update({ id: project.id, name, color }));
      }
    };
    m.querySelector('#p-save').onclick = save;
    m.querySelector('#p-cancel').onclick = closeModal;
    m.querySelector('#p-name').onkeydown = (e) => { if (e.key === 'Enter') save(); };
  });
}

async function openSettingsModal() {
  const s = state.settings;
  const dbPath = await window.api.dbPath();

  openModal(`
    <h2>Sozlamalar</h2>

    <div class="settings-row">
      <div>
        <div>Ko‘rinish</div>
        <div class="desc">Yorug‘ yoki qorong‘i mavzu</div>
      </div>
      <div class="chips" id="s-theme">
        ${[['system', 'Tizim'], ['light', 'Yorug‘'], ['dark', 'Qorong‘i']].map(([v, n]) =>
          `<button class="chip ${(s.theme || 'system') === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}
      </div>
    </div>

    <div class="settings-row">
      <div>
        <div>Muddat ogohlantirishi</div>
        <div class="desc">Necha kun qolganda “yaqinlashdi” deb belgilansin va eslatma chiqsin</div>
      </div>
      <div class="chips" id="s-days">
        ${[1, 2, 3, 5, 7].map((n) =>
          `<button class="chip ${Number(s.remindDays ?? 2) === n ? 'on' : ''}" data-v="${n}">${n} kun</button>`).join('')}
      </div>
    </div>

    <div class="settings-row">
      <div>
        <div>Eslatma oynasi</div>
        <div class="desc">Muddat vaqti kelganda ekran markazida oyna chiqadi va
          <b>OK</b> bosilmaguncha yopilmaydi</div>
      </div>
      <div class="chips" id="s-notif">
        <button class="chip ${s.notificationsOn === false ? '' : 'on'}" data-v="1">Yoqilgan</button>
        <button class="chip ${s.notificationsOn === false ? 'on' : ''}" data-v="0">O‘chirilgan</button>
      </div>
    </div>

    <div class="settings-row">
      <div>
        <div>Eslatmani sinab ko‘rish</div>
        <div class="desc">Oyna qanday chiqishini shu yerda tekshirib ko‘ring</div>
      </div>
      <button class="ghost-btn" id="s-test">Sinab ko‘rish</button>
    </div>

    <div class="settings-row">
      <div>
        <div>Windows bilan birga ishga tushsin</div>
        <div class="desc">Eslatma faqat dastur ochiq turganda chiqadi. Yoqilsa,
          kompyuter yoqilganda dastur o‘zi ishga tushadi va darhol kichraytiriladi</div>
      </div>
      <div class="chips" id="s-autostart">
        <button class="chip ${s.autoStart ? 'on' : ''}" data-v="1">Yoqilgan</button>
        <button class="chip ${s.autoStart ? '' : 'on'}" data-v="0">O‘chirilgan</button>
      </div>
    </div>

    <div class="settings-row">
      <div>
        <div>Zaxira nusxa</div>
        <div class="desc">Barcha loyiha va vazifalarni JSON faylga saqlash / fayldan qo‘shish</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="ghost-btn" id="s-export">Saqlash</button>
        <button class="ghost-btn" id="s-import">Yuklash</button>
      </div>
    </div>

    <div class="settings-row">
      <div>
        <div>Ma'lumotlar bazasi</div>
        <div class="desc mono">${esc(dbPath)}</div>
      </div>
      <button class="ghost-btn" id="s-reveal">Papkani ochish</button>
    </div>

    <div class="settings-row">
      <div>
        <div>Tezkor tugmalar</div>
        <div class="desc">Ctrl+N — vazifa · Ctrl+Shift+N — loyiha · Ctrl+F — qidiruv · Esc — yopish</div>
      </div>
    </div>

    <div class="modal-actions">
      <button class="primary-btn" id="s-close">Yopish</button>
    </div>`, (m) => {
    m.querySelector('#s-theme').onclick = async (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      await saveSetting('theme', b.dataset.v);
      applyTheme();
      m.querySelectorAll('#s-theme .chip').forEach((n) => n.classList.toggle('on', n === b));
    };
    m.querySelector('#s-days').onclick = async (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      await saveSetting('remindDays', Number(b.dataset.v));
      m.querySelectorAll('#s-days .chip').forEach((n) => n.classList.toggle('on', n === b));
      render();
    };
    m.querySelector('#s-notif').onclick = async (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      await saveSetting('notificationsOn', b.dataset.v === '1');
      m.querySelectorAll('#s-notif .chip').forEach((n) => n.classList.toggle('on', n === b));
    };
    m.querySelector('#s-autostart').onclick = async (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      await saveSetting('autoStart', b.dataset.v === '1');
      m.querySelectorAll('#s-autostart .chip').forEach((n) => n.classList.toggle('on', n === b));
    };
    m.querySelector('#s-test').onclick = async () => {
      closeModal();
      await window.api.reminder.test();
    };
    m.querySelector('#s-export').onclick = async () => {
      const r = await window.api.exportBackup();
      if (!r.canceled) toast('Zaxira nusxa saqlandi');
    };
    m.querySelector('#s-import').onclick = async () => {
      try {
        const r = await window.api.importBackup();
        if (r.canceled) return;
        closeModal();
        await reload();
        toast(`Yuklandi: ${r.stats.projects} loyiha, ${r.stats.tasks} vazifa`);
      } catch (err) {
        toast(`Xatolik: ${err.message}`);
      }
    };
    m.querySelector('#s-reveal').onclick = () => window.api.revealDb();
    m.querySelector('#s-close').onclick = closeModal;
  });
}

/* ============================================================ yo'riqnoma */

const HELP_HTML = `
  <h2>Qanday ishlatiladi</h2>

  <div class="help-block">
    <div class="help-title">1. Loyiha — qog‘ozdagi bitta varaq</div>
    <p>Chapdagi <b>LOYIHALAR</b> yonidagi <b>+</b> tugmasi bilan yangi loyiha qo‘shasiz.
    Masalan: “Sayt redizayn”, “CRM tizimi”, “Shaxsiy ishlar”.</p>
  </div>

  <div class="help-block">
    <div class="help-title">2. Vazifa yozish</div>
    <p>Loyiha ostidagi <b>“Vazifa qo‘shish…”</b> qatoriga yozib <b>Enter</b> bosing.
    Qator ochiq qoladi — ketma-ket bir nechta ish yozishingiz mumkin.</p>
  </div>

  <div class="help-block">
    <div class="help-title">3. Mavzu — varaq ichidagi sarlavha</div>
    <p>Ishlar ko‘payib ketsa, ularni mavzularga bo‘lasiz: “Dizayn”, “Backend”, “Hujjatlar”.
    Loyiha nomiga sichqonchani olib borsangiz o‘ng tomonda <b>+</b> chiqadi — mavzu shundan qo‘shiladi.</p>
    <p class="hint">Bitta mavzu bo‘lsa, uning nomi ko‘rsatilmaydi — ro‘yxat sodda ko‘rinadi.</p>
  </div>

  <div class="help-block">
    <div class="help-title">4. Muddat qo‘yish</div>
    <p>Vazifa ustiga sichqonchani olib boring va o‘ngdagi <b>⋯</b> tugmasini bosing.
    Ochilgan oynadan sana tanlang yoki <b>Bugun / Ertaga / 3 kun / 1 hafta</b> tugmalaridan foydalaning.</p>
    <p>Muddat yaqinlashgani rangdan bilinadi:</p>
    <div class="chips" style="margin-top:4px">
      <span class="badge alarm">⚠ 2 kun kechikdi</span>
      <span class="badge alarm">🔔 Bugun</span>
      <span class="badge warn">⏰ Ertaga</span>
      <span class="badge gray">📅 payshanba · 4 kun</span>
    </div>
    <p><b>Eslatma oynasi</b> muddat payti kelganda ekran markazida, barcha oynalar ustida
    chiqadi va <b>OK</b> bosilmaguncha yopilmaydi:</p>
    <table class="help-table">
      <tr><td>Vaqt qo‘ygan bo‘lsangiz</td><td>aynan o‘sha vaqtda (masalan 17:40)</td></tr>
      <tr><td>Vaqtsiz, bugungi ish</td><td>ertalab soat 9:00 da</td></tr>
      <tr><td>Muddati o‘tgan</td><td>dastur ochilishi bilan darhol</td></tr>
      <tr><td>Oldindan ogohlantirish</td><td>muddatdan N kun oldin, soat 9:00 da</td></tr>
    </table>
    <p class="hint">N ni Sozlamalardan o‘zgartirasiz. Bitta vazifa uchun kuniga bir marta
    eslatiladi. Eslatma faqat <b>dastur ochiq turganda</b> chiqadi — kompyuter yoqilganda
    dastur o‘zi ishga tushishi uchun Sozlamalardan “Windows bilan birga ishga tushsin”
    ni yoqing.</p>
  </div>

  <div class="help-block">
    <div class="help-title">5. Har hafta / har oy takrorlanadigan ishlar</div>
    <p>Bir xil ish qayta-qayta takrorlansa (masalan “Dushanba yig‘ilishi” yoki
    “Oylik hisobot”), uni har safar qaytadan yozish shart emas.</p>
    <p><b>⋯</b> tugmasini bosib, <b>Takrorlanish</b> qatoridan
    <b>Har kuni / Har hafta / Har oy / Har yil</b> ni tanlang. Shundan keyin pastda
    aniq sozlash chiqadi:</p>
    <table class="help-table">
      <tr><td><b>Har kuni</b></td><td>eslatma vaqti — masalan har kuni 09:00</td></tr>
      <tr><td><b>Har hafta</b></td><td>hafta kuni + vaqt — masalan har dushanba 10:30</td></tr>
      <tr><td><b>Har oy</b></td><td>oyning sanasi + vaqt — masalan har oyning 5-sanasi 09:00</td></tr>
      <tr><td><b>Har yil</b></td><td>muddat sanasi + vaqt</td></tr>
    </table>
    <p>Ishni bajarildi deb belgilaganingizda u <b>“Bajarilgan”</b> bo‘limiga tushadi
    va o‘rniga <b>keyingi muddat bilan yangisi o‘zi ochiladi</b>. Sana qo‘shib
    vaqt ham qo‘ygan bo‘lsangiz (masalan 09:00), vaqt o‘zgarmaydi.</p>
    <p class="hint">Hafta kuni muddatdan olinadi: dushanbaga qo‘yilgan haftalik ish
    har dushanba takrorlanadi — kechikib bajarsangiz ham dushanbaligicha qoladi.</p>
  </div>

  <div class="help-block">
    <div class="help-title">6. Bajarilgan ishni belgilash</div>
    <p>Vazifa yonidagi <b>doiracha</b>ni bosing. Ish ro‘yxatdan chiqib, o‘sha loyihaning
    pastidagi <b>“✓ Bajarilgan”</b> bo‘limiga tushadi. U yerdan qaytarib olsa ham bo‘ladi.</p>
  </div>

  <div class="help-block">
    <div class="help-title">7. Topa olmayapsizmi?</div>
    <p><b>Ctrl + F</b> bosing va so‘zni yozing — barcha loyihalar bo‘ylab qidiradi.
    Chapdagi <b>Bugun</b>, <b>Yaqin 7 kun</b>, <b>Muddati o‘tgan</b> bo‘limlari esa
    shoshilinch ishlarni bir joyga yig‘adi.</p>
  </div>

  <div class="help-block">
    <div class="help-title">8. O‘chirish va qaytarish</div>
    <p>Har bir vazifa, mavzu va loyihada <b>🗑</b> tugmasi bor. Xato o‘chirilsa,
    pastda chiqadigan <b>“Qaytarish”</b> tugmasini bosing.</p>
  </div>

  <div class="help-block">
    <div class="help-title">Tezkor tugmalar</div>
    <table class="help-table">
      <tr><td><b>Ctrl + N</b></td><td>yangi vazifa</td></tr>
      <tr><td><b>Ctrl + Shift + N</b></td><td>yangi loyiha</td></tr>
      <tr><td><b>Ctrl + F</b></td><td>qidiruv</td></tr>
      <tr><td><b>Enter</b></td><td>vazifani saqlash</td></tr>
      <tr><td><b>Esc</b></td><td>yopish / bekor qilish</td></tr>
    </table>
  </div>

  <div class="help-block">
    <div class="help-title">Ma'lumotlarim qayerda?</div>
    <p>Hammasi shu kompyuterning o‘zida saqlanadi — internet ham, server ham kerak emas.
    Boshqa hech kim ko‘rmaydi. Nusxa olish uchun:
    <b>Sozlamalar → Zaxira nusxa → Saqlash</b>.</p>
  </div>`;

function openHelpModal() {
  openModal(`${HELP_HTML}
    <div class="modal-actions">
      <button class="primary-btn" id="h-close">Tushunarli</button>
    </div>`, (m) => { m.querySelector('#h-close').onclick = closeModal; });
}

function openWelcomeModal() {
  openModal(`
    <h2>Xush kelibsiz 👋</h2>
    <p style="color:var(--text-soft);margin:0 0 14px">
      Bu dastur qog‘ozdagi ish ro‘yxatlaringiz o‘rniga. Har bir loyiha — alohida varaq,
      ichida mavzular va vazifalar. Muddat qo‘ysangiz, yaqinlashganda o‘zi ogohlantiradi.
      Barcha ma'lumot shu kompyuterda saqlanadi.
    </p>
    <p style="color:var(--text-soft);margin:0 0 14px">
      Boshlash uchun namuna loyiha tayyor turibdi — undagi vazifalarni o‘chirib,
      o‘zingiznikini yozishingiz mumkin.
    </p>
    <div class="modal-actions">
      <button class="ghost-btn" id="w-help">Yo‘riqnomani ko‘rish</button>
      <button class="primary-btn" id="w-start">Boshlash</button>
    </div>`, (m) => {
    const done = async () => { await saveSetting('seenWelcome', true); };
    m.querySelector('#w-start').onclick = async () => { await done(); closeModal(); };
    m.querySelector('#w-help').onclick = async () => { await done(); closeModal(); openHelpModal(); };
  });
}

/* ============================================================ toast */

function toast(message, actionLabel, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.onclick = async () => { el.remove(); await action(); };
    el.appendChild(btn);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), actionLabel ? 8000 : 3200);
}

/* ============================================================ mavzu (rang sxemasi) */

function applyTheme() {
  const t = state.settings.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ============================================================ ishga tushish */

window.api.onDataChanged(() => reload());
window.api.onNavigate(({ view }) => {
  ui.view = view;
  ui.projectId = null;
  ui.search = '';
  $('#search').value = '';
  render();
});

// Yarim tunda sanaga bog'liq belgilar ("Bugun", "Ertaga") o'z-o'zidan yangilansin.
// Faqat SANA almashganda chiziladi — har daqiqada qayta chizish yozilayotgan
// matnni ham, sichqoncha holatini ham bekorga buzadi.
let lastRenderedDay = todayISO();
setInterval(() => {
  if (document.hidden) return;
  const day = todayISO();
  if (day === lastRenderedDay) return;
  lastRenderedDay = day;
  render();
}, 60 * 1000);

(async function start() {
  state = await window.api.getState();
  applyTheme();
  render();
  if (!state.settings.seenWelcome) openWelcomeModal();
})();
