const ical = require('node-ical');
const repo = require('./firestoreRepository');

const TYPE_KEYWORDS = [
  { type: 'exam', words: ['exam', 'экзамен', 'final', 'midterm'] },
  { type: 'quiz', words: ['quiz', 'test', 'тест', 'квиз'] },
  { type: 'deadline', words: ['deadline', 'assignment', 'due', 'submit', 'дедлайн', 'задание', 'сдать'] },
  { type: 'lecture', words: ['lecture', 'class', 'lesson', 'lab', 'practice', 'занятие', 'лекция', 'пара', 'практика'] }
];

function cleanText(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyEvent(event) {
  const haystack = [
    event.summary,
    event.description,
    event.location,
    Array.isArray(event.categories) ? event.categories.join(' ') : ''
  ].filter(Boolean).join(' ').toLowerCase();

  const match = TYPE_KEYWORDS.find(({ words }) => words.some((word) => haystack.includes(word)));
  return match ? match.type : 'lecture';
}

function pickDetail(text, labels) {
  const source = cleanText(text);
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]\\s*([^|;\\n]+)`, 'i');
    const match = source.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function inferDiscipline(event) {
  const summary = cleanText(event.summary);
  const description = cleanText(event.description);
  const categories = Array.isArray(event.categories) ? event.categories.join(' ') : '';
  const explicit = pickDetail(description, [
    'course',
    'discipline',
    'subject',
    'module',
    'курс',
    'дисциплина',
    'предмет'
  ]);

  if (explicit) return explicit;
  if (summary && !/^attendance$/i.test(summary)) return summary;

  const fromCategories = cleanText(categories);
  if (fromCategories && !/^attendance$/i.test(fromCategories)) return fromCategories;

  const descriptionParts = description
    .split(/(?:\||;|\.|\n)/)
    .map((part) => part.trim())
    .filter(Boolean);

  return descriptionParts.find((part) => !/^attendance$/i.test(part) && part.length > 3) || summary || 'Без названия';
}

function inferRoom(event) {
  const explicit = pickDetail(event.description, [
    'room',
    'classroom',
    'cabinet',
    'location',
    'аудитория',
    'кабинет'
  ]);
  return cleanText(event.location || explicit);
}

function normalizeEvent(event) {
  const start = event.start ? new Date(event.start) : null;
  const end = event.end ? new Date(event.end) : start;
  const discipline = inferDiscipline(event);
  const location = inferRoom(event);

  return {
    uid: event.uid || `${event.summary}-${start?.toISOString() || Date.now()}`,
    title: discipline,
    summary: cleanText(event.summary),
    description: cleanText(event.description),
    discipline,
    location,
    room: location,
    type: classifyEvent(event),
    start_time: start ? start.toISOString() : null,
    end_time: end ? end.toISOString() : null,
    completed: false
  };
}

async function fetchIcs(calendarUrl) {
  if (!calendarUrl || !/^https?:\/\//i.test(calendarUrl)) {
    const err = new Error('Укажите корректную ICS-ссылку Moodle');
    err.status = 400;
    throw err;
  }

  const response = await fetch(calendarUrl, {
    headers: { 'User-Agent': 'AI-University-Assistant/1.0' }
  });

  if (!response.ok) {
    const err = new Error(`ICS недоступен: HTTP ${response.status}`);
    err.status = 400;
    throw err;
  }

  const text = await response.text();
  if (!text.includes('BEGIN:VCALENDAR')) {
    const err = new Error('Ссылка не похожа на ICS-календарь');
    err.status = 400;
    throw err;
  }

  return text;
}

async function parseIcsUrl(calendarUrl) {
  const raw = await fetchIcs(calendarUrl);
  const parsed = ical.sync.parseICS(raw);
  return Object.values(parsed)
    .filter((item) => item.type === 'VEVENT')
    .map(normalizeEvent)
    .filter((event) => event.start_time)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}

async function refreshUserCalendar(user) {
  const events = await parseIcsUrl(user.calendar_url);
  await repo.saveEventsCache(user._id || user.id, events);
  return events;
}

function filterEvents(events, { type, from, to } = {}) {
  return events.filter((event) => {
    const start = new Date(event.start_time);
    if (type && event.type !== type) return false;
    if (from && start < new Date(from)) return false;
    if (to && start > new Date(to)) return false;
    return true;
  });
}

function buildSummary(events) {
  const now = new Date();
  const upcoming = events.filter((event) => new Date(event.start_time) >= now);
  return {
    total: events.length,
    upcoming: upcoming.length,
    lectures: upcoming.filter((event) => event.type === 'lecture').length,
    deadlines: upcoming.filter((event) => event.type === 'deadline').length,
    quizzes: upcoming.filter((event) => event.type === 'quiz').length,
    exams: upcoming.filter((event) => event.type === 'exam').length,
    next: upcoming.slice(0, 5)
  };
}

module.exports = {
  parseIcsUrl,
  refreshUserCalendar,
  filterEvents,
  buildSummary
};
