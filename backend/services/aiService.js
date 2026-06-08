const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TextDecoder } = require('util');
const fs = require('fs');
const path = require('path');
const repo = require('./firestoreRepository');
const deadlines = require('./deadlineService');
const duCache = require('./duCacheService');
const scheduleService = require('./scheduleService');

function getClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
}

const cp1251Decoder = new TextDecoder('windows-1251');
const cp1251Encode = new Map();
for (let i = 0; i < 256; i += 1) {
  cp1251Encode.set(cp1251Decoder.decode(Uint8Array.from([i])), i);
}

const MOJIBAKE_TOKEN_RE = /[\u0080-\u00ff\u0400-\u04ff\u2010-\u2026\u2030-\u203a\u20ac\u2122]+/g;
const MOJIBAKE_HINT_RE = /[\u0420\u0421\u0440\u045f\u0432\u0402\u00ac\u0098]/;

function repairMojibakeToken(token) {
  if (!MOJIBAKE_HINT_RE.test(token)) return token;

  const bytes = [];
  for (const char of token) {
    if (!cp1251Encode.has(char)) return token;
    bytes.push(cp1251Encode.get(char));
  }

  const fixed = Buffer.from(bytes).toString('utf8');
  return fixed.includes('\uFFFD') ? token : fixed;
}

function repairMojibakeText(text) {
  return String(text || '').replace(MOJIBAKE_TOKEN_RE, repairMojibakeToken);
}

const SYSTEM_PROMPT = `Ты Pocket Moodle AI, ассистент для студентов Astana IT University.

Отвечай только на университетские и учебные вопросы: AITU, расписание, дедлайны, преподаватели, силлабусы, attendance, Moodle, DU и функции Pocket Moodle.
Если вопрос не относится к университету или учебе, вежливо откажись и предложи спросить про AITU или учебные данные.
Используй только предоставленный контекст. Не выдумывай пары, дедлайны, контакты, оценки или документы. Если данных нет, честно скажи, что в базе нет подходящей информации.
Отвечай кратко, дружелюбно и на языке пользователя.`;

const NO_GUARANTEED_ANSWER = 'К сожалению, на данный момент не могу дать гарантированный ответ. Советую обратиться в департамент вашей образовательной школы.';

const UNIVERSITY_ONLY_SYSTEM_PROMPT = `Ты Pocket Moodle AI, ассистент для студентов Astana IT University.

Отвечай только на вопросы, связанные с университетом и учебой: AITU, расписание, дедлайны, преподаватели, силлабусы, attendance, Moodle, DU, образовательные школы, департаменты и функции Pocket Moodle.
Если вопрос не относится к университету или учебе, вежливо откажись и предложи спросить про AITU или учебные данные.

Используй только предоставленный контекст: локальную базу знаний, данные профиля, расписание, календарь, DU cache и результаты web search, если они есть.
Не выдумывай пары, дедлайны, контакты, документы, правила или даты.
Если в контексте нет надежного ответа, ответь ровно так: "${NO_GUARANTEED_ANSWER}"

Отвечай кратко, дружелюбно и на языке пользователя.`;

function isAssistantRole(role) {
  return ['assistant', 'model', 'bot'].includes(String(role || '').toLowerCase());
}

function wantsAiReply(text) {
  const normalized = String(text || '').toLowerCase().trim();
  if (!normalized) return false;
  if (/^\/(ask|ai)\b/.test(normalized)) return true;
  if (/^(ии|ai|gpt|gemini)[,:]?\s+/i.test(normalized)) return true;
  if (/\b(спроси|вопрос)\s+(ии|ai|бота|нейросет)/i.test(normalized)) return true;
  if (/\b(ии|ai|gpt|gemini)\b/i.test(normalized) && normalized.includes('?')) return true;
  return false;
}

function stripAiPrefix(text) {
  return String(text || '')
    .replace(/^\/(ask|ai)\s*/i, '')
    .replace(/^(ии|ai|gpt|gemini)[,:]?\s*/i, '')
    .trim();
}

async function buildCalendarContext(userId) {
  if (!userId) return '';

  const cache = await repo.getEventsCache(userId);
  const events = cache.events || [];
  const upcomingEvents = events
    .filter((event) => event.start_time && new Date(event.start_time) >= new Date())
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  const upcoming = upcomingEvents
    .slice(0, 20)
    .map((event) => `${event.type || 'event'}: ${event.title || event.summary || 'Без названия'} (${event.start_time})`)
    .join('\n');

  const deadlineLines = deadlines.upcomingDeadlines(events)
    .slice(0, 10)
    .map((event) => `${event.urgency.dot} ${event.title}: ${event.start_time}, осталось ${event.urgency.timeLeft}`)
    .join('\n');

  const blocks = [];
  if (upcoming) blocks.push(`Ближайшие события календаря:\n${upcoming}`);
  if (deadlineLines) blocks.push(`Дедлайны:\n${deadlineLines}`);
  return blocks.length ? blocks.join('\n\n') : '';
}

