const cron = require('node-cron');
const repo = require('./firestoreRepository');
const { deadlineUrgency, isDeadlineLike, timeLeftLabel } = require('./deadlineService');

const DEFAULT_TIMEZONE = process.env.TELEGRAM_TIMEZONE || 'Asia/Almaty';

function formatDateTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: DEFAULT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function notificationKey(userId, kind, event) {
  const raw = `${userId}:${kind}:${event.uid || event.start_time}:${event.title}`;
  return Buffer.from(raw).toString('base64url').slice(0, 180);
}

function eventLine(event) {
  const title = event.title || event.summary || event.discipline || 'Событие';
  const place = event.room || event.location ? `\nАудитория: ${event.room || event.location}` : '';
  return `${title}\n${formatDateTime(event.start_time)}${place}`;
}

function buildDeadlineNotification(event, settings) {
  const urgency = deadlineUrgency(event, new Date(), settings);
  return {
    kind: `deadline-${urgency.level}`,
    text: `${urgency.dot} Дедлайн ${urgency.label}: ${eventLine(event)}\nОсталось: ${timeLeftLabel(urgency.diffMs)}`
  };
}

function buildClassNotification(event) {
  const start = new Date(event.start_time);
  const diffMs = start - new Date();
  return {
    kind: 'class',
    text: `Напоминание о паре: ${eventLine(event)}\nДо начала: ${timeLeftLabel(diffMs)}`
  };
}

function notificationCandidates(events, settings = {}) {
  const now = new Date();
  const classMinutes = Number(settings.classReminderMinutes || 30);
  const deadlineHours = Number(settings.deadlineReminderHours || 24);

  return events
    .filter((event) => event.start_time && new Date(event.start_time) >= now)
    .map((event) => {
      const diffMs = new Date(event.start_time) - now;
      const diffMinutes = diffMs / 60000;
      const diffHours = diffMs / (60 * 60 * 1000);

      if (isDeadlineLike(event) && diffHours <= deadlineHours) {
        return { event, ...buildDeadlineNotification(event, settings) };
      }
      if (event.type === 'lecture' && classMinutes > 0 && diffMinutes <= classMinutes) {
        return { event, ...buildClassNotification(event) };
      }
      return null;
    })
    .filter(Boolean);
}

async function sendDueNotifications(bot) {
  const users = await repo.listTelegramNotificationUsers();
  for (const user of users) {
    try {
      const cache = await repo.getEventsCache(user._id);
      const candidates = notificationCandidates(cache.events || [], user.settings || {});
      for (const item of candidates) {
        const key = notificationKey(user._id, item.kind, item.event);
        if (await repo.hasNotification(key)) continue;

        await bot.telegram.sendMessage(user.telegram_id, item.text, { disable_web_page_preview: true });
        await repo.markNotificationSent(key, user._id, {
          kind: item.kind,
          event_uid: item.event.uid || '',
          event_title: item.event.title || '',
          event_time: item.event.start_time,
          channel: 'telegram'
        });
      }
    } catch (err) {
      console.error('Notification send error:', user._id, err.message);
    }
  }
}

function startNotificationScheduler(bot) {
  if (process.env.NOTIFICATIONS_ENABLED === 'false') {
    console.log('Notifications skipped: NOTIFICATIONS_ENABLED=false');
    return null;
  }

  const task = cron.schedule(process.env.NOTIFICATIONS_CRON || '*/10 * * * *', () => {
    sendDueNotifications(bot).catch((err) => console.error('Notification scheduler error:', err));
  });
  console.log('Notification scheduler started');
  return task;
}

module.exports = {
  notificationCandidates,
  sendDueNotifications,
  startNotificationScheduler
};
