const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const repo = require('../services/firestoreRepository');
const calendar = require('../services/calendarService');
const deadlines = require('../services/deadlineService');

router.post('/connect', authGuard, async (req, res) => {
  try {
    const { group, calendar_url } = req.body;
    if (!group || !calendar_url) {
      return res.status(400).json({ error: '������� ������ � Moodle Calendar URL' });
    }

    const user = await repo.updateUser(req.user._id, { group, calendar_url });
    const events = await calendar.refreshUserCalendar(user);

    res.json({
      user,
      events,
      summary: calendar.buildSummary(events)
    });
  } catch (err) {
    console.error('Calendar connect error:', err);
    res.status(err.status || 500).json({ error: err.message || '������ ���������' });
  }
});

router.post('/refresh', authGuard, async (req, res) => {
  try {
    if (!req.user.calendar_url) {
      return res.status(400).json({ error: '������� ���������� Moodle Calendar URL' });
    }

    const events = await calendar.refreshUserCalendar(req.user);
    res.json({ events, summary: calendar.buildSummary(events) });
  } catch (err) {
    console.error('Calendar refresh error:', err);
    res.status(err.status || 500).json({ error: err.message || '������ ���������' });
  }
});

router.get('/events', authGuard, async (req, res) => {
  const cache = await repo.getEventsCache(req.user._id);
  const events = calendar.filterEvents(cache.events || [], req.query);
  res.json({ events, updated_at: cache.updated_at || null });
});

router.get('/summary', authGuard, async (req, res) => {
  const cache = await repo.getEventsCache(req.user._id);
  res.json({
    summary: calendar.buildSummary(cache.events || []),
    updated_at: cache.updated_at || null
  });
});

router.get('/deadlines', authGuard, async (req, res) => {
  const cache = await repo.getEventsCache(req.user._id);
  const events = calendar.filterEvents(cache.events || [], {
    from: new Date().toISOString(),
    ...req.query
  });
  res.json({
    events: deadlines.upcomingDeadlines(events, new Date(), req.user.settings || {}),
    updated_at: cache.updated_at || null
  });
});

module.exports = router;
