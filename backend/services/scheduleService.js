const repo = require('./firestoreRepository');
const calendar = require('./calendarService');
const duCache = require('./duCacheService');

const DEFAULT_TIMEZONE = process.env.TELEGRAM_TIMEZONE || 'Asia/Almaty';

function formatDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function startOfLocalDay(value = new Date()) {
  const [year, month, day] = formatDay(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function currentWeekday(now = new Date()) {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    weekday: 'short'
  }).format(now);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[short];
}

function parseScheduleDay(text, now = new Date()) {
  const normalized = String(text || '').toLowerCase();
  const today = startOfLocalDay(now);
  const weekdays = [
    { day: 1, label: 'понедельник', words: ['понедельник', 'понедельника', 'пн', 'monday', 'mon'] },
    { day: 2, label: 'вторник', words: ['вторник', 'вторника', 'вт', 'tuesday', 'tue'] },
    { day: 3, label: 'среду', words: ['среду', 'среда', 'среды', 'ср', 'wednesday', 'wed'] },
    { day: 4, label: 'четверг', words: ['четверг', 'четверга', 'чт', 'thursday', 'thu'] },
    { day: 5, label: 'пятницу', words: ['пятницу', 'пятница', 'пятницы', 'пт', 'friday', 'fri'] },
    { day: 6, label: 'субботу', words: ['субботу', 'суббота', 'субботы', 'сб', 'saturday', 'sat'] },
    { day: 0, label: 'воскресенье', words: ['воскресенье', 'воскресенья', 'вс', 'sunday', 'sun'] }
  ];

  if (/(^|[^a-zа-яё])(сегодня|today)([^a-zа-яё]|$)/i.test(normalized)) return { date: today, label: 'сегодня' };
  if (/(^|[^a-zа-яё])(завтра|tomorrow)([^a-zа-яё]|$)/i.test(normalized)) return { date: addDays(today, 1), label: 'завтра' };
  if (/(^|[^a-zа-яё])послезавтра([^a-zа-яё]|$)/i.test(normalized)) return { date: addDays(today, 2), label: 'послезавтра' };

  if (/(^|[^a-zа-яё])(сегодня|today)([^a-zа-яё]|$)/i.test(normalized)) return { date: today, label: 'сегодня' };
  if (/(^|[^a-zа-яё])(завтра|tomorrow)([^a-zа-яё]|$)/i.test(normalized)) return { date: addDays(today, 1), label: 'завтра' };
  if (/(^|[^a-zа-яё])послезавтра([^a-zа-яё]|$)/i.test(normalized)) return { date: addDays(today, 2), label: 'послезавтра' };

  const readableWeekdays = [
    { day: 1, label: 'понедельник', words: ['понедельник', 'понедельника', 'пн'] },
    { day: 2, label: 'вторник', words: ['вторник', 'вторника', 'вт'] },
    { day: 3, label: 'среду', words: ['среду', 'среда', 'среды', 'ср'] },
    { day: 4, label: 'четверг', words: ['четверг', 'четверга', 'чт'] },
    { day: 5, label: 'пятницу', words: ['пятницу', 'пятница', 'пятницы', 'пт'] },
    { day: 6, label: 'субботу', words: ['субботу', 'суббота', 'субботы', 'сб'] },
    { day: 0, label: 'воскресенье', words: ['воскресенье', 'воскресенья', 'вс'] }
  ];
  const readableFound = readableWeekdays.find((item) => item.words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zа-яё])${escaped}([^a-zа-яё]|$)`, 'i').test(normalized);
  }));
  if (readableFound) {
    const offset = (readableFound.day - currentWeekday(now) + 7) % 7;
    return { date: addDays(today, offset), label: readableFound.label };
  }

  const found = weekdays.find((item) => item.words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zа-яё])${escaped}([^a-zа-яё]|$)`, 'i').test(normalized);
  }));
  if (!found) return null;

  const offset = (found.day - currentWeekday(now) + 7) % 7;
  return { date: addDays(today, offset), label: found.label };
}

function normalizeDateKey(value) {
  if (!value) return '';
  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) return formatDay(asDate);
  const text = String(value);
  const match = text.match(/(\d{4})[-.](\d{2})[-.](\d{2})|(\d{2})[-.](\d{2})[-.](\d{4})/);
  if (!match) return '';
  if (match[1]) return `${match[1]}-${match[2]}-${match[3]}`;
  return `${match[6]}-${match[5]}-${match[4]}`;
}

function extractTime(value) {
  if (!value) return '';
  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit'
    }).format(asDate);
  }
  const match = String(value).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : String(value);
}