function formatHistoryForPrompt(history = []) {
  return history
    .filter((message) => message?.content && message?.role)
    .slice(-12)
    .map((message) => {
      const label = isAssistantRole(message.role) ? 'Ассистент' : 'Студент';
      return `${label}: ${repairMojibakeText(message.content).trim()}`;
    })
    .join('\n\n');
}

function buildUniversityKnowledgeContext() {
  const filePath = path.resolve(__dirname, '..', 'data', 'university-knowledge.md');
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    return text ? `Контекст университета из локальной базы знаний:\n${text}` : '';
  } catch {
    return '';
  }
}

function isUniversityQuestion(text) {
  return /\b(aitu|astana it|astanait|university|универ|университет|расписан|пары|дедлайн|deadline|moodle|du|преподав|teacher|силлабус|syllabus|attendance|департамент|school|школ)\b/i
    .test(String(text || ''));
}

async function buildWebSearchContext(userText) {
  if (!isUniversityQuestion(userText)) return '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_WEB_SEARCH_TIMEOUT_MS || 4500));
  try {
    const query = `Astana IT University AITU ${String(userText || '').slice(0, 180)}`;
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Pocket-Moodle-AI/1.0' }
    });
    if (!response.ok) return '';

    const data = await response.json();
    const lines = [];
    if (data.AbstractText) lines.push(`Summary: ${data.AbstractText}`);
    if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);

    const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
    related.flatMap((item) => Array.isArray(item.Topics) ? item.Topics : [item]).slice(0, 5).forEach((item) => {
      if (item?.Text) lines.push(`Result: ${item.Text}${item.FirstURL ? ` (${item.FirstURL})` : ''}`);
    });

    return lines.length ? `Web search context (use only if relevant and reliable):\n${lines.join('\n')}` : '';
  } catch (err) {
    console.warn('AI web search context error:', err.message || err);
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function compactSchedule(schedule, limit = 12) {
  const list = Array.isArray(schedule)
    ? schedule
    : Array.isArray(schedule?.list)
      ? schedule.list
      : Array.isArray(schedule?.content)
        ? schedule.content
        : [];

  return list.slice(0, limit).map((item) => {
    const discipline = item.discipline || item.subject || item.title || item.name || item.lessonName || 'Пара';
    const teacher = item.tutor || item.teacher || item.teacherName || item.tutorFullName || '';
    const room = item.room || item.auditory || item.classroom || item.location || '';
    const date = item.date || item.day || item.weekDay || item.startTime || item.start_time || '';
    return [discipline, teacher, room, date].filter(Boolean).join(' | ');
  }).filter(Boolean);
}

function formatScheduleForQuestion(schedule, userText, group) {
  const normalized = scheduleService.normalizeDuSchedule(schedule);
  if (!normalized.length) return 'расписание пустое или не найдено.';

  const text = String(userText || '');
  if (/сегодня|завтра|послезавтра|today|tomorrow|понедельник|вторник|сред|четверг|пятниц|суббот|воскрес/i.test(text)) {
    return scheduleService
      .getScheduleReply({ group }, text)
      .then((reply) => reply)
      .catch(() => compactSchedule(schedule, 10).join('\n'));
  }

  return Promise.resolve(compactSchedule(schedule, 10).join('\n') || 'расписание пустое или не найдено.');
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.content)) return payload.content;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.syllabuses)) return payload.syllabuses;
  return [];
}

function textOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(' ');
  if (typeof value === 'object') return Object.values(value).map(textOf).join(' ');
  return '';
}

function keywordsFrom(text) {
  return [...new Set(String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._-]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .slice(0, 12))];
}

function matchesKeywords(item, keywords) {
  if (!keywords.length) return true;
  const hay = textOf(item).toLowerCase();
  return keywords.some((word) => hay.includes(word));
}

