const DEADLINE_TYPES = ['deadline', 'quiz', 'exam'];

function deadlineSettings(settings = {}) {
  return {
    urgentHours: Number(settings.urgentDeadlineHours || settings.deadlineUrgentHours || 6),
    soonHours: Number(settings.deadlineReminderHours || settings.deadlineSoonHours || 24)
  };
}

function deadlineUrgency(event, now = new Date(), settings = {}) {
  const start = new Date(event.start_time);
  const diffMs = start - now;
  const diffHours = diffMs / (60 * 60 * 1000);
  const thresholds = deadlineSettings(settings);

  if (diffMs < 0) return { level: 'overdue', color: 'red', dot: '🔴', label: 'просрочено', diffMs, diffHours };
  if (diffHours <= thresholds.urgentHours) return { level: 'urgent', color: 'red', dot: '🔴', label: 'горит', diffMs, diffHours };
  if (diffHours <= thresholds.soonHours) return { level: 'soon', color: 'yellow', dot: '🟡', label: 'скоро', diffMs, diffHours };
  return { level: 'later', color: 'green', dot: '🟢', label: 'есть время', diffMs, diffHours };
}

function timeLeftLabel(diffMs) {
  if (diffMs < 0) return 'срок прошел';

  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} ч ${restMinutes} мин` : `${hours} ч`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} д ${restHours} ч` : `${days} д`;
}

function isDeadlineLike(event) {
  return DEADLINE_TYPES.includes(event.type);
}

function sortByUrgency(events, now = new Date(), settings = {}) {
  const order = { overdue: 0, urgent: 1, soon: 2, later: 3 };
  return [...events].sort((a, b) => {
    const au = deadlineUrgency(a, now, settings);
    const bu = deadlineUrgency(b, now, settings);
    return (order[au.level] - order[bu.level]) || (new Date(a.start_time) - new Date(b.start_time));
  });
}

function decorateDeadline(event, now = new Date(), settings = {}) {
  const urgency = deadlineUrgency(event, now, settings);
  return {
    ...event,
    urgency: {
      ...urgency,
      timeLeft: timeLeftLabel(urgency.diffMs)
    }
  };
}

function upcomingDeadlines(events = [], now = new Date(), settings = {}) {
  return sortByUrgency(
    events
      .filter(isDeadlineLike)
      .filter((event) => new Date(event.start_time) >= now)
      .map((event) => decorateDeadline(event, now, settings)),
    now,
    settings
  );
}

module.exports = {
  DEADLINE_TYPES,
  deadlineSettings,
  deadlineUrgency,
  timeLeftLabel,
  isDeadlineLike,
  sortByUrgency,
  decorateDeadline,
  upcomingDeadlines
};
