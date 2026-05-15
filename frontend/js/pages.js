const PageHelpers = (() => {
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleString('ru', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function fmtTimeRange(event) {
    const start = new Date(event.start_time);
    const end = event.end_time ? new Date(event.end_time) : null;
    const startText = start.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    const endText = end ? end.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '';
    return endText ? `${startText}-${endText}` : startText;
  }

  function currentMonthParams() {
    const now = new Date();
    const from = now;
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }

  function typeLabel(type) {
    return ({ lecture: 'Пара', deadline: 'Дедлайн', quiz: 'Quiz', exam: 'Экзамен' })[type] || 'Событие';
  }

  function eventRow(event) {
    const tone = event.type === 'deadline' ? 'var(--red)' : event.type === 'exam' ? 'var(--yellow)' : event.type === 'quiz' ? 'var(--green)' : 'var(--blue)';
    const title = event.discipline || event.title || event.summary;
    const place = event.room || event.location;
    return `<div class="dl-item">
      <div class="dl-dot" style="background:${tone}"></div>
      <div class="dl-info">
        <div class="dl-name">${escHtml(title)}</div>
        <div class="dl-sub">${typeLabel(event.type)}${place ? ' · ' + escHtml(place) : ''}</div>
      </div>
      <div class="dl-date">${fmtDate(event.start_time)}</div>
    </div>`;
  }

  function scheduleRow(event) {
    const title = event.discipline || event.title || event.summary || 'Без названия';
    const room = event.room || event.location || 'Кабинет не указан';
    const kind = event.summary && event.summary !== title ? event.summary : typeLabel(event.type);
    return `<div class="sch-item">
      <div class="sch-line" style="background:var(--blue)"></div>
      <div class="sch-time">${fmtTimeRange(event)}</div>
      <div class="sch-main">
        <div class="sch-name">${escHtml(title)}</div>
        <div class="sch-room">${escHtml(room)} · ${escHtml(kind)}</div>
      </div>
    </div>`;
  }

  function emptyCalendar(message) {
    return `<div class="dash-card full empty-state">
      <div class="dash-card-title">Календарь не подключен</div>
      <p>${message}</p>
    </div>`;
  }

  return { escHtml, fmtDate, fmtTimeRange, currentMonthParams, typeLabel, eventRow, scheduleRow, emptyCalendar };
})();

const DashUI = (() => {
  async function init() {
    const body = document.getElementById('dash-body');
    body.innerHTML = '<div class="dash-card full"><div class="dash-card-title">Загрузка дедлайнов...</div></div>';

    try {
      const { events } = await API.getEvents(PageHelpers.currentMonthParams());
      const now = new Date();
      const deadlines = events
        .filter((event) => ['deadline', 'quiz', 'exam'].includes(event.type))
        .filter((event) => new Date(event.start_time) >= now)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

      const urgent = deadlines.filter((event) => {
        const diff = new Date(event.start_time) - now;
        return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
      });

      body.innerHTML = `
        <div class="dash-card full deadline-hero">
          <div>
            <div class="dash-card-title">Дедлайны</div>
            <p>Задания, квизы и экзамены за текущий месяц из твоего Moodle Calendar.</p>
          </div>
          <div class="deadline-count">${deadlines.length}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-hdr">
            <div class="dash-card-title">Горящие</div>
            <span class="tag tag-red">${urgent.length}</span>
          </div>
          ${urgent.length ? urgent.slice(0, 6).map(PageHelpers.eventRow).join('') : '<p class="muted-line">На ближайшие 24 часа ничего не горит.</p>'}
        </div>
        <div class="dash-card">
          <div class="dash-card-hdr">
            <div class="dash-card-title">Следующие</div>
            <span class="tag tag-green">${Math.max(deadlines.length - urgent.length, 0)}</span>
          </div>
          ${deadlines.filter((event) => !urgent.includes(event)).slice(0, 8).map(PageHelpers.eventRow).join('') || '<p class="muted-line">Дедлайнов пока нет.</p>'}
        </div>
        <div class="dash-card full">
          <div class="dash-card-hdr"><div class="dash-card-title">Все дедлайны месяца</div></div>
          ${deadlines.length ? deadlines.map(PageHelpers.eventRow).join('') : '<p class="muted-line">Подключи Moodle Calendar URL в настройках.</p>'}
        </div>`;
    } catch (err) {
      body.innerHTML = PageHelpers.emptyCalendar('Открой настройки и вставь индивидуальный Moodle Calendar URL. После синхронизации здесь появятся дедлайны.');
    }
  }

  return { init };
})();

const ScheduleUI = (() => {
  let selectedDay = 'all';
  let scheduleItems = [];
  let scheduleError = '';
  let scheduleSource = '';
  let scheduleAttempts = [];
  const weekdays = [
    { id: 'all', label: 'Все' },
    { id: '1', label: 'Пн' },
    { id: '2', label: 'Вт' },
    { id: '3', label: 'Ср' },
    { id: '4', label: 'Чт' },
    { id: '5', label: 'Пт' },
    { id: '6', label: 'Сб' },
    { id: '0', label: 'Вс' }
  ];

  async function init() {
    const body = document.getElementById('schedule-body');
    let group = Auth.getUser()?.group || '';
    body.innerHTML = renderShell(group, '<p class="muted-line">Загружаю расписание из DU...</p>');

    try {
      const { user } = await API.me();
      Auth.setUser(user);
      group = user.group || '';
      body.innerHTML = renderShell(group, '<p class="muted-line">Загружаю расписание из DU...</p>');
    } catch {
      // Если профиль не обновился, продолжаем с локальным пользователем.
    }

    if (!group) {
      scheduleItems = [];
      scheduleError = 'В профиле не указана группа.';
      render();
      return;
    }

    await loadDuSchedule(false);
  }

  function renderShell(group, content) {
    return `
      <div class="dash-card full deadline-hero">
        <div>
          <div class="dash-card-title">Расписание группы</div>
          <p>Источник: DU schedule/groupName/${PageHelpers.escHtml(group || 'GROUP')}</p>
        </div>
        <div class="deadline-count">${scheduleItems.length}</div>
      </div>
      <div class="dash-card full">
        <div class="attendance-grid schedule-auth-grid">
          <label class="calc-field">Группа из профиля
            <input value="${PageHelpers.escHtml(group || 'Не указана')}" disabled />
          </label>
          <label class="calc-field">Действие
            <button class="btn-save" onclick="ScheduleUI.loadDuSchedule(true)">Загрузить из DU</button>
          </label>
        </div>
      </div>
      <div id="schedule-content">${content}</div>`;
  }

  async function loadDuSchedule(fromButton = false) {
    const group = (Auth.getUser()?.group || '').trim();
    const body = document.getElementById('schedule-body');

    if (!group) {
      scheduleError = 'Укажи группу в профиле, чтобы загрузить расписание.';
      scheduleItems = [];
      render();
      return;
    }

    if (fromButton) {
      document.getElementById('schedule-content').innerHTML = '<div class="dash-card full"><p class="muted-line">Загружаю расписание из DU...</p></div>';
    }

    try {
      const { schedule, group: loadedGroup, source, attempts = [] } = await API.getDuMySchedule();
      scheduleItems = normalizeSchedule(schedule);
      scheduleSource = source?.url || '';
      scheduleAttempts = attempts;
      scheduleError = scheduleItems.length ? '' : emptyScheduleMessage();
      body.innerHTML = renderShell(loadedGroup || group, '');
      render();
    } catch (err) {
      scheduleItems = [];
      scheduleSource = '';
      scheduleAttempts = err.attempts || [];
      scheduleError = err.message;
      body.innerHTML = renderShell(group, '');
      render();
    }
  }

  function render() {
    const content = document.getElementById('schedule-content');
    if (!content) return;

    const events = scheduleItems;
    const filtered = selectedDay === 'all'
      ? events
      : events.filter((event) => String(event.weekday) === selectedDay);
    const grouped = weekdays
      .filter((day) => day.id !== 'all')
      .map((day) => ({
        ...day,
        events: events.filter((event) => String(event.weekday) === day.id)
      }))
      .filter((day) => selectedDay === 'all' || day.id === selectedDay);

    content.innerHTML = `
      <div class="dash-card full schedule-tools">
        ${weekdays.map((day) => `<button class="seg-btn ${day.id === selectedDay ? 'active' : ''}" onclick="ScheduleUI.pickDay('${day.id}')">${day.label}</button>`).join('')}
      </div>
      <div class="dash-card full">
        <div class="dash-card-hdr">
          <div class="dash-card-title">Недельное расписание</div>
          <span class="tag tag-blue">${filtered.length}</span>
        </div>
        ${scheduleSource ? `<p class="muted-line">Источник: ${PageHelpers.escHtml(shortUrl(scheduleSource))}</p>` : ''}
        ${scheduleError ? `<p class="muted-line">${PageHelpers.escHtml(scheduleError)}</p>` : grouped.length ? grouped.map(dayHtml).join('') : '<p class="muted-line">На выбранный день пар нет.</p>'}
      </div>`;
  }

  function emptyScheduleMessage() {
    const tried = scheduleAttempts.length ? ` Проверено вариантов: ${scheduleAttempts.length}.` : '';
    const last = scheduleAttempts.slice(-1)[0];
    const tail = last?.status && last.status !== 200 ? ` Последний статус DU: ${last.status}.` : '';
    return `DU ответил, но пары для группы из профиля не нашлись.${tried}${tail}`;
  }

  function shortUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.pathname + parsed.search;
    } catch {
      return url;
    }
  }

  function dayHtml(day) {
    return `<div class="weekday-block">
      <div class="weekday-title">${day.label}</div>
      ${day.events.length ? day.events.map(duScheduleRow).join('') : '<p class="muted-line">Пар нет.</p>'}
    </div>`;
  }

  async function pickDay(day) {
    selectedDay = day;
    render();
  }

  function normalizeSchedule(payload) {
    const list = collectScheduleItems(payload);

    return list.map((item) => {
      const weekday = normalizeWeekday(
        item.__weekday ||
        field(item, ['dayOfWeek', 'weekDay', 'day', 'week_day', 'weekday', 'date', 'lessonDate', 'studyDate'])
      );
      return {
        raw: item,
        weekday,
        title: field(item, ['disciplineName', 'discipline', 'subject', 'subjectName', 'courseName', 'courseUnitName', 'lessonName', 'title', 'name', 'moduleName', 'className']) || 'Пара',
        type: field(item, ['type', 'lessonType', 'lesson_type', 'classType', 'lessonFormat', 'lessonKind']) || '',
        start: field(item, ['startTime', 'start_time', 'start', 'begin', 'beginTime', 'timeStart', 'startLessonTime', 'lessonStartTime', 'from']) || '',
        end: field(item, ['endTime', 'end_time', 'end', 'finish', 'finishTime', 'timeEnd', 'endLessonTime', 'lessonEndTime', 'to']) || '',
        room: field(item, ['room', 'classroom', 'cabinet', 'auditorium', 'auditory', 'auditoryName', 'location', 'classRoom']) || '',
        teacher: field(item, ['teacher', 'teacherName', 'teacherFullName', 'tutor', 'tutorName', 'lecturer', 'lecturerName', 'instructor']) || '',
        group: field(item, ['groupName', 'group', 'groups', 'studentGroup', 'studentGroupName']) || ''
      };
    }).filter((item) => item.title || item.start || item.room);
  }

  function collectScheduleItems(value, inherited = {}, acc = []) {
    if (Array.isArray(value)) {
      value.forEach((item) => collectScheduleItems(item, inherited, acc));
      return acc;
    }

    if (!value || typeof value !== 'object') return acc;

    const inheritedWeekday = field(value, ['dayOfWeek', 'weekDay', 'day', 'week_day', 'weekday', 'date', 'lessonDate', 'studyDate']);
    const nextInherited = inheritedWeekday ? { ...inherited, __weekday: inheritedWeekday } : inherited;

    if (looksLikeScheduleItem(value)) {
      acc.push({ ...nextInherited, ...value });
      return acc;
    }

    Object.values(value).forEach((item) => collectScheduleItems(item, nextInherited, acc));
    return acc;
  }

  function looksLikeScheduleItem(item) {
    return Boolean(
      field(item, ['disciplineName', 'discipline', 'subject', 'subjectName', 'courseName', 'courseUnitName', 'lessonName', 'title', 'moduleName', 'className']) ||
      field(item, ['startTime', 'start_time', 'start', 'begin', 'beginTime', 'timeStart', 'startLessonTime', 'lessonStartTime', 'from']) ||
      field(item, ['room', 'classroom', 'cabinet', 'auditorium', 'auditory', 'auditoryName', 'location', 'classRoom']) ||
      field(item, ['teacherName', 'teacherFullName', 'tutorName', 'lecturer', 'lecturerName', 'instructor'])
    );
  }

  function field(item, keys) {
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && value !== '') return valueToText(value);
    }
    return '';
  }

  function valueToText(value) {
    if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(', ');
    if (value && typeof value === 'object') {
      const fullName = [value.lastName || value.surname, value.firstName, value.middleName].filter(Boolean).join(' ');
      return value.titleRu || value.titleEn || value.titleKz || value.name || value.fullName || fullName || value.value || value.label || '';
    }
    return String(value);
  }

  function normalizeWeekday(value) {
    if (value === undefined || value === null || value === '') return '1';
    const text = String(value).toLowerCase();
    if (/^\d+$/.test(text)) return String(Number(text) % 7);
    if (text.includes('mon') || text.includes('пон') || text.includes('пн')) return '1';
    if (text.includes('tue') || text.includes('вто') || text.includes('вт')) return '2';
    if (text.includes('wed') || text.includes('сре') || text.includes('ср')) return '3';
    if (text.includes('thu') || text.includes('чет') || text.includes('чт')) return '4';
    if (text.includes('fri') || text.includes('пят') || text.includes('пт')) return '5';
    if (text.includes('sat') || text.includes('суб') || text.includes('сб')) return '6';
    if (text.includes('sun') || text.includes('вос') || text.includes('вс')) return '0';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '1' : String(date.getDay());
  }

  function duScheduleRow(item) {
    const meta = [item.room, item.teacher, item.group, item.type].filter(Boolean).join(' · ');
    const time = [item.start, item.end].filter(Boolean).join('-') || '—';
    return `<div class="sch-item">
      <div class="sch-line" style="background:var(--blue)"></div>
      <div class="sch-time">${PageHelpers.escHtml(time)}</div>
      <div class="sch-main">
        <div class="sch-name">${PageHelpers.escHtml(item.title)}</div>
        <div class="sch-room">${PageHelpers.escHtml(meta || 'Детали не указаны')}</div>
      </div>
    </div>`;
  }

  return { init, pickDay, loadDuSchedule };
})();