async function buildDuCacheContext(userId, userText) {
  const blocks = [];
  const keywords = keywordsFrom(userText);

  try {
    const user = userId ? await repo.getUserById(userId) : null;
    const group = String(user?.group || '').trim().toUpperCase();
    if (group) {
      const cached = await duCache.getCachedGroupSchedule(group);
      const scheduleText = await formatScheduleForQuestion(cached?.schedule, userText, group);
      blocks.push(`Профиль студента: группа ${group}.\nРасписание группы в DU cache:\n${scheduleText}`);
    }
  } catch (err) {
    console.warn('AI DU group context error:', err.message || err);
  }

  try {
    const teachersPayload = await duCache.getCachedTeachers();
    const teachers = normalizeList(teachersPayload?.teachers);
    const relevant = teachers.filter((teacher) => matchesKeywords(teacher, keywords)).slice(0, 8);
    blocks.push(`DU cache преподавателей: всего ${teachers.length}. Релевантные:\n${relevant.map((teacher) => {
      const name = teacher.fullName || teacher.name || teacher.fio || [teacher.lastName, teacher.firstName].filter(Boolean).join(' ') || 'Преподаватель';
      const email = teacher.email || teacher.username || '';
      const position = teacher.position || teacher.department || teacher.school || '';
      return [name, email, position].filter(Boolean).join(' | ');
    }).join('\n') || 'не найдено по словам вопроса.'}`);
  } catch (err) {
    console.warn('AI DU teachers context error:', err.message || err);
  }

  try {
    const files = await duCache.getStaticSyllabusFiles();
    const relevant = files.filter((file) => matchesKeywords(file, keywords)).slice(0, 10);
    blocks.push(`Локальная база PDF-силлабусов: всего ${files.length}. Релевантные:\n${relevant.map((file) => {
      const title = file.title || file.originalFileName || file.fileName || 'Syllabus PDF';
      const meta = [file.academicYear, file.teacher, file.group, file.fileUrl ? 'есть PDF-ссылка' : 'нет ссылки'].filter(Boolean).join(' | ');
      return `${title}${meta ? ` | ${meta}` : ''}`;
    }).join('\n') || 'не найдено по словам вопроса.'}`);
  } catch (err) {
    console.warn('AI DU syllabus context error:', err.message || err);
  }

  return blocks.length ? `Контекст из нашей DU cache базы:\n${blocks.join('\n\n')}` : '';
}

function modelsToTry() {
  return [...new Set([
    process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash'
  ].filter(Boolean))];
}

function userFacingGeminiError(err) {
  const detail = err?.message ? String(err.message).slice(0, 240) : 'unknown';
  if (err?.status === 429 || /quota|rate|resource_exhausted/i.test(detail)) {
    return [
      'Сейчас уперлись в лимит Gemini API.',
      'Что можно сделать: подождать сброса квоты, указать другой GEMINI_API_KEY или включить billing/увеличить квоту в Google AI Studio.',
      `Деталь: ${detail}`
    ].join('\n');
  }
  if (err?.status === 400 || /not found|not supported|invalid/i.test(detail)) {
    return `Модель Gemini не приняла запрос. Проверь GEMINI_MODEL в .env. Деталь: ${detail}`;
  }
  return `Не удалось получить ответ от AI: ${detail}`;
}

async function generateAssistantReply({ userId, userText, history = [] }) {
  if (!process.env.GEMINI_API_KEY) {
    return 'AI не настроен: добавь GEMINI_API_KEY на сервере.';
  }

  const [calendarContext, duContext, webContext] = await Promise.all([
    buildCalendarContext(userId),
    buildDuCacheContext(userId, userText),
    buildWebSearchContext(userText)
  ]);
  const universityContext = buildUniversityKnowledgeContext();
  const dialog = formatHistoryForPrompt(history);
  const prompt = [
    universityContext,
    duContext,
    webContext,
    calendarContext ? `Контекст календаря:\n${calendarContext}` : '',
    dialog ? `Предыдущий диалог:\n${dialog}` : '',
    `Сообщение студента: ${userText}`
  ].filter(Boolean).join('\n\n');

  const generationConfig = {
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 650),
    temperature: Number(process.env.GEMINI_TEMPERATURE || 0.45)
  };

  let lastError = null;
  let quotaError = null;
  for (const modelName of modelsToTry()) {
    try {
      const model = getClient().getGenerativeModel({
        model: modelName,
        systemInstruction: UNIVERSITY_ONLY_SYSTEM_PROMPT
      });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig
      });
      return repairMojibakeText(result.response.text()?.trim() || 'Пустой ответ от модели.');
    } catch (err) {
      lastError = err;
      if (err.status === 429 || /quota|rate|resource_exhausted/i.test(String(err.message))) {
        quotaError = err;
      }
      console.error(`Gemini error (${modelName}):`, err.message || err);
      const retryable = err.status === 429 || /quota|rate|resource_exhausted|not found|not supported/i.test(String(err.message));
      if (!retryable) break;
    }
  }

  return userFacingGeminiError(quotaError || lastError);
}

module.exports = {
  SYSTEM_PROMPT,
  wantsAiReply,
  stripAiPrefix,
  repairMojibakeText,
  buildCalendarContext,
  generateAssistantReply
};
