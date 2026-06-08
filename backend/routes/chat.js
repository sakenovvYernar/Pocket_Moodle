const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const repo = require('../services/firestoreRepository');
const { generateAssistantReply, repairMojibakeText } = require('../services/aiService');
const scheduleService = require('../services/scheduleService');
const deadlines = require('../services/deadlineService');

function isDeadlineRequest(text) {
  return /(^\/deadlines\b|дедлайн|deadline|assignment|задани)/i.test(String(text || ''));
}

function isReadableScheduleRequest(text) {
  return /(^\/schedule\b|расписан|пары|пара|заняти|schedule|classes|сегодня|завтра|понедельник|вторник|сред|четверг|пятниц|суббот|воскрес)/i
    .test(String(text || ''));
}

function helpReply() {
  return [
    'Быстрые команды:',
    '/schedule - показать твое расписание',
    '/deadlines - ближайшие дедлайны',
    '/help - список команд',
    '',
    'Остальные вопросы по университету я передам AI. Он будет отвечать по базе знаний, расписанию, DU/Moodle данным и, если нужно, по web search.'
  ].join('\n');
}

async function resolveBasicReply(user, text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (/^\/(start|help|commands)\b|^(команды|помощь)$/i.test(normalized)) {
    return helpReply();
  }

  if (isReadableScheduleRequest(text) || scheduleService.isScheduleRequest(text)) {
    return scheduleService.getScheduleReply(user, text);
  }

  if (isDeadlineRequest(text)) {
    const cache = await repo.getEventsCache(user._id);
    const list = deadlines.upcomingDeadlines(cache.events || [], new Date(), user.settings || {}).slice(0, 10);
    if (!list.length) return 'Ближайших дедлайнов в Moodle Calendar пока не нашел.';
    return `Ближайшие дедлайны:\n\n${list.map((event, index) => {
      const title = event.title || event.summary || 'Без названия';
      const time = event.start_time ? new Date(event.start_time).toLocaleString('ru') : 'дата не указана';
      const left = event.urgency?.timeLeft ? `, осталось ${event.urgency.timeLeft}` : '';
      return `${index + 1}. ${title}\n   ${time}${left}`;
    }).join('\n\n')}`;
  }

  return '';
}

function normalizeChatText(chat) {
  if (!chat) return chat;
  return {
    ...chat,
    title: repairMojibakeText(chat.title),
    messages: (chat.messages || []).map((message) => ({
      ...message,
      content: repairMojibakeText(message.content)
    }))
  };
}

router.get('/', authGuard, async (req, res) => {
  try {
    const chats = await repo.listChats(req.user._id);
    res.json({ chats: chats.map(normalizeChatText) });
  } catch (err) {
    console.error('List chats error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/', authGuard, async (req, res) => {
  try {
    const chat = await repo.createChat(req.user._id);
    res.status(201).json({ chat });
  } catch (err) {
    console.error('Create chat error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id', authGuard, async (req, res) => {
  const chat = await repo.getChat(req.user._id, req.params.id);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  res.json({ chat: normalizeChatText(chat) });
});

router.delete('/:id', authGuard, async (req, res) => {
  await repo.deleteChat(req.user._id, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/message', authGuard, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Сообщение пустое' });
    }

    const chat = await repo.getChat(req.user._id, req.params.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });

    const userText = content.trim();
    const userMessage = { role: 'user', content: userText, time: new Date().toISOString() };
    const title = (!chat.title || chat.title === 'Новый чат') && chat.messages.length === 0
      ? userText.slice(0, 40) + (userText.length > 40 ? '...' : '')
      : chat.title;

    await repo.appendMessages(req.user._id, req.params.id, [userMessage], title);

    const freshUser = await repo.getUserById(req.user._id);
    const aiText = await resolveBasicReply(freshUser || req.user, userText) || await generateAssistantReply({
      userId: req.user._id,
      userText,
      history: chat.messages
    });
    const botMessage = { role: 'assistant', content: aiText, time: new Date().toISOString() };

    await repo.appendMessages(req.user._id, req.params.id, [botMessage], title);

    res.json({ userMessage, botMessage, chatTitle: title });
  } catch (err) {
    console.error('Chat AI error:', err);
    res.status(500).json({ error: 'Ошибка при обращении к AI: ' + err.message });
  }
});

module.exports = router;