const AttendanceUI = (() => {
  function init() {
    render();
  }

  function render() {
    const body = document.getElementById('attendance-body');
    body.innerHTML = `
      <div class="dash-card full">
        <div class="dash-card-hdr"><div class="dash-card-title">Attendance Calculator</div></div>
        <div class="attendance-grid">
          <label class="calc-field">Всего занятий
            <input id="att-total" type="number" min="1" placeholder="Например, 30" oninput="AttendanceUI.calculate()" />
          </label>
          <label class="calc-field">Посещено
            <input id="att-present" type="number" min="0" placeholder="Например, 24" oninput="AttendanceUI.calculate()" />
          </label>
          <label class="calc-field">Минимальный процент
            <input id="att-required" type="number" min="1" max="100" value="70" oninput="AttendanceUI.calculate()" />
          </label>
        </div>
        <div class="attendance-result" id="attendance-result">
          <div class="result-num">0%</div>
          <div class="result-text">Заполни поля, чтобы посчитать текущую посещаемость.</div>
        </div>
      </div>`;
  }

  function calculate() {
    const total = Number(document.getElementById('att-total')?.value || 0);
    const present = Number(document.getElementById('att-present')?.value || 0);
    const required = Number(document.getElementById('att-required')?.value || 70);
    const result = document.getElementById('attendance-result');
    if (!result || total <= 0) return;

    const percent = Math.max(0, Math.min(100, Math.round((present / total) * 100)));
    const maxAbsences = Math.max(0, Math.floor(total * (1 - required / 100)));
    const currentAbsences = Math.max(0, total - present);
    const remaining = maxAbsences - currentAbsences;
    const ok = percent >= required;

    result.innerHTML = `
      <div class="result-num" style="color:${ok ? 'var(--green)' : 'var(--red)'}">${percent}%</div>
      <div class="result-text">${ok ? `Можно пропустить еще ${Math.max(remaining, 0)} зан.` : `Нужно восстановить минимум ${Math.abs(remaining)} зан.`}</div>`;
  }

  return { init, calculate };
})();

