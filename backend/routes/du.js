const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const repo = require('../services/firestoreRepository');
const duCache = require('../services/duCacheService');

function normalizeGroup(value = '') {
  return String(value || '').trim().toUpperCase();
}

function syncAllowed(req) {
  const secret = process.env.DU_SYNC_SECRET;
  if (!secret) return true;
  if (req.user?.role === 'admin') return true;
  return req.headers['x-du-sync-secret'] === secret;
}

function requireSyncAccess(req, res) {
  if (syncAllowed(req)) return true;
  res.status(403).json({ error: 'Недостаточно прав для синхронизации DU cache.' });
  return false;
}

function cacheMiss(res, noun, hint = '') {
  res.status(404).json({
    error: `${noun} ещё не загружены в базу.${hint ? ` ${hint}` : ''}`,
    cached: false
  });
}

function syncToken(req) {
  return req.body?.duToken || req.headers['x-du-token'] || '';
}

router.get('/schedule/group/:groupName', authGuard, async (req, res) => {
  try {
    const group = normalizeGroup(req.params.groupName);
    if (!group) return res.status(400).json({ error: 'Укажи группу.' });

    const cached = await duCache.getCachedGroupSchedule(group);
    if (!cached) return cacheMiss(res, 'Расписание группы', 'Запусти POST /api/du/cache/schedules.');
    res.json({ ...cached, cached: true });
  } catch (err) {
    console.error('DU cached group schedule error:', err);
    res.status(500).json({ error: 'Не удалось прочитать расписание из базы.' });
  }
});

router.get('/schedule/me', authGuard, async (req, res) => {
  try {
    const user = await repo.getUserById(req.user._id);
    const group = normalizeGroup(user?.group || req.user.group);
    if (!group) return res.status(400).json({ error: 'В профиле не указана группа.' });

    const cached = await duCache.getCachedGroupSchedule(group);
    if (!cached) return cacheMiss(res, 'Расписание группы', `Группа: ${group}.`);
    res.json({ ...cached, cached: true });
  } catch (err) {
    console.error('DU cached my schedule error:', err);
    res.status(500).json({ error: 'Не удалось прочитать расписание из базы.' });
  }
});

router.get('/teacher-schedule/:email', authGuard, async (req, res) => {
  try {
    const cached = await duCache.getCachedTeacherSchedule(req.params.email);
    if (!cached) return cacheMiss(res, 'Расписание преподавателя', 'Запусти POST /api/du/cache/teacher-schedules.');
    res.json({ ...cached, cached: true });
  } catch (err) {
    console.error('DU cached teacher schedule error:', err);
    res.status(500).json({ error: 'Не удалось прочитать расписание преподавателя из базы.' });
  }
});

router.get('/syllabus/all', authGuard, async (req, res) => {
  try {
    const cached = await duCache.getCachedSyllabuses();
    const staticFiles = await duCache.getStaticSyllabusFiles();
    const duSyllabuses = Array.isArray(cached?.syllabuses) ? cached.syllabuses : [];
    const staticSyllabuses = staticFiles.map((file) => ({
      ...file,
      id: `static:${file.id}`,
      source: 'static-file'
    }));

    if (!cached && !staticSyllabuses.length) return cacheMiss(res, 'Силлабусы', 'Запусти POST /api/du/cache/syllabuses.');
    res.json({
      syllabuses: [...staticSyllabuses, ...duSyllabuses],
      updated_at: cached?.updated_at || staticFiles[0]?.uploaded_at || null,
      cached: true
    });
  } catch (err) {
    console.error('DU cached syllabus list error:', err);
    res.status(500).json({ error: 'Не удалось прочитать силлабусы из базы.' });
  }
});

router.get('/syllabus/data/:id', authGuard, async (req, res) => {
  try {
    if (String(req.params.id).startsWith('static:')) {
      const file = await duCache.getStaticSyllabusFile(String(req.params.id).slice('static:'.length));
      if (!file) return cacheMiss(res, 'Файл силлабуса', 'Файл не найден в нашей базе.');
      return res.json({ syllabus: { file, type: 'static-file' }, updated_at: file.uploaded_at, cached: true });
    }

    const cached = await duCache.getCachedSyllabusDetail(req.params.id);
    if (!cached) return cacheMiss(res, 'Детали силлабуса', 'Сначала синхронизируй детали этого силлабуса.');
    res.json({ syllabus: cached.syllabus, updated_at: cached.updated_at, cached: true });
  } catch (err) {
    console.error('DU cached syllabus detail error:', err);
    res.status(500).json({ error: 'Не удалось прочитать детали силлабуса из базы.' });
  }
});

router.post('/cache/schedules', authGuard, async (req, res) => {
  if (!requireSyncAccess(req, res)) return;
  try {
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    if (!groups.length) return res.status(400).json({ error: 'Передай groups: ["SE-2309", ...].' });
    const results = await duCache.syncGroupSchedules(groups, { duToken: syncToken(req) });
    res.json({ ok: true, results });
  } catch (err) {
    console.error('DU group schedules sync error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось синхронизировать расписания групп.' });
  }
});

router.post('/cache/schedules/known', authGuard, async (req, res) => {
  if (!requireSyncAccess(req, res)) return;
  try {
    const results = await duCache.syncKnownGroupSchedules({ duToken: syncToken(req) });
    res.json({ ok: true, results });
  } catch (err) {
    console.error('DU known group schedules sync error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось синхронизировать известные группы.' });
  }
});

router.post('/cache/teacher-schedules', authGuard, async (req, res) => {
  if (!requireSyncAccess(req, res)) return;
  try {
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];
    if (!emails.length) return res.status(400).json({ error: 'Передай emails: ["teacher@astanait.edu.kz", ...].' });
    const results = await duCache.syncTeacherSchedules(emails, { duToken: syncToken(req) });
    res.json({ ok: true, results });
  } catch (err) {
    console.error('DU teacher schedules sync error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось синхронизировать расписания преподавателей.' });
  }
});

router.post('/cache/syllabuses', authGuard, async (req, res) => {
  if (!requireSyncAccess(req, res)) return;
  try {
    const data = await duCache.syncSyllabuses({ duToken: syncToken(req) });
    res.json({ ok: true, updated_at: data.updated_at });
  } catch (err) {
    console.error('DU syllabuses sync error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось синхронизировать силлабусы.' });
  }
});

router.post('/cache/syllabus-details', authGuard, async (req, res) => {
  if (!requireSyncAccess(req, res)) return;
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'Передай ids: ["...", ...].' });
    const results = await duCache.syncSyllabusDetails(ids, { duToken: syncToken(req) });
    res.json({ ok: true, results });
  } catch (err) {
    console.error('DU syllabus details sync error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось синхронизировать детали силлабусов.' });
  }
});

module.exports = router;
