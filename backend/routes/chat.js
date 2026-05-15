const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const router = express.Router();
const authGuard = require('../middleware/auth');
const repo = require('../services/firestoreRepository');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SYSTEM_PROMPT = `Ты UniBot, AI-ассистент для студентов Astana IT University.

Помогай по учебным вопросам, расписанию, дедлайнам, навигации по Mini App и общим вопросам университета.
Если у пользователя есть календарь Moodle, учитывай события из него: пары, дедлайны, квизы и экзамены.
Отвечай на русском, если пользователь не попросил другой язык. Пиши кратко, понятно и без выдуманных фактов.`;

async function buildCalendarContext(userId) {
  const cache = await repo.getEventsCache(userId);
  const upcoming = (cache.events || [])
    .filter((event) => new Date(event.start_time) >= new Date())
    .slice(0, 10)
    .map((event) => `${event.type}: ${event.title} (${event.start_time})`)
    .join('\n');

  return upcoming ? `\n\nБлижайшие события пользователя:\n${upcoming}` : '';
}

router.get('/', authGuard, async (req, res) => {
  try {
    const chats = await repo.listChats(req.user._id);
    res.json({ chats });
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
  res.json({ chat });
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
    const title = chat.title === 'Новый чат' && chat.messages.length === 0
      ? userText.slice(0, 40) + (userText.length > 40 ? '...' : '')
      : chat.title;

    await repo.appendMessages(req.user._id, req.params.id, [userMessage], title);

    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
    const calendarContext = await buildCalendarContext(req.user._id);
    const history = chat.messages.slice(-20).map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));

    const geminiChat = model.startChat({
      history,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
    });

    const result = await geminiChat.sendMessage(`${SYSTEM_PROMPT}${calendarContext}\n\nПользователь: ${userText}`);
    const aiText = result.response.text() || 'Не удалось получить ответ.';
    const botMessage = { role: 'assistant', content: aiText, time: new Date().toISOString() };

    await repo.appendMessages(req.user._id, req.params.id, [botMessage], title);

    res.json({ userMessage, botMessage, chatTitle: title });
  } catch (err) {
    console.error('Chat AI error:', err);
    res.status(500).json({ error: 'Ошибка при обращении к AI: ' + err.message });
  }
});

module.exports = router;