const TeachersUI = (() => {
  let rows = [];
  let loading = false;
  let loadError = '';

  async function init() {
    if (!rows.length && !loading) await loadTeachers();
    render();
  }

  function render() {
    const body = document.getElementById('teachers-body');
    body.innerHTML = `
      <div class="dash-card full deadline-hero">
        <div>
          <div class="dash-card-title">Поиск преподавателей</div>
          <p>Список подтягивается из публичного DU</p>
        </div>
        <div class="deadline-count">${loading ? '...' : rows.length}</div>
      </div>
      <div class="dash-card full">
        <label class="settings-field">Поиск
          <input id="teacher-query" placeholder="Имя, кафедра, email" oninput="TeachersUI.search()" />
        </label>
        <div class="import-actions teacher-actions">
          <button class="btn-save" onclick="TeachersUI.refresh()">Обновить из DU</button>
        </div>
      </div>
      <div class="dash-card full teacher-results" id="teacher-results">${loading ? '<p class="muted-line">Загружаю преподавателей...</p>' : loadError ? `<p class="muted-line">${PageHelpers.escHtml(loadError)}</p>` : resultsHtml(rows)}</div>`;
  }

  function resultsHtml(list) {
    return list.length ? list.map((teacher) => `<div class="teacher-card">
      <div class="teacher-name">${PageHelpers.escHtml(teacher.name)}</div>
      <div class="teacher-meta">${PageHelpers.escHtml(teacher.position || teacher.department || 'Должность не указана')}</div>
      <div class="teacher-mail">${PageHelpers.escHtml(teacher.email || teacher.department || 'Контакты не указаны')}</div>
      ${teacher.id ? `<button class="teacher-more" onclick="TeachersUI.openDetail('${teacher.id}')">Подробнее</button>` : ''}
    </div>`).join('') : '<p class="muted-line">Список пуст или DU API не вернул данные.</p>';
  }

  async function loadTeachers() {
    loading = true;
    render();
    try {
      const { teachers } = await API.getTeachers('?all=1');
      rows = normalizeList(teachers);
      loadError = '';
    } catch (err) {
      rows = [];
      loadError = 'Ошибка загрузки: ' + err.message;
    } finally {
      loading = false;
      render();
    }
  }

  function search() {
    const query = (document.getElementById('teacher-query')?.value || '').toLowerCase().trim();
    const filtered = query ? rows.filter((teacher) => [teacher.name, teacher.department, teacher.position, teacher.email].join(' ').toLowerCase().includes(query)) : rows;
    document.getElementById('teacher-results').innerHTML = resultsHtml(filtered);
  }

  async function refresh() {
    rows = [];
    loadError = '';
    await loadTeachers();
  }

  async function openDetail(id) {
    const base = rows.find((teacher) => String(teacher.id) === String(id));
    showDetail(base, null, true);

    try {
      const params = base?.userId ? `?userId=${encodeURIComponent(base.userId)}` : '';
      const { teacher, publicInfo } = await API.getTeacher(id, params);
      const merged = mergeTeacher(base, publicInfo);
      showDetail(merged, teacher, false);
    } catch (err) {
      showDetail(base, { error: err.message }, false);
    }
  }

  function showDetail(base, detail, isLoading) {
    closeDetail();

    const modal = document.createElement('div');
    modal.className = 'teacher-modal';
    modal.id = 'teacher-modal';
    modal.innerHTML = `
      <div class="teacher-modal-backdrop" onclick="TeachersUI.closeDetail()"></div>
      <section class="teacher-modal-panel">
        <div class="teacher-modal-head">
          <div>
            <div class="teacher-modal-name">${PageHelpers.escHtml(base?.name || 'Преподаватель')}</div>
            <div class="teacher-modal-sub">${PageHelpers.escHtml(base?.department || 'Школа не указана')}</div>
          </div>
          <button class="teacher-modal-close" onclick="TeachersUI.closeDetail()">×</button>
        </div>
        <div class="teacher-modal-body">
          ${baseInfoHtml(base)}
          ${publicInfoHtml(base)}
          ${isLoading ? '<div class="teacher-detail-card"><p class="muted-line">Загружаю подробную информацию...</p></div>' : detailHtml(detail)}
        </div>
      </section>`;
    document.body.appendChild(modal);
  }

  function closeDetail() {
    document.getElementById('teacher-modal')?.remove();
  }

  function baseInfoHtml(teacher) {
    return `<div class="teacher-detail-card">
      <div class="teacher-detail-title">Основное</div>
      <div class="teacher-kv"><span>ФИО</span><b>${PageHelpers.escHtml(teacher?.name || '—')}</b></div>
      <div class="teacher-kv"><span>Школа</span><b>${PageHelpers.escHtml(teacher?.department || '—')}</b></div>
      <div class="teacher-kv"><span>Должность</span><b>${PageHelpers.escHtml(teacher?.position || '—')}</b></div>
      <div class="teacher-kv"><span>Степень</span><b>${PageHelpers.escHtml(valueToText(teacher?.scientificDegree || teacher?.academicDegree) || '—')}</b></div>
      <div class="teacher-kv"><span>Статус</span><b>${PageHelpers.escHtml(valueToText(teacher?.academicStatus) || '—')}</b></div>
      <div class="teacher-kv"><span>Email</span><b>${PageHelpers.escHtml(teacher?.email || '—')}</b></div>
      <div class="teacher-kv"><span>Гражданство</span><b>${PageHelpers.escHtml(teacher?.citizenship || '—')}</b></div>
      <div class="teacher-kv"><span>Национальность</span><b>${PageHelpers.escHtml(teacher?.nationality || '—')}</b></div>
      <div class="teacher-kv"><span>DU teacher id</span><b>${PageHelpers.escHtml(teacher?.id || '—')}</b></div>
      <div class="teacher-kv"><span>DU user id</span><b>${PageHelpers.escHtml(teacher?.userId || '—')}</b></div>
    </div>`;
  }

  function publicInfoHtml(teacher) {
    const blocks = [];
    if (teacher?.scientificInterests?.length) {
      blocks.push(listSectionHtml('Научные интересы', teacher.scientificInterests));
    }
    if (teacher?.taughtCourses?.length) {
      blocks.push(listSectionHtml('Преподаваемые курсы', teacher.taughtCourses));
    }
    return blocks.join('');
  }

  function listSectionHtml(title, items) {
    return `<div class="teacher-detail-card">
      <div class="teacher-detail-title">${PageHelpers.escHtml(title)}</div>
      <div class="teacher-chip-list">
        ${items.map((item) => `<span>${PageHelpers.escHtml(valueToText(item))}</span>`).join('')}
      </div>
    </div>`;
  }

  function detailHtml(detail) {
    if (detail?.error) {
      return `<div class="teacher-detail-card"><p class="muted-line">Подробности DU не загрузились: ${PageHelpers.escHtml(detail.error)}</p></div>`;
    }

    const sections = [
      ['Образование', detail?.educationalInformationDtoResponse],
      ['Сертификаты', detail?.certificateResponseDto],
      ['Научные проекты', detail?.scientificProjectDto],
      ['Публикации', detail?.articleDto],
      ['Scholar information', detail?.scholarInformationDtoResponse],
      ['Опыт работы', detail?.teacherWorkExperienceDto],
      ['Разработки', detail?.teacherDevelopmentDto],
      ['Степени', detail?.teacherDegreeDtoResponse],
      ['Документы', detail?.teacherLegalDocumentDtoResponses]
    ];

    const html = sections.map(([title, value]) => arraySectionHtml(title, value)).filter(Boolean).join('');
    return html || '<div class="teacher-detail-card"><p class="muted-line">DU пока не отдаёт расширенную информацию по этому преподавателю.</p></div>';
  }

  function arraySectionHtml(title, value) {
    if (!Array.isArray(value) || !value.length) return '';
    return `<div class="teacher-detail-card">
      <div class="teacher-detail-title">${PageHelpers.escHtml(title)}</div>
      ${value.map(objectHtml).join('')}
    </div>`;
  }

  function objectHtml(item) {
    if (!item || typeof item !== 'object') return `<p class="muted-line">${PageHelpers.escHtml(item)}</p>`;
    const pairs = Object.entries(item)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `<div class="teacher-kv"><span>${PageHelpers.escHtml(labelize(key))}</span><b>${PageHelpers.escHtml(valueToText(value))}</b></div>`)
      .join('');
    return pairs || '<p class="muted-line">Пустой блок.</p>';
  }

  function valueToText(value) {
    if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(', ');
    if (value && typeof value === 'object') {
      const fullName = [value.lastName || value.surname, value.firstName, value.middleName].filter(Boolean).join(' ');
      const direct = [
        value.titleRu,
        value.titleEn,
        value.titleKz,
        value.title,
        value.nameRu,
        value.nameEn,
        value.nameKz,
        value.name,
        value.fullName,
        fullName,
        value.shortName,
        value.degreeName,
        value.academicDegreeName,
        value.scientificDegreeName,
        value.statusName,
        value.academicStatusName,
        value.value,
        value.label
      ].find((item) => item !== undefined && item !== null && item !== '');

      if (direct) return String(direct);

      const fallback = Object.entries(value)
        .filter(([key, item]) => item !== null && item !== undefined && item !== '' && typeof item !== 'object' && !/id$/i.test(key))
        .map(([, item]) => String(item))
        .find(Boolean);

      return fallback || '';
    }
    return value === undefined || value === null ? '' : String(value);
  }

  function mergeTeacher(base, publicInfo) {
    if (!publicInfo || typeof publicInfo !== 'object') return base;
    const normalized = normalizeTeacher(publicInfo);
    return {
      ...base,
      ...normalized,
      id: base?.id || normalized.id,
      userId: base?.userId || normalized.userId,
      name: normalized.name && normalized.name !== 'Преподаватель' ? normalized.name : base?.name,
      department: normalized.department || base?.department,
      position: normalized.position || base?.position,
      email: normalized.email || base?.email,
      scientificDegree: normalized.scientificDegree || base?.scientificDegree,
      academicDegree: normalized.academicDegree || base?.academicDegree,
      academicStatus: normalized.academicStatus || base?.academicStatus,
      citizenship: normalized.citizenship || base?.citizenship,
      nationality: normalized.nationality || base?.nationality,
      scientificInterests: normalized.scientificInterests?.length ? normalized.scientificInterests : base?.scientificInterests,
      taughtCourses: normalized.taughtCourses?.length ? normalized.taughtCourses : base?.taughtCourses,
      raw: { ...(base?.raw || {}), ...publicInfo }
    };
  }

  function labelize(key) {
    return String(key).replace(/Dto|Response|Request/g, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function normalizeList(payload) {
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.content)
        ? payload.content
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.teachers)
          ? payload.teachers
          : Array.isArray(payload?.list)
            ? payload.list
            : [];

    return list.map(normalizeTeacher).filter((teacher) => teacher.name);
  }

  function normalizeTeacher(item) {
    const firstName = item.firstName || item.firstname || item.name || item.nameKz || item.nameRu || item.nameEn || '';
    const lastName = item.lastName || item.lastname || item.surname || item.surnameKz || item.surnameRu || item.surnameEn || '';
    const middleName = item.middleName || item.middlename || item.patronymic || item.patronymicKz || item.patronymicRu || item.patronymicEn || '';
    const fullName = item.fullName || item.full_name || item.fio || item.teacherName || [lastName, firstName, middleName].filter(Boolean).join(' ');
    const department = typeof item.department === 'string'
      ? item.department
      : item.department?.titleRu || item.department?.titleEn || item.department?.titleKz || '';
    const position = typeof item.position === 'string'
      ? item.position
      : item.position?.titleRu || item.position?.titleEn || item.position?.titleKz || item.positionName || '';
    const scientificDegree = valueToText(item.scientificDegree || item.scientificDegreeDto || item.academicDegree || item.academicDegreeDto || '');
    const academicStatus = valueToText(item.academicStatus || item.academicStatusDto || item.status || '');
    const citizenship = valueToText(item.citizenship || '');
    const nationality = valueToText(item.nationality || '');

    return {
      id: item.id || item.teacherId || item.teacher_id || item.userId || item.user_id || '',
      userId: item.userId || item.user_id || '',
      name: fullName || item.email || 'Преподаватель',
      email: item.email || item.mail || item.corporateEmail || item.corporate_email || item.login || '',
      department: department || item.departmentName || item.academicDepartment || item.academicDepartmentName || '',
      position: position || item.teacherPosition || item.teacherPositionName || '',
      scientificDegree,
      academicDegree: valueToText(item.academicDegree || ''),
      academicStatus,
      citizenship,
      nationality,
      scientificInterests: Array.isArray(item.scientificInterests) ? item.scientificInterests : [],
      taughtCourses: Array.isArray(item.taughtCourses) ? item.taughtCourses : [],
      raw: item
    };
  }

  return { init, search, refresh, openDetail, closeDetail };
})();

