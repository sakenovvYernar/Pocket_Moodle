const { Telegraf, Markup } = require('telegraf');
const repo = require('./firestoreRepository');
const calendar = require('./calendarService');
const { generateAssistantReply, stripAiPrefix } = require('./aiService');
const { getScheduleReply, isScheduleRequest, normalizeDuSchedule, parseScheduleDay } = require('./scheduleService');
const { notificationCandidates, startNotificationScheduler } = require('./notificationService');
const deadlines = require('./deadlineService');
const duCache = require('./duCacheService');

const DEFAULT_TIMEZONE = process.env.TELEGRAM_TIMEZONE || 'Asia/Almaty';
const sessions = new Map();
const teacherContexts = new Map();

function fullName(from = {}) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram Student';
}

function arg(ctx) {
  return String(ctx.message?.text || '').trim().split(/\s+/).slice(1).join(' ').trim();
}

function rememberTeacher(chatId, teacher) {
  if (!chatId || !teacher?.email) return;
  teacherContexts.set(chatId, {
    name: teacher.name || '',
    email: teacher.email || '',
    updatedAt: Date.now()
  });
}

function recentTeacher(chatId) {
  const teacher = teacherContexts.get(chatId);
  if (!teacher) return null;
  const maxAgeMs = 30 * 60 * 1000;
  if (Date.now() - teacher.updatedAt > maxAgeMs) {
    teacherContexts.delete(chatId);
    return null;
  }
  return teacher;
}

function keyboard() {
  return Markup.keyboard([
    ['/today', '/week'],
    ['/deadlines', '/testnotify'],
    ['/attendance', '/profile', '/help']
  ]).resize();
}

function removeKeyboard() {
  return Markup.removeKeyboard();
}