function eventTime(event) {
  const startText = extractTime(event.start_time || event.startTime || event.start || event.time || event.beginTime);
  const endText = extractTime(event.end_time || event.endTime || event.end || event.finishTime);
  return endText && endText !== startText ? `${startText}-${endText}` : startText;
}

function lessonEvents(events) {
  return (events || [])
    .filter((event) => event.start_time)
    .filter((event) => !['deadline', 'quiz', 'exam'].includes(event.type))
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}

function formatCalendarLesson(event, index) {
  const title = event.title || event.discipline || event.summary || 'Пара';
  const place = event.room || event.location ? `\n   Аудитория: ${event.room || event.location}` : '';
  return `${index + 1}. ${title}\n   ${eventTime(event)}${place}`;
}

function filterCalendarSchedule(events, text, now = new Date()) {
  const day = parseScheduleDay(text, now);
  const lessons = lessonEvents(events);

  if (day?.date) {
    const target = formatDay(day.date);
    return { day, lessons: lessons.filter((event) => formatDay(event.start_time) === target) };
  }

  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    day: null,
    lessons: lessons
      .filter((event) => new Date(event.start_time) >= now)
      .filter((event) => new Date(event.start_time) <= weekEnd)
  };
}

function formatCalendarSchedule(events, text, now = new Date()) {
  const { day, lessons } = filterCalendarSchedule(events, text, now);
  if (!lessons.length) return '';

  const header = day
    ? `Расписание на ${day.label} из Moodle Calendar:`
    : 'Расписание на ближайшие 7 дней из Moodle Calendar:';
  return `${header}\n\n${lessons.slice(0, 15).map(formatCalendarLesson).join('\n\n')}`;
}

async function calendarEventsForUser(user) {
  const cache = await repo.getEventsCache(user._id);
  if ((cache.events || []).length || !user.calendar_url) return cache.events || [];
  return calendar.refreshUserCalendar(user);
}

function unwrapDuSchedule(schedule) {
  if (Array.isArray(schedule)) return schedule;
  if (Array.isArray(schedule?.list)) return schedule.list;
  if (Array.isArray(schedule?.content)) return schedule.content;
  if (Array.isArray(schedule?.data)) return schedule.data;
  if (Array.isArray(schedule?.schedule)) return schedule.schedule;
  return [];
}

function duDateKey(item) {
  return normalizeDateKey(
    item.date || item.lessonDate || item.classDate || item.dayDate || item.startDate || item.startTime || item.start_time
  );
}

function duWeekday(item) {
  const value = item.weekDay || item.weekday || item.dayOfWeek || item.day || item.dayName;
  if (value === undefined || value === null) return '';
  const text = String(value).toLowerCase();
  const map = {
    monday: 1, mon: 1, понедельник: 1,
    tuesday: 2, tue: 2, вторник: 2,
    wednesday: 3, wed: 3, среда: 3,
    thursday: 4, thu: 4, четверг: 4,
    friday: 5, fri: 5, пятница: 5,
    saturday: 6, sat: 6, суббота: 6,
    sunday: 0, sun: 0, воскресенье: 0
  };
  const duDay = text.match(/^d([1-7])$/);
  if (duDay) return Number(duDay[1]) % 7;
  if (/^\d+$/.test(text)) return Number(text) % 7;
  return map[text] ?? '';
}

function parseDaysMeta(item) {
  if (!item.days || typeof item.days !== 'string') return null;
  try {
    return JSON.parse(item.days);
  } catch {
    return null;
  }
}

function duLessonTitle(item) {
  return item.discipline || item.subject || item.subjectName || item.title || item.name || item.lessonName || 'Пара';
}

function duLessonTime(item) {
  const meta = parseDaysMeta(item);
  const slotId = item.classtime_time || item.timeId || item.time_id;
  const slot = Array.isArray(meta?.time) ? meta.time.find((entry) => String(entry.id) === String(slotId)) : null;
  if (slot?.start || slot?.finish) {
    return [slot.start, slot.finish].filter(Boolean).join('-');
  }

  const start = extractTime(item.startTime || item.start_time || item.beginTime || item.timeStart || item.time);
  const end = extractTime(item.endTime || item.end_time || item.finishTime || item.timeEnd);
  if (start && end && start !== end) return `${start}-${end}`;
  return start || item.pairTime || item.lessonTime || '';
}

function formatDuLesson(item, index) {
  const teacher = item.teacher || item.tutor || item.teacherName || item.tutorFullName || '';
  const room = item.room || item.auditory || item.classroom || item.location || '';
  const type = item.type || item.lessonType || item.kind || '';
  const meta = [duLessonTime(item), room && `ауд. ${room}`, teacher, type].filter(Boolean).join(' | ');
  return `${index + 1}. ${duLessonTitle(item)}${meta ? `\n   ${meta}` : ''}`;
}