const SyllabusUI = (() => {
  let rows = [];
  let loading = false;
  let loadError = '';

  async function init() {
    if (!rows.length && !loading) await loadSyllabuses();
    render();
  }

  function render() {
    const body = document.getElementById('syllabus-body');
    body.innerHTML = `
      <div class="dash-card full deadline-hero">
        <div>
          <div class="dash-card-title">Силлабусы</div>
          <p>Источник: DU. Для приватных данных нужен сохраненный DU token.</p>
        </div>
        <div class="deadline-count">${loading ? '...' : rows.length}</div>
      </div>
      <div class="dash-card full">
        <label class="settings-field">Поиск
          <input id="syllabus-query" placeholder="Дисциплина, код, школа, преподаватель" oninput="SyllabusUI.search()" />
        </label>
        <div class="import-actions teacher-actions">
          <button class="btn-save" onclick="SyllabusUI.refresh()">Обновить из DU</button>
        </div>
      </div>
      <div class="dash-card full teacher-results" id="syllabus-results">${loading ? '<p class="muted-line">Загружаю силлабусы...</p>' : loadError ? `<p class="muted-line">${PageHelpers.escHtml(loadError)}</p>` : resultsHtml(rows)}</div>`;
  }

  async function loadSyllabuses() {
    loading = true;
    render();
    try {
      const { syllabuses } = await API.getSyllabuses();
      rows = normalizeList(syllabuses);
      loadError = '';
    } catch (err) {
      rows = [];
      loadError = 'Ошибка загрузки: ' + err.message;
    } finally {
      loading = false;
      render();
    }
  }

  function refresh() {
    rows = [];
    loadError = '';
    return loadSyllabuses();
  }

  function search() {
    const query = (document.getElementById('syllabus-query')?.value || '').toLowerCase().trim();
    const filtered = query
      ? rows.filter((row) => [row.title, row.code, row.department, row.teacher, row.meta].join(' ').toLowerCase().includes(query))
      : rows;
    document.getElementById('syllabus-results').innerHTML = resultsHtml(filtered);
  }

  function resultsHtml(list) {
    return list.length ? list.map((item) => `<div class="teacher-card">
      <div class="teacher-name">${PageHelpers.escHtml(item.title)}</div>
      <div class="teacher-meta">${PageHelpers.escHtml(item.meta || item.department || 'Детали не указаны')}</div>
      <div class="teacher-mail">${PageHelpers.escHtml([item.code, item.teacher].filter(Boolean).join(' · ') || 'Код не указан')}</div>
      ${item.id ? `<button class="teacher-more" onclick="SyllabusUI.openDetail('${jsString(item.id)}')">Открыть</button>` : ''}
    </div>`).join('') : '<p class="muted-line">Силлабусы не найдены или DU не вернул данные.</p>';
  }

  async function openDetail(id) {
    const base = rows.find((item) => String(item.id) === String(id));
    showDetail(base, null, true);

    try {
      const { syllabus } = await API.getSyllabus(id);
      showDetail(base, syllabus, false);
    } catch (err) {
      showDetail(base, { error: err.message }, false);
    }
  }

  function showDetail(base, detail, isLoading) {
    closeDetail();

    const modal = document.createElement('div');
    modal.className = 'teacher-modal';
    modal.id = 'syllabus-modal';
    modal.innerHTML = `
      <div class="teacher-modal-backdrop" onclick="SyllabusUI.closeDetail()"></div>
      <section class="teacher-modal-panel">
        <div class="teacher-modal-head">
          <div>
            <div class="teacher-modal-name">${PageHelpers.escHtml(base?.title || 'Силлабус')}</div>
            <div class="teacher-modal-sub">${PageHelpers.escHtml(base?.meta || base?.code || 'DU syllabus')}</div>
          </div>
          <button class="teacher-modal-close" onclick="SyllabusUI.closeDetail()">×</button>
        </div>
        <div class="teacher-modal-body">
          ${baseInfoHtml(base)}
          ${isLoading ? '<div class="teacher-detail-card"><p class="muted-line">Загружаю детали силлабуса...</p></div>' : detailHtml(detail)}
        </div>
      </section>`;
    document.body.appendChild(modal);
  }

  function closeDetail() {
    document.getElementById('syllabus-modal')?.remove();
  }

  function baseInfoHtml(item) {
    if (!item) return '';
    return `<div class="teacher-detail-card">
      <div class="teacher-detail-title">Основное</div>
      <div class="teacher-kv"><span>Название</span><b>${PageHelpers.escHtml(item.title || '—')}</b></div>
      <div class="teacher-kv"><span>Код</span><b>${PageHelpers.escHtml(item.code || '—')}</b></div>
      <div class="teacher-kv"><span>Школа</span><b>${PageHelpers.escHtml(item.department || '—')}</b></div>
      <div class="teacher-kv"><span>Преподаватель</span><b>${PageHelpers.escHtml(item.teacher || '—')}</b></div>
      <div class="teacher-kv"><span>Credits</span><b>${PageHelpers.escHtml(item.credits || '—')}</b></div>
    </div>`;
  }

  function detailHtml(detail) {
    if (detail?.error) {
      return `<div class="teacher-detail-card"><p class="muted-line">Детали не загрузились: ${PageHelpers.escHtml(detail.error)}</p></div>`;
    }
    if (!detail) return '<div class="teacher-detail-card"><p class="muted-line">DU не вернул детали.</p></div>';
    return objectSectionHtml('Данные силлабуса', detail);
  }

  function objectSectionHtml(title, value) {
    if (Array.isArray(value)) {
      return value.map((item, index) => objectSectionHtml(`${title} ${index + 1}`, item)).join('');
    }
    if (!value || typeof value !== 'object') {
      return `<div class="teacher-detail-card"><div class="teacher-detail-title">${PageHelpers.escHtml(title)}</div><p class="muted-line">${PageHelpers.escHtml(valueToText(value) || 'Пусто')}</p></div>`;
    }

    const simplePairs = [];
    const nestedBlocks = [];
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined && item !== '')
      .forEach(([key, item]) => {
        if (Array.isArray(item) || (item && typeof item === 'object' && !valueToText(item))) {
          nestedBlocks.push(objectSectionHtml(labelize(key), item));
        } else {
          simplePairs.push(`<div class="teacher-kv"><span>${PageHelpers.escHtml(labelize(key))}</span><b>${PageHelpers.escHtml(valueToText(item))}</b></div>`);
        }
      });

    return `<div class="teacher-detail-card">
      <div class="teacher-detail-title">${PageHelpers.escHtml(title)}</div>
      ${simplePairs.join('') || '<p class="muted-line">Пустой блок.</p>'}
    </div>${nestedBlocks.join('')}`;
  }

  function normalizeList(payload) {
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.content)
        ? payload.content
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.list)
            ? payload.list
            : Array.isArray(payload?.syllabuses)
              ? payload.syllabuses
              : [];

    return list.map(normalizeSyllabus).filter((item) => item.title || item.id);
  }

  function normalizeSyllabus(item) {
    const title = field(item, ['disciplineName', 'courseName', 'subjectName', 'name', 'title', 'moduleName', 'syllabusName']);
    const code = field(item, ['disciplineCode', 'courseCode', 'subjectCode', 'code', 'moduleCode']);
    const department = field(item, ['department', 'departmentName', 'school', 'schoolName', 'faculty']);
    const teacher = field(item, ['teacher', 'teacherName', 'teacherFullName', 'lecturer', 'tutorName']);
    const credits = field(item, ['credits', 'credit', 'ects', 'creditCount']);
    const year = field(item, ['year', 'educationYear', 'academicYear']);
    const trim = field(item, ['trim', 'trimester', 'term', 'semester']);

    return {
      id: field(item, ['id', 'syllabusId', 'syllabus_id', 'draftId']),
      title: title || 'Силлабус',
      code,
      department,
      teacher,
      credits,
      meta: [department, year, trim ? `trim ${trim}` : '', credits ? `${credits} credits` : ''].filter(Boolean).join(' · '),
      raw: item
    };
  }

  function field(item, keys) {
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && value !== '') return valueToText(value);
    }
    return '';
  }

  function valueToText(value) {
    if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(', ');
    if (value && typeof value === 'object') {
      const fullName = [value.lastName || value.surname, value.firstName, value.middleName].filter(Boolean).join(' ');
      return value.titleRu || value.titleEn || value.titleKz || value.nameRu || value.nameEn || value.nameKz || value.name || value.title || value.fullName || fullName || value.value || value.label || '';
    }
    return value === undefined || value === null ? '' : String(value);
  }

  function jsString(value) {
    return PageHelpers.escHtml(String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  }

  function labelize(key) {
    return String(key).replace(/Dto|Response|Request/g, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  return { init, refresh, search, openDetail, closeDetail };
})();

const MapUI = (() => ({ init: () => MapPage.init() }))();

const ProfileUI = (() => {
  function init() {
    render();
  }

  function render() {
    const user = Auth.getUser();
    if (!user) return;

    const settings = {
      language: 'ru',
      notifications: true,
      classReminderMinutes: 30,
      deadlineReminderHours: 24,
      ...(user.settings || {})
    };
    const displayName = user.name || 'Student';
    const initials = displayName.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase();

    document.getElementById('profile-body').innerHTML = `
      <div class="profile-card full">
        <div class="pc-title">Pocket Moodle</div>
        <div class="profile-avatar-row">
          <div class="profile-avatar-big">${initials}</div>
          <div class="profile-avatar-info">
            <h3>${displayName}</h3>
            <p>Группа: ${user.group || 'не указана'} · ${user.email || 'Telegram user'}</p>
          </div>
        </div>
        <div class="profile-fields">
          <div class="profile-row">
            <label class="settings-field">Имя и фамилия
              <input id="pf-name" value="${PageHelpers.escHtml(displayName)}" />
            </label>
            <label class="settings-field">Группа
              <input id="pf-group" value="${PageHelpers.escHtml(user.group || '')}" />
            </label>
          </div>
        </div>
        <button class="btn-save" onclick="ProfileUI.saveProfile()">Сохранить профиль</button>
      </div>

      <div class="profile-card">
        <div class="pc-title">Moodle Calendar</div>
        <div class="profile-fields">
          <label class="settings-field">Индивидуальный Calendar URL (ICS)
            <textarea id="pf-calendar" rows="3" placeholder="https://moodle.../calendar/export_execute.php?...">${PageHelpers.escHtml(user.calendar_url || '')}</textarea>
          </label>
          <p class="settings-note">Каждый студент вставляет свою личную ссылку экспорта календаря Moodle. Пароль от Moodle не нужен.</p>
        </div>
        <button class="btn-save" onclick="ProfileUI.syncCalendar()">Сохранить и синхронизировать</button>
      </div>

      <div class="profile-card">
        <div class="pc-title">DU token</div>
        <div class="profile-fields">
          <label class="settings-field">DU email
            <input id="pf-du-login" value="${PageHelpers.escHtml(user.du_login || user.email || '')}" placeholder="you@astanait.edu.kz" autocomplete="username" />
          </label>
          <label class="settings-field">Bearer token из DU
            <textarea id="pf-du-token" rows="3" placeholder="eyJ..."></textarea>
          </label>
          <p class="settings-note">${user.du_connected ? `DU token сохранен${user.du_updated_at ? `: ${new Date(user.du_updated_at).toLocaleString('ru')}` : ''}. Если расписание перестало грузиться, вставь свежий token.` : 'DU использует Microsoft SSO, поэтому обычный логин/пароль здесь не подходит. Вставь Bearer token из Network.'}</p>
        </div>
        <button class="btn-save" onclick="ProfileUI.connectDu()">Сохранить DU token</button>
      </div>

      <div class="profile-card">
        <div class="pc-title">Язык</div>
        <label class="settings-field">Язык интерфейса
          <select id="set-language">
            <option value="ru" ${settings.language === 'ru' ? 'selected' : ''}>Русский</option>
            <option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option>
            <option value="kk" ${settings.language === 'kk' ? 'selected' : ''}>Қазақша</option>
          </select>
        </label>
      </div>

      <div class="profile-card">
        <div class="pc-title">Уведомления</div>
        <label class="setting-check">
          <input id="set-notifications" type="checkbox" ${settings.notifications ? 'checked' : ''} />
          Включить уведомления
        </label>
        <label class="settings-field">Напоминание перед парой, минут
          <input id="set-class-min" type="number" min="0" max="180" value="${settings.classReminderMinutes}" />
        </label>
        <label class="settings-field">Горящий дедлайн, часов до события
          <input id="set-deadline-hours" type="number" min="1" max="168" value="${settings.deadlineReminderHours}" />
        </label>
        <button class="btn-save" onclick="ProfileUI.saveSettings()">Сохранить настройки</button>
      </div>`;
  }

  async function saveProfile() {
    const name = document.getElementById('pf-name')?.value.trim();
    const group = document.getElementById('pf-group')?.value.trim();
    if (!name || !group) return showToast('Укажите имя и группу');

    try {
      const { user } = await API.updateProfile({ name, group });
      Auth.setUser(user);
      render();
      showToast('Профиль обновлен');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  }

  async function saveSettings() {
    const current = Auth.getUser()?.settings || {};
    const settings = {
      ...current,
      language: document.getElementById('set-language')?.value || 'ru',
      notifications: Boolean(document.getElementById('set-notifications')?.checked),
      classReminderMinutes: Number(document.getElementById('set-class-min')?.value || 30),
      deadlineReminderHours: Number(document.getElementById('set-deadline-hours')?.value || 24)
    };

    try {
      const { user } = await API.updateProfile({ settings });
      Auth.setUser(user);
      render();
      showToast('Настройки сохранены');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  }

  async function syncCalendar() {
    const group = document.getElementById('pf-group')?.value.trim();
    const calendarUrl = document.getElementById('pf-calendar')?.value.trim();
    if (!group || !calendarUrl) return showToast('Укажите группу и Moodle Calendar URL');

    try {
      const { user, events } = await API.connectCalendar(group, calendarUrl);
      Auth.setUser(user);
      render();
      showToast(`Календарь синхронизирован: ${events.length} событий`);
    } catch (err) {
      showToast('Ошибка календаря: ' + err.message);
    }
  }

  async function connectDu() {
    const login = document.getElementById('pf-du-login')?.value.trim();
    const token = document.getElementById('pf-du-token')?.value.trim() || '';
    if (!token) return showToast('Вставьте DU Bearer token');

    try {
      const { user } = await API.connectDu(token, login);
      Auth.setUser(user);
      document.getElementById('pf-du-token').value = '';
      render();
      showToast('DU token сохранен');
    } catch (err) {
      showToast('DU token: ' + err.message);
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid var(--b2);border-radius:var(--r-sm);padding:10px 20px;font-size:13px;z-index:500';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  return { init, render, saveProfile, saveSettings, syncCalendar, connectDu };
})();
