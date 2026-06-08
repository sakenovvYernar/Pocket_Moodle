const express = require('express');
const router = express.Router();
const duCache = require('../services/duCacheService');

function normalizeTeacher(item = {}) {
  const fullName = [
    item.surnameRu || item.surnameEn || item.surnameKz || item.surname,
    item.nameRu || item.nameEn || item.nameKz || item.name,
    item.patronymicRu || item.patronymicEn || item.patronymicKz || item.patronymic
  ].filter(Boolean).join(' ');

  return {
    ...item,
    id: item.id || item.teacher_id,
    userId: item.userId || item.user_id,
    fullName: item.fullName || fullName,
    email: item.email || item.mail || item.corporateEmail || ''
  };
}

function pickEmail(...values) {
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const direct = [
      value.email,
      value.username,
      value.mail,
      value.corporateEmail,
      value.emailAddress,
      value.login
    ].find(Boolean);
    if (direct && String(direct).includes('@')) {
      return String(direct).trim().toLowerCase();
    }
  }
  return '';
}

function mergeCachedTeacherDocs(...docs) {
  const validDocs = docs.filter(Boolean);
  if (!validDocs.length) return null;

  return validDocs.reduce((acc, doc) => ({
    ...acc,
    ...doc,
    teacher: acc.teacher || doc.teacher || null,
    publicInfo: acc.publicInfo || doc.publicInfo || null,
    userInfo: acc.userInfo || doc.userInfo || null,
    email: acc.email || doc.email || ''
  }), {});
}

router.get('/', async (req, res) => {
  try {
    const cached = await duCache.getCachedTeachers();
    if (!cached) {
      return res.status(404).json({ error: 'Список преподавателей ещё не загружен в базу.' });
    }

    const list = Array.isArray(cached.teachers?.list)
      ? cached.teachers.list.map(normalizeTeacher)
      : [];
    res.json({
      teachers: {
        ...cached.teachers,
        list
      },
      updated_at: cached.updated_at,
      cached: true
    });
  } catch (err) {
    console.error('Cached teachers error:', err);
    res.status(500).json({ error: 'Не удалось прочитать преподавателей из базы.' });
  }
});

router.get('/schedule/by-email/:email', async (req, res) => {
  try {
    const cached = await duCache.getCachedTeacherSchedule(req.params.email);
    if (!cached) return res.status(404).json({ error: 'Расписание преподавателя ещё не загружено в базу.' });
    res.json({ schedule: cached.schedule, updated_at: cached.updated_at, cached: true });
  } catch (err) {
    console.error('Cached teacher schedule error:', err);
    res.status(500).json({ error: 'Не удалось прочитать расписание преподавателя из базы.' });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const cached = await duCache.getCachedTeacherDetail(req.params.userId);
    if (!cached) return res.status(404).json({ error: 'Данные преподавателя ещё не загружены в базу.' });
    res.json({ teacher: cached.teacher, updated_at: cached.updated_at, cached: true });
  } catch (err) {
    console.error('Cached teacher user error:', err);
    res.status(500).json({ error: 'Не удалось прочитать данные преподавателя из базы.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const cachedById = await duCache.getCachedTeacherDetail(req.params.id);
    const cachedByUserId = req.query.userId
      ? await duCache.getCachedTeacherDetail(req.query.userId)
      : null;
    const cached = mergeCachedTeacherDocs(cachedById, cachedByUserId);
    if (!cached) return res.status(404).json({ error: 'Детали преподавателя ещё не загружены в базу.' });
    const email = pickEmail(cached, cached.userInfo, cached.publicInfo, cached.teacher);
    const schedule = email ? await duCache.getCachedTeacherSchedule(email) : null;

    res.json({
      teacher: cached.teacher,
      publicInfo: cached.publicInfo || null,
      userInfo: cached.userInfo || null,
      email,
      schedule: schedule?.schedule || [],
      schedule_updated_at: schedule?.updated_at || null,
      updated_at: cached.updated_at,
      cached: true
    });
  } catch (err) {
    console.error('Cached teacher detail error:', err);
    res.status(500).json({ error: 'Не удалось прочитать детали преподавателя из базы.' });
  }
});

module.exports = router;