function dayLabelByDuDay(value) {
  const weekday = duWeekday({ day: value });
  return {
    1: 'понедельник',
    2: 'вторник',
    3: 'среда',
    4: 'четверг',
    5: 'пятница',
    6: 'суббота',
    0: 'воскресенье'
  }[weekday] || 'день';
}

function sortDuLessons(list) {
  const dayOrder = (item) => {
    if (item.classtime_day) return duWeekday({ day: item.classtime_day });
    const weekday = duWeekday(item);
    return weekday === '' ? 9 : Number(weekday);
  };
  const timeOrder = (item) => String(item.classtime_time || item.timeId || item.time || '');
  return [...list].sort((a, b) => {
    const byDay = dayOrder(a) - dayOrder(b);
    if (byDay) return byDay;
    return timeOrder(a).localeCompare(timeOrder(b));
  });
}

function filterDuSchedule(schedule, text, now = new Date()) {
  const day = parseScheduleDay(text, now);
  const list = unwrapDuSchedule(schedule);
  if (!day?.date) return { day: null, lessons: list.slice(0, 15) };

  const targetDate = formatDay(day.date);
  const targetWeekday = currentWeekday(day.date);
  const lessons = list.filter((item) => {
    const dateKey = duDateKey(item);
    if (dateKey) return dateKey === targetDate;
    if (item.classtime_day) {
      return duWeekday({ day: item.classtime_day }) === targetWeekday;
    }
    const weekday = duWeekday(item);
    return weekday !== '' && Number(weekday) === targetWeekday;
  });
  return { day, lessons };
}

function formatDuSchedule(schedule, text, group, now = new Date()) {
  const { day, lessons } = filterDuSchedule(schedule, text, now);
  if (!lessons.length) {
    return day
      ? `В нашей DU cache базе для группы ${group} нет пар на ${day.label}.`
      : `В нашей DU cache базе для группы ${group} расписание пустое.`;
  }

  if (!day) {
    const grouped = new Map();
    sortDuLessons(lessons).forEach((item) => {
      const key = item.classtime_day || item.weekDay || item.weekday || item.day || 'other';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });
    const blocks = [...grouped.entries()].map(([key, items]) => {
      return `${dayLabelByDuDay(key)}:\n${items.slice(0, 8).map(formatDuLesson).join('\n\n')}`;
    });
    return `Расписание ${group} на неделю из DU cache:\n\n${blocks.join('\n\n')}`;
  }

  const header = day
    ? `Расписание ${group} на ${day.label} из DU cache:`
    : `Расписание ${group} из DU cache:`;
  return `${header}\n\n${lessons.slice(0, 15).map(formatDuLesson).join('\n\n')}`;
}

async function getDuScheduleReply(user, text) {
  const group = String(user.group || '').trim().toUpperCase();
  if (!group) return 'Укажи группу командой /group SE-2401, и я смогу показать расписание из DU cache.';

  const cached = await duCache.getCachedGroupSchedule(group);
  if (!cached) return `В нашей базе пока нет расписания для группы ${group}.`;
  return formatDuSchedule(cached.schedule, text, group);
}

async function getScheduleReply(user, text) {
  if (user.calendar_url) {
    const events = await calendarEventsForUser(user);
    const moodleReply = formatCalendarSchedule(events, text);
    if (moodleReply) return moodleReply;
  }

  return getDuScheduleReply(user, text);
}

function isScheduleRequest(text) {
  const normalized = String(text || '').toLowerCase().trim();
  if (/^\/schedule\b/.test(normalized)) return true;
  if (/^(расписание|пары|пара|schedule|classes)([\s?!.,]|$)/i.test(normalized)) return true;
  if (/(покажи|дай|скинь|какое|каково|есть)\s+.{0,32}расписани/i.test(normalized)) return true;
  if (/(расписани\w*|пар[аы])\s+(на|в|во)\s+(сегодня|завтра|послезавтра|понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)/i.test(normalized)) return true;
  if (/(сегодня|завтра|послезавтра|понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\s+.{0,24}(расписани\w*|пар[аы])/i.test(normalized)) return true;
  return false;
}

async function fetchGroupSchedule(group) {
  const cached = await duCache.getCachedGroupSchedule(group);
  return cached?.schedule || [];
}

function normalizeDuSchedule(schedule) {
  return unwrapDuSchedule(schedule);
}

module.exports = {
  fetchGroupSchedule,
  getScheduleReply,
  isScheduleRequest,
  normalizeDuSchedule,
  formatCalendarSchedule,
  parseScheduleDay
};
