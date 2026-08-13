/* Renderer ichida bajariladigan tekshiruvlar. Faqat VAZIFA_SMOKE rejimida ishlatiladi. */
(async () => {
  const out = [];
  const qa = (s) => [...document.querySelectorAll(s)];
  const q = (s) => document.querySelector(s);
  const check = (name, cond, extra) => out.push({ name, ok: !!cond, extra: cond ? undefined : extra });
  const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  try {
    check('modal yopiq', q('#modal-backdrop').offsetParent === null, 'modal ko‘rinib turibdi');

    /* --- loyiha yaratish --- */
    const p = await window.api.project.create({ name: 'ZZ Test', color: '#e0533d' });
    await reload();
    check('loyiha qo‘shildi', qa('#projects .nav-item').length === 2);
    check('avto “Umumiy” mavzu', state.sections.filter((s) => s.project_id === p.id).length === 1);

    /* --- mavzu va vazifalar --- */
    const sec = await window.api.section.create({ projectId: p.id, name: 'Dizayn' });
    const mk = (title, dueOffset) => window.api.task.create({
      projectId: p.id, sectionId: sec.id, title,
      dueDate: dueOffset === null ? null : iso(dueOffset),
    });
    const t1 = await mk('Kechikkan ish', -3);
    const t2 = await mk('Bugungi ish', 0);
    const t3 = await mk('Ertangi ish', 1);
    const t4 = await mk('Besh kundan keyin', 5);
    const t5 = await mk('Muddatsiz ish', null);
    await reload();

    const badgeOf = (id) => {
      const row = q(`.task[data-id="${id}"]`);
      const b = row && row.querySelector('.badge');
      return b ? { text: b.textContent.trim(), cls: b.className } : null;
    };
    check('kechikkan → alarm', badgeOf(t1.id)?.cls.includes('alarm') && /kechikdi/.test(badgeOf(t1.id).text), badgeOf(t1.id));
    check('bugun → alarm+pulse', badgeOf(t2.id)?.cls.includes('alarm') && badgeOf(t2.id).cls.includes('pulse'), badgeOf(t2.id));
    check('ertaga → warn', badgeOf(t3.id)?.cls.includes('warn') && /Ertaga/.test(badgeOf(t3.id).text), badgeOf(t3.id));
    check('5 kun → gray', badgeOf(t4.id)?.cls.includes('gray'), badgeOf(t4.id));
    check('muddatsiz → belgisiz', badgeOf(t5.id) === null, badgeOf(t5.id));

    /* --- yon paneldagi hisoblagichlar --- */
    const navCount = (label) => {
      const el = qa('#views .nav-item').find((n) => n.querySelector('.label').textContent.includes(label));
      const c = el && el.querySelector('.count');
      return c ? Number(c.textContent) : 0;
    };
    check('“Bugun” hisoblagichi ≥ 2', navCount('Bugun') >= 2, navCount('Bugun'));
    check('“Muddati o‘tgan” ≥ 1', navCount('Muddati o‘tgan') >= 1, navCount('Muddati o‘tgan'));

    /* --- bajarildi deb belgilash --- */
    await window.api.task.update({ id: t1.id, done: true });
    await reload();
    check('bajarilgan ochiq ro‘yxatdan chiqdi', !q(`.section-body .task[data-id="${t1.id}"]`));
    check('“Bajarilgan” bloki paydo bo‘ldi', /Bajarilgan \(1\)/.test(q('.project-block:last-child')?.textContent || document.body.textContent));

    /* --- ko'chirish --- */
    const umumiy = state.sections.find((s) => s.project_id === p.id && s.name === 'Umumiy');
    await window.api.task.move({ id: t5.id, sectionId: umumiy.id, beforeId: null });
    await reload();
    check('boshqa mavzuga ko‘chdi', state.tasks.find((t) => t.id === t5.id).section_id === umumiy.id);

    /* --- qidiruv --- */
    ui.search = 'Ertangi';
    render();
    check('qidiruv topdi', qa('.task').length === 1 && /Ertangi/.test(q('.task').textContent));
    check('qidiruvda ajratildi', !!q('.task mark'));
    ui.search = '';
    render();

    /* --- o'chirish --- */
    await window.api.task.remove(t4.id);
    await reload();
    check('vazifa o‘chdi', !state.tasks.find((t) => t.id === t4.id));

    /* --- mavzuni o'chirish: vazifalar yo'qolmasligi kerak --- */
    const before = state.tasks.filter((t) => t.project_id === p.id).length;
    await window.api.section.remove(sec.id);
    await reload();
    const after = state.tasks.filter((t) => t.project_id === p.id).length;
    check('mavzu o‘chdi, vazifalar saqlandi', after === before, `${before} → ${after}`);

    /* --- bajarilganlarni tozalash --- */
    await window.api.task.clearDone(p.id);
    await reload();
    check('bajarilganlar tozalandi', state.tasks.filter((t) => t.project_id === p.id && t.done).length === 0);

    /* --- sozlama: ogohlantirish chegarasi --- */
    await window.api.settings.set('remindDays', 5);
    state = await window.api.getState();
    render();
    check('chegara 5 kun → t3 “warn”', badgeOf(t3.id)?.cls.includes('warn'), badgeOf(t3.id));
    await window.api.settings.set('remindDays', 2);

    /* --- zaxira eksport ma'lumoti --- */
    check('sozlama saqlandi', (await window.api.settings.get()).remindDays === 2);

    /* --- yozilayotgan matn qayta chizishda yo'qolmasligi kerak --- */
    const liveSec = state.sections.find((s) => s.project_id === p.id);
    const inp = q(`input[data-fk="add-${liveSec.id}"]`);
    inp.focus();
    inp.value = 'yarim yozilgan vazifa';
    inp.setSelectionRange(5, 5);
    render(); // eslatma tekshiruvi yoki sana almashuvi shunday qayta chizadi
    const inp2 = q(`input[data-fk="add-${liveSec.id}"]`);
    check('qo‘shish maydoni tozalanmadi', inp2.value === 'yarim yozilgan vazifa', inp2.value);
    check('kursor o‘rni saqlandi', inp2.selectionStart === 5, inp2.selectionStart);
    check('fokus saqlandi', document.activeElement === inp2, document.activeElement.className);
    inp2.value = '';
    inp2.blur();

    const liveTask = state.tasks.find((t) => t.project_id === p.id && !t.done);
    ui.editingTask = liveTask.id;
    render();
    const ti = q(`input[data-fk="title-${liveTask.id}"]`);
    ti.focus();
    ti.value = 'sarlavha o‘zgartirilmoqda';
    render();
    check('sarlavha tahriri saqlandi',
      q(`input[data-fk="title-${liveTask.id}"]`).value === 'sarlavha o‘zgartirilmoqda');
    ui.editingTask = null;
    render();
    check('sarlavha bekorga saqlanmadi', state.tasks.find((t) => t.id === liveTask.id).title === liveTask.title);

    ui.openTask = liveTask.id;
    render();
    const ta = q(`textarea[data-fk="note-${liveTask.id}"]`);
    ta.focus();
    ta.value = 'yozilayotgan izoh';
    render();
    check('izoh matni saqlandi', q(`textarea[data-fk="note-${liveTask.id}"]`).value === 'yozilayotgan izoh');
    ui.openTask = null;
    render();

    /* --- loyihani o'chirish --- */
    await window.api.project.remove(p.id);
    await reload();
    check('loyiha o‘chdi', qa('#projects .nav-item').length === 1);
    check('loyiha vazifalari ham o‘chdi', state.tasks.filter((t) => t.project_id === p.id).length === 0);
  } catch (err) {
    out.push({ name: 'ISTISNO', ok: false, extra: err.message + '\n' + err.stack });
  }

  return out;
})()