function isCalendarUrl(value) {
  return /^https?:\/\/.+/i.test(String(value || '').trim());
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: DEFAULT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function compact(text, max = 3900) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 80)}\n\n...сообщение сокращено из-за лимита Telegram.` : value;
}

function parseNumbers(text) {
  return String(text || '')
    .replace(',', '.')
    .match(/\d+(?:\.\d+)?/g)
    ?.map(Number)
    .filter((number) => Number.isFinite(number)) || [];
}

function isAiRequest(text) {
  const normalized = String(text || '').toLowerCase().trim();
  return /^\/(ask|ai)\b/.test(normalized) || /^(ai|ии|gpt|gemini)[,:]?\s+/.test(normalized);
}

function isReadableScheduleRequest(text) {
  return /(^\/(today|week|schedule)\b|расписан|пары|пара|заняти|schedule|classes|сегодня|завтра|послезавтра|понедельник|вторник|сред|четверг|пятниц|суббот|воскрес)/i
    .test(String(text || ''));
}

function hasTeacherMarker(text) {
  return /(^\/teacher\b|teacher|преподав|препод|лектор|профессор|tutor)/i.test(String(text || ''));
}

function isUniversityQuestion(text) {
  const normalized = String(text || '').toLowerCase();
  if (isReadableScheduleRequest(normalized) || hasTeacherMarker(normalized)) return true;
  return [
    'aitu', 'astana it', 'университет', 'универ', 'астана айти',
    'распис', 'пара', 'дедлайн', 'deadline', 'moodle', 'du',
    'препод', 'teacher', 'силлабус', 'syllabus', 'attendance',
    'посещаем', 'группа', 'кабинет', 'аудитор', 'экзамен', 'midterm', 'endterm'
  ].some((word) => normalized.includes(word));
}

function keywordIntent(text) {
  const normalized = String(text || '').toLowerCase();
  if (isReadableScheduleRequest(normalized) || isScheduleRequest(normalized)) return 'schedule';
  if (/deadline|дедлайн|срок|экзамен|midterm|endterm|final/.test(normalized)) return 'deadlines';
  if (/teacher|препод|преподавател|лектор|профессор/.test(normalized)) return 'teacher';
  if (/attendance|посещаем|аттенд|пропуск|поинт/.test(normalized)) return 'attendance';
  if (/notification|уведом|напомин/.test(normalized)) return 'notifications';
  if (/syllabus|силлабус/.test(normalized)) return 'syllabus';
  return '';
}

async function getOrCreateUser(from) {
  const telegramId = String(from.id);
  const existing = await repo.findUserByTelegramId(telegramId);
  if (existing?.safe) return existing.safe;
  return repo.createUser({
    name: fullName(from),
    email: '',
    password: '',
    group: '',
    telegram_id: telegramId
  });
}

async function requireUserWithGroup(ctx) {
  const user = await getOrCreateUser(ctx.from);
  if (user.group) return user;
  sessions.set(ctx.chat.id, { step: 'group' });
  await ctx.reply('Сначала укажи группу, например SE-2401.', removeKeyboard());
  return null;
}

async function saveCalendar(user, calendarUrl) {
  const updated = await repo.updateUser(user._id, { calendar_url: String(calendarUrl || '').trim() });
  const events = await calendar.refreshUserCalendar(updated);
  return { user: updated, events };
}

async function telegramAiReply(user, userText) {
  const chats = await repo.listChats(user._id);
  const existing = chats.find((chat) => chat.title === 'Telegram bot');
  const chat = existing
    ? await repo.getChat(user._id, existing._id || existing.id)
    : await repo.createChat(user._id);

  const userMessage = { role: 'user', content: userText, time: new Date().toISOString() };
  await repo.appendMessages(user._id, chat._id, [userMessage], 'Telegram bot');

  const answer = await generateAssistantReply({
    userId: user._id,
    userText,
    history: chat.messages
  });
  const botMessage = { role: 'assistant', content: answer, time: new Date().toISOString() };
  await repo.appendMessages(user._id, chat._id, [botMessage], 'Telegram bot');
  return answer;
}

function attendanceHelpText() {
  return [
    'Attendance считается по поинтам: 1 пара = 2 поинта.',
    '',
    'Формат:',
    'attendance <всего пар> <посещено пар> <получено поинтов> <минимальный процент>',
    '',
    'Пример:',
    'attendance 30 24 48 70',
    '',
    'Если поинты совпадают с парами, получено поинтов = посещено пар * 2.'
  ].join('\n');
}

function calculateAttendanceText(numbers) {
  const [totalPairsRaw, visitedPairsRaw, earnedPointsRaw, requiredRaw] = numbers;
  const totalPairs = Number(totalPairsRaw || 0);
  const visitedPairs = Number(visitedPairsRaw || 0);
  const earnedPoints = Number(earnedPointsRaw || visitedPairs * 2);
  const required = Number(requiredRaw || 70);

  if (totalPairs <= 0 || visitedPairs < 0 || earnedPoints < 0 || required <= 0 || required > 100) {
    return `Не смог посчитать: проверь числа.\n\n${attendanceHelpText()}`;
  }

  const totalPoints = totalPairs * 2;
  const clampedEarned = Math.max(0, Math.min(totalPoints, earnedPoints));
  const percent = Math.round((clampedEarned / totalPoints) * 100);
  const minimumPoints = Math.ceil(totalPoints * required / 100);
  const lostPoints = Math.max(0, totalPoints - clampedEarned);
  const allowedLostPoints = Math.max(0, totalPoints - minimumPoints);
  const remainingLostPoints = Math.max(0, allowedLostPoints - lostPoints);
  const recoverPoints = Math.max(0, minimumPoints - clampedEarned);

  return [
    'Attendance расчет:',
    `Всего пар: ${totalPairs}`,
    `Всего поинтов: ${totalPoints}`,
    `Посещено пар: ${visitedPairs}`,
    `Получено поинтов: ${clampedEarned}`,
    `Потеряно поинтов: ${lostPoints}`,
    `Текущий процент: ${percent}%`,
    `Минимум: ${required}% (${minimumPoints} поинтов)`,
    '',
    percent >= required
      ? `Все нормально. Можно потерять еще ${remainingLostPoints} поинт(ов), это примерно ${Math.floor(remainingLostPoints / 2)} пар(ы).`
      : `Нужно восстановить минимум ${recoverPoints} поинт(ов), это примерно ${Math.ceil(recoverPoints / 2)} пар(ы).`
  ].join('\n');
}

function formatDeadlineEvent(event) {
  const urgency = event.urgency || deadlines.deadlineUrgency(event);
  const title = event.discipline || event.title || event.summary || 'Дедлайн';
  const summary = event.summary && event.summary !== title ? `\nОписание: ${event.summary}` : '';
  return `${urgency.dot} ${title}${summary}\nСрок: ${formatDateTime(event.start_time)}\nОсталось: ${deadlines.timeLeftLabel(urgency.diffMs)}`;
}

async function deadlinesReply(user) {
  const cache = await repo.getEventsCache(user._id);
  const list = deadlines.upcomingDeadlines(cache.events || [], new Date(), user.settings || {});
  if (!list.length) {
    return user.calendar_url
      ? 'Ближайших дедлайнов в календаре не найдено.'
      : 'Moodle Calendar не подключен. Добавь ссылку командой /calendar URL, чтобы я видел дедлайны.';
  }
  return ['Ближайшие дедлайны:', '', ...list.slice(0, 12).map(formatDeadlineEvent)].join('\n\n');
}

function teacherQuery(text) {
  return String(text || '')
    .replace(/^\/teacher\b/i, '')
    .replace(/\b(\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435|\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u044f|\u043f\u0430\u0440\u044b|schedule)\b/gi, ' ')
    .replace(/\b(\u0441\u0435\u0433\u043e\u0434\u043d\u044f|\u0437\u0430\u0432\u0442\u0440\u0430|\u043d\u0435\u0434\u0435\u043b\u044e|\u043f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a|\u0432\u0442\u043e\u0440\u043d\u0438\u043a|\u0441\u0440\u0435\u0434\u0443|\u0441\u0440\u0435\u0434\u0430|\u0447\u0435\u0442\u0432\u0435\u0440\u0433|\u043f\u044f\u0442\u043d\u0438\u0446\u0443|\u043f\u044f\u0442\u043d\u0438\u0446\u0430|\u0441\u0443\u0431\u0431\u043e\u0442\u0443|\u0441\u0443\u0431\u0431\u043e\u0442\u0430|\u0432\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u0435)\b/gi, ' ')
    .replace(/^(есть|есть ли|найди|покажи|дай|можно)\b/gi, ' ')
    .replace(/\b(информация|инфа|данные|контакты|email|почта)\b/gi, ' ')
    .replace(/\b(по|про|о|об)\s+(преподавател[ьяюе]|препод[аеу]?|teacher)\b/gi, ' ')
    .replace(/\b(преподавател[ьяюе]|препод[аеу]?|teacher)\b/gi, ' ')
    .replace(/расписание|schedule|преподавател[ьяюем]*|препод[а-я]*|teacher|о преподе|про препода/gi, ' ')
    .replace(/на сегодня|сегодня|на завтра|завтра|на неделю|неделю/gi, ' ')
    .replace(/[?!.,:;()[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wantsTeacherSchedule(text) {
  return /расписани|schedule|сегодня|завтра|недел|понедельник|вторник|сред|четверг|пятниц|суббот|воскрес/i.test(String(text || ''));
}

function valueTitle(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return value.titleRu || value.titleEn || value.titleKz || value.nameRu || value.nameEn || value.nameKz || value.name || value.title || '';
  }
  return String(value);
}

function isTeacherScheduleFollowup(text) {
  const normalized = String(text || '').toLowerCase();
  const hasPronoun = /\b(его|ее|её|него|нее|препода|преподавателя|teacher)\b/i.test(normalized);
  const hasSchedule = /расписани|пары|schedule|сегодня|завтра|недел|понедельник|вторник|сред|четверг|пятниц|суббот|воскрес/i.test(normalized);
  return hasPronoun && hasSchedule;
}

async function replyWithRecentTeacherSchedule(ctx, text) {
  const teacher = recentTeacher(ctx.chat.id);
  if (!teacher || !isTeacherScheduleFollowup(text)) return false;

  await ctx.sendChatAction('typing');
  const schedule = await teacherScheduleText(teacher.email, text)
    .catch(() => 'Расписание преподавателя не загрузилось.');
  await ctx.reply(compact(`Расписание ${teacher.name || teacher.email}:\n\n${schedule}`), keyboard());
  return true;
}

function isExplicitTeacherScheduleQuery(text) {
  const normalized = String(text || '').toLowerCase();
  const hasSchedule = /(\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438|\u043f\u0430\u0440\u044b|schedule)/i.test(normalized);
  if (!hasSchedule) return false;
  if (!hasTeacherMarker(normalized)) return false;
  return teacherSearchTokens(teacherQuery(text)).length > 0;
}

function cachedTeacherName(item = {}) {
  const kz = [item.surnameKz, item.nameKz, item.patronymicKz].filter(Boolean).join(' ');
  const ru = [item.surnameRu, item.nameRu, item.patronymicRu].filter(Boolean).join(' ');
  const en = [item.userInfo?.surname, item.userInfo?.name].filter(Boolean).join(' ');
  return item.fullName || item.fio || ru || kz || en || item.email || `DU teacher ${item.id || ''}`.trim();
}

function cachedTeacherEmail(item = {}) {
  const candidates = [
    item.email,
    item.mail,
    item.corporateEmail,
    item.userInfo?.username,
    item.username,
    item.login
  ].filter(Boolean).map((value) => String(value).trim());
  return candidates.find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || '';
}

function normalizeCachedTeacher(item = {}) {
  return {
    id: item.id || item.teacherId || '',
    userId: item.userId || item.userInfo?.id || '',
    name: cachedTeacherName(item),
    email: cachedTeacherEmail(item),
    department: valueTitle(item.department) || valueTitle(item.school) || item.departmentName || '',
    position: valueTitle(item.position) || item.positionName || '',
    raw: item
  };
}

const TEACHER_QUERY_STOPWORDS = new Set([
  'есть', 'ли', 'информация', 'инфа', 'данные', 'контакты', 'почта', 'email',
  'по', 'про', 'о', 'об', 'у', 'для', 'на', 'за',
  'преподаватель', 'преподавателя', 'преподавателю', 'преподавателе',
  'препод', 'препода', 'преподу', 'teacher', 'найди', 'покажи', 'дай',
  'расписание', 'schedule', 'сегодня', 'завтра', 'неделю'
]);

function normalizeTeacherSearchValue(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}@._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teacherSearchTokens(value) {
  return normalizeTeacherSearchValue(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !TEACHER_QUERY_STOPWORDS.has(token));
}

function tokenMatches(queryToken, targetToken) {
  if (queryToken === targetToken) return { score: 35, strong: true };
  if (queryToken.length >= 4 && (targetToken.startsWith(queryToken) || queryToken.startsWith(targetToken))) {
    return { score: 22, strong: true };
  }
  if (queryToken.length >= 5 && targetToken.includes(queryToken)) {
    return { score: 12, strong: false };
  }
  return { score: 0, strong: false };
}

function scoreCachedTeacher(teacher, query) {
  const q = normalizeTeacherSearchValue(query);
  const name = normalizeTeacherSearchValue(teacher.name);
  const email = normalizeTeacherSearchValue(teacher.email);
  const queryTokens = teacherSearchTokens(query);
  const nameTokens = teacherSearchTokens(teacher.name);
  if (!q) return 1;
  if (name === q || email === q) return 140;
  if (email && email.includes(q)) return 110;
  if (!queryTokens.length) return 0;
  if (name.includes(q)) return 120;

  let score = 0;
  let strongMatches = 0;
  let exactMatches = 0;

  for (const queryToken of queryTokens) {
    let best = { score: 0, strong: false };
    for (const nameToken of nameTokens) {
      const candidate = tokenMatches(queryToken, nameToken);
      if (candidate.score > best.score) best = candidate;
    }
    if (best.strong) strongMatches += 1;
    if (nameTokens.includes(queryToken)) exactMatches += 1;
    score += best.score;
  }

  if (email && queryTokens.some((token) => token.length >= 4 && email.includes(token))) {
    score += 25;
    strongMatches += 1;
  }

  if (queryTokens.length >= 2 && strongMatches < 2) return 0;
  if (queryTokens.length === 1 && strongMatches < 1) return 0;
  return score + exactMatches * 10;
}

async function searchCachedTeachers(query, limit = 5) {
  const payload = await duCache.getCachedTeachers();
  const list = Array.isArray(payload?.teachers?.list) ? payload.teachers.list : [];
  return list
    .map(normalizeCachedTeacher)
    .filter((teacher) => teacher.name)
    .map((teacher) => ({ teacher, score: scoreCachedTeacher(teacher, query) }))
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score || a.teacher.name.localeCompare(b.teacher.name))
    .slice(0, limit)
    .map((item) => item.teacher);
}

async function teacherScheduleText(email, sourceText) {
  if (!email) return '';
  const cached = await duCache.getCachedTeacherSchedule(email);
  if (!cached?.schedule) return 'Расписание преподавателя в нашей базе пока пустое.';
  const list = normalizeDuSchedule(cached.schedule);
  if (!list.length) return 'Расписание преподавателя в нашей базе пока пустое.';

  const day = parseScheduleDay(sourceText);
  const targetDay = day
    ? new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIMEZONE, weekday: 'short' }).format(day.date)
    : '';
  const dayMap = { Mon: 'd1', Tue: 'd2', Wed: 'd3', Thu: 'd4', Fri: 'd5', Sat: 'd6', Sun: 'd7' };
  const filtered = day ? list.filter((item) => String(item.classtime_day || '').toLowerCase() === dayMap[targetDay]) : list;
  const meta = (item) => {
    let time = item.classtime_time || item.time || '';
    if (item.days && item.classtime_time) {
      try {
        const days = JSON.parse(item.days);
        const slot = days.time?.find((entry) => String(entry.id) === String(item.classtime_time));
        if (slot) time = [slot.start, slot.finish].filter(Boolean).join('-');
      } catch {}
    }
    return [time, item.room && `ауд. ${item.room}`, item.group || item.groups, item.lesson_type].filter(Boolean).join(' | ');
  };

  if (!filtered.length) return day ? `На ${day.label} расписания преподавателя в базе нет.` : 'Расписание преподавателя в базе пустое.';
  const header = day ? `На ${day.label}:` : 'На неделю:';
  return `${header}\n${filtered.slice(0, 20).map((item, index) => {
    const title = item.subject || item.discipline || item.title || 'Пара';
    const details = meta(item);
    return `${index + 1}. ${title}${details ? `\n   ${details}` : ''}`;
  }).join('\n\n')}`;
}

async function teacherAnswer(text, chatId = '') {
  const query = teacherQuery(text);
  if (!query) return 'Напиши имя или email преподавателя. Например: препод Askar Khaimuldin';

  const matches = await searchCachedTeachers(query, 5);
  if (!matches.length) return `Не нашел преподавателя по запросу: ${query}`;

  const [first, ...rest] = matches;
  const details = await duCache.getCachedTeacherDetail(first.id).catch(() => null)
    || await duCache.getCachedTeacherDetail(first.userId).catch(() => null);
  const detailTeacher = normalizeCachedTeacher({
    ...(details?.teacher || {}),
    ...(details?.publicInfo || {}),
    ...(details?.userInfo ? { userInfo: details.userInfo } : {}),
    email: details?.email || first.email
  });
  const merged = {
    ...first,
    ...Object.fromEntries(Object.entries(detailTeacher).filter(([, value]) => value))
  };
  const email = merged.email || '';
  rememberTeacher(chatId, { ...merged, email });

  const lines = [
    `Преподаватель: ${merged.name || first.name}`,
    `Email: ${email || 'не найден'}`,
    `Школа/департамент: ${merged.department || 'не указано'}`,
    `Должность: ${merged.position || 'не указано'}`,
    merged.scientificDegree ? `Степень: ${merged.scientificDegree}` : '',
    merged.academicStatus ? `Статус: ${merged.academicStatus}` : '',
    `DU id: ${merged.id || first.id || 'не указан'}`
  ].filter(Boolean);

  if (wantsTeacherSchedule(text)) {
    const schedule = await teacherScheduleText(email, text).catch(() => 'Расписание преподавателя не загрузилось.');
    lines.push('', 'Расписание:', schedule);
  }

  if (rest.length) {
    lines.push('', 'Похожие варианты:', ...rest.map((teacher) => `- ${teacher.name}${teacher.email ? ` (${teacher.email})` : ''}`));
  }

  return compact(lines.join('\n'));
}

function notificationsStatusText(user) {
  const settings = user.settings || {};
  return [
    `Уведомления: ${settings.notifications === false ? 'выключены' : 'включены'}`,
    `Пары: за ${settings.classReminderMinutes || 30} мин`,
    `Дедлайны: за ${settings.deadlineReminderHours || 24} ч`,
    '',
    'Команды:',
    '/notifications on',
    '/notifications off',
    '/testclass - тест уведомления о паре',
    '/testdeadline - тест уведомления о дедлайне',
    '/testnotify - ближайшее реальное уведомление из календаря'
  ].join('\n');
}

async function testClassNotification(ctx, user) {
  const text = [
    'Тест уведомления о паре:',
    '',
    `Через ${user.settings?.classReminderMinutes || 30} мин начнется пара`,
    `Группа: ${user.group || 'не указана'}`,
    'Предмет: Test class',
    'Аудитория: C1.TEST'
  ].join('\n');
  await ctx.reply(text, keyboard());
}

async function testDeadlineNotification(ctx, user) {
  const text = [
    'Тест уведомления о дедлайне:',
    '',
    `До дедлайна осталось ${user.settings?.deadlineReminderHours || 24} ч`,
    'Задание: Test deadline',
    `Срок: ${formatDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))}`
  ].join('\n');
  await ctx.reply(text, keyboard());
}

async function testRealNotification(ctx, user) {
  const cache = await repo.getEventsCache(user._id);
  const candidates = notificationCandidates(cache.events || [], user.settings || {});
  if (!candidates.length) {
    await ctx.reply('Сейчас нет подходящих событий для реального тестового уведомления. Для проверки используй /testclass или /testdeadline.', keyboard());
    return;
  }
  await ctx.reply(`Тест реального уведомления:\n\n${candidates[0].text}`, keyboard());
}

async function handleSession(ctx, session, text) {
  const user = await getOrCreateUser(ctx.from);

  if (session.step === 'group') {
    const group = text.trim().toUpperCase();
    if (group.length < 2) {
      await ctx.reply('Группа выглядит слишком короткой. Пример: SE-2401.');
      return true;
    }
    const updated = await repo.updateUser(user._id, { group });
    sessions.delete(ctx.chat.id);
    await ctx.reply(`Готово. Группа: ${updated.group}. Расписание буду брать из DU cache.`, keyboard());
    return true;
  }

  if (session.step === 'calendar') {
    if (!isCalendarUrl(text)) {
      await ctx.reply('Нужна ссылка, которая начинается с http:// или https://.');
      return true;
    }
    await ctx.reply('Подключаю Moodle Calendar...');
    const result = await saveCalendar(user, text.trim());
    sessions.delete(ctx.chat.id);
    await ctx.reply(`Календарь подключен. Событий загружено: ${result.events.length}.`, keyboard());
    return true;
  }

  if (session.step === 'attendance') {
    const numbers = parseNumbers(text);
    if (numbers.length < 3) {
      await ctx.reply(attendanceHelpText());
      return true;
    }
    sessions.delete(ctx.chat.id);
    await ctx.reply(calculateAttendanceText(numbers), keyboard());
    return true;
  }

  return false;
}

async function routeText(ctx, text, user) {
  const intent = keywordIntent(text);

  if (await replyWithRecentTeacherSchedule(ctx, text)) {
    return;
  }

  if (intent === 'schedule' && isExplicitTeacherScheduleQuery(text)) {
    await ctx.sendChatAction('typing');
    await ctx.reply(await teacherAnswer(text, ctx.chat.id), keyboard());
    return;
  }

  if (intent === 'schedule') {
    if (!user.group) {
      await ctx.reply('Для расписания нужна группа. Отправь /group SE-2401.', keyboard());
      return;
    }
    await ctx.sendChatAction('typing');
    await ctx.reply(await getScheduleReply(user, text), keyboard());
    return;
  }

  if (intent === 'teacher') {
    await ctx.sendChatAction('typing');
    await ctx.reply(await teacherAnswer(text, ctx.chat.id), keyboard());
    return;
  }

  if (intent === 'deadlines') {
    await ctx.reply(await deadlinesReply(user), keyboard());
    return;
  }

  if (intent === 'attendance') {
    const numbers = parseNumbers(text);
    if (numbers.length >= 3) {
      await ctx.reply(calculateAttendanceText(numbers), keyboard());
      return;
    }
    sessions.set(ctx.chat.id, { step: 'attendance' });
    await ctx.reply(attendanceHelpText(), removeKeyboard());
    return;
  }

  if (intent === 'notifications') {
    await ctx.reply(notificationsStatusText(user), keyboard());
    return;
  }

  if (intent === 'syllabus') {
    await ctx.reply('Силлабусы удобнее открывать в мини-приложении. В боте я могу подсказать, где их искать, но PDF лучше отдавать через Mini App.', keyboard());
    return;
  }

  if (isAiRequest(text) || isUniversityQuestion(text)) {
    const question = stripAiPrefix(text);
    if (!isUniversityQuestion(question)) {
      await ctx.reply('Я отвечаю только на вопросы про AITU, учебу, расписание, дедлайны, преподавателей и сервис Pocket Moodle.', keyboard());
      return;
    }
    await ctx.sendChatAction('typing');
    await ctx.reply(await telegramAiReply(user, question), keyboard());
    return;
  }

  await ctx.reply('Я могу помочь с AITU: расписание, преподаватели, дедлайны, attendance, уведомления и вопросы по университету. Напиши /help для команд.', keyboard());
}

function registerBotHandlers(bot) {
  bot.start(async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    if (user.group) {
      await ctx.reply(`Привет, ${user.name}. Твоя группа: ${user.group}.`, keyboard());
      return;
    }
    sessions.set(ctx.chat.id, { step: 'group' });
    await ctx.reply('Привет. Напиши свою группу, например SE-2401.', removeKeyboard());
  });

  bot.help((ctx) => ctx.reply([
    'Pocket Moodle bot:',
    '/start - начать',
    '/group SE-2401 - указать группу',
    '/calendar URL - подключить Moodle Calendar для дедлайнов',
    '/today - расписание на сегодня',
    '/week - расписание на неделю',
    '/schedule завтра - расписание на день',
    '/deadlines - ближайшие дедлайны',
    '/teacher Имя Фамилия - информация о преподавателе',
    '/attendance - посчитать attendance',
    '/notifications on/off - включить или выключить уведомления',
    '/testclass, /testdeadline, /testnotify - тест уведомлений',
    '/ask вопрос - AI только по AITU и учебным данным'
  ].join('\n'), keyboard()));

  bot.command('cancel', async (ctx) => {
    sessions.delete(ctx.chat.id);
    await ctx.reply('Окей, действие отменено.', keyboard());
  });

  bot.command('register', async (ctx) => {
    sessions.set(ctx.chat.id, { step: 'group' });
    await ctx.reply('Напиши свою группу, например SE-2401.', removeKeyboard());
  });

  bot.command('profile', async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    await ctx.reply([
      `Имя: ${user.name}`,
      `Группа: ${user.group || 'не указана'}`,
      `Moodle Calendar: ${user.calendar_url ? 'подключен' : 'не подключен'}`,
      notificationsStatusText(user)
    ].join('\n'), keyboard());
  });

  bot.command('group', async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    const value = arg(ctx).toUpperCase();
    if (!value) {
      sessions.set(ctx.chat.id, { step: 'group' });
      await ctx.reply('Напиши группу, например SE-2401.', removeKeyboard());
      return;
    }
    const updated = await repo.updateUser(user._id, { group: value });
    await ctx.reply(`Группа обновлена: ${updated.group}`, keyboard());
  });

  bot.command('calendar', async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    const value = arg(ctx);
    if (!value) {
      sessions.set(ctx.chat.id, { step: 'calendar' });
      await ctx.reply('Отправь Moodle Calendar URL.', removeKeyboard());
      return;
    }
    if (!isCalendarUrl(value)) {
      await ctx.reply('Нужна ссылка, которая начинается с http:// или https://.', keyboard());
      return;
    }
    await ctx.reply('Подключаю Moodle Calendar...');
    const result = await saveCalendar(user, value);
    await ctx.reply(`Календарь подключен. Событий загружено: ${result.events.length}.`, keyboard());
  });

  bot.command('refresh', async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    if (!user.calendar_url) {
      await ctx.reply('Moodle Calendar не подключен. Добавь ссылку командой /calendar URL.', keyboard());
      return;
    }
    await ctx.reply('Обновляю Moodle Calendar...');
    const events = await calendar.refreshUserCalendar(user);
    await ctx.reply(`Готово. Событий загружено: ${events.length}.`, keyboard());
  });

  bot.command('notifications', async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    const value = arg(ctx).toLowerCase();
    const current = user.settings || {};
    if (['on', 'enable', 'вкл', 'включить'].includes(value)) {
      const updated = await repo.updateUser(user._id, { settings: { ...current, notifications: true } });
      await ctx.reply(notificationsStatusText(updated), keyboard());
      return;
    }
    if (['off', 'disable', 'выкл', 'выключить'].includes(value)) {
      const updated = await repo.updateUser(user._id, { settings: { ...current, notifications: false } });
      await ctx.reply(notificationsStatusText(updated), keyboard());
      return;
    }
    await ctx.reply(notificationsStatusText(user), keyboard());
  });

  bot.command('testclass', async (ctx) => testClassNotification(ctx, await getOrCreateUser(ctx.from)));
  bot.command('testdeadline', async (ctx) => testDeadlineNotification(ctx, await getOrCreateUser(ctx.from)));
  bot.command('testnotify', async (ctx) => testRealNotification(ctx, await getOrCreateUser(ctx.from)));

  bot.command(['today', 'week', 'schedule'], async (ctx) => {
    const user = await requireUserWithGroup(ctx);
    if (!user) return;
    const command = ctx.message.text.slice(1).split(/\s+/)[0];
    const text = command === 'today'
      ? 'today'
      : command === 'week'
        ? 'week'
        : ctx.message.text;
    await ctx.reply(await getScheduleReply(user, text), keyboard());
  });

  bot.command('deadlines', async (ctx) => ctx.reply(await deadlinesReply(await getOrCreateUser(ctx.from)), keyboard()));
  bot.command('teacher', async (ctx) => ctx.reply(await teacherAnswer(ctx.message.text, ctx.chat.id), keyboard()));
  bot.command('attendance', async (ctx) => {
    const numbers = parseNumbers(ctx.message.text);
    if (numbers.length >= 3) {
      await ctx.reply(calculateAttendanceText(numbers), keyboard());
      return;
    }
    sessions.set(ctx.chat.id, { step: 'attendance' });
    await ctx.reply(attendanceHelpText(), removeKeyboard());
  });

  bot.command(['ask', 'ai'], async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    await routeText(ctx, ctx.message.text, user);
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const session = sessions.get(ctx.chat.id);
    if (session && !text.startsWith('/')) {
      await handleSession(ctx, session, text);
      return;
    }
    if (text.startsWith('/')) {
      await ctx.reply('Не знаю такую команду. Напиши /help.', keyboard());
      return;
    }
    await routeText(ctx, text, await getOrCreateUser(ctx.from));
  });

  bot.catch((err, ctx) => {
    console.error('Telegram bot error:', err);
    return ctx.reply(`Ошибка: ${err.message || 'не удалось обработать запрос'}`).catch(() => {});
  });
}

async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('Telegram bot skipped: TELEGRAM_BOT_TOKEN is not set');
    return;
  }

  const bot = new Telegraf(token);
  registerBotHandlers(bot);
  const me = await bot.telegram.getMe();
  console.log(`Telegram bot authorized as @${me.username || me.first_name || me.id}`);

  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'register', description: 'Указать группу' },
    { command: 'profile', description: 'Профиль и настройки' },
    { command: 'group', description: 'Изменить группу' },
    { command: 'calendar', description: 'Подключить Moodle Calendar' },
    { command: 'schedule', description: 'Расписание' },
    { command: 'today', description: 'Расписание на сегодня' },
    { command: 'week', description: 'Расписание на неделю' },
    { command: 'deadlines', description: 'Ближайшие дедлайны' },
    { command: 'teacher', description: 'Поиск преподавателя' },
    { command: 'attendance', description: 'Attendance калькулятор' },
    { command: 'notifications', description: 'Уведомления' },
    { command: 'testclass', description: 'Тест уведомления о паре' },
    { command: 'testdeadline', description: 'Тест уведомления о дедлайне' },
    { command: 'testnotify', description: 'Тест реального уведомления' },
    { command: 'refresh', description: 'Обновить Moodle Calendar' },
    { command: 'ask', description: 'AI вопрос по AITU' },
    { command: 'help', description: 'Помощь' },
    { command: 'cancel', description: 'Отмена' }
  ]);

  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  bot.launch({ dropPendingUpdates: true }, () => {
    console.log('Telegram bot polling started');
  }).catch((err) => {
    console.error('Telegram bot polling error:', err);
  });
  startNotificationScheduler(bot);
  console.log('Telegram bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startTelegramBot };
