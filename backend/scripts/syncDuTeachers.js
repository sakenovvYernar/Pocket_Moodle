require('dotenv').config();

const duCache = require('../services/duCacheService');

function pickEmail(value) {
  if (!value || typeof value !== 'object') return '';
  const direct = [
    value.email,
    value.mail,
    value.corporateEmail,
    value.emailAddress,
    value.login
  ].find(Boolean);
  if (direct && String(direct).includes('@')) return String(direct).trim().toLowerCase();

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = pickEmail(item);
        if (found) return found;
      }
    } else if (nested && typeof nested === 'object') {
      const found = pickEmail(nested);
      if (found) return found;
    }
  }
  return '';
}

async function main() {
  console.log('Syncing DU teacher list...');
  const listPayload = await duCache.syncTeachers();
  const teachers = listPayload.teachers.list || [];
  console.log(`Teacher list saved: ${teachers.length}`);

  let detailsOk = 0;
  let publicOk = 0;
  let userInfoOk = 0;
  let schedulesOk = 0;
  const emails = new Set();
  const failures = [];

  for (let index = 0; index < teachers.length; index += 1) {
    const teacher = teachers[index];
    const id = teacher.id || teacher.teacher_id;
    const userId = teacher.userId || teacher.user_id;

    try {
      if (id) {
        const detail = await duCache.syncTeacherDetail(id);
        detailsOk += 1;
        const email = pickEmail(detail.teacher);
        if (email) emails.add(email);
      }
    } catch (err) {
      failures.push({ type: 'detail', id, status: err.status || 500, error: err.message });
    }

    try {
      if (userId) {
        const publicInfo = await duCache.syncTeacherPublicInfo(userId);
        publicOk += 1;
        const email = pickEmail(publicInfo.publicInfo);
        if (email) emails.add(email);
      }
    } catch (err) {
      failures.push({ type: 'publicInfo', userId, status: err.status || 500, error: err.message });
    }

    try {
      if (userId) {
        const userInfo = await duCache.syncTeacherUserInfo(userId, id);
        userInfoOk += 1;
        const email = pickEmail(userInfo.userInfo) || userInfo.email;
        if (email) emails.add(email);
      }
    } catch (err) {
      failures.push({ type: 'userInfo', userId, status: err.status || 500, error: err.message });
    }

    const listEmail = pickEmail(teacher);
    if (listEmail) emails.add(listEmail);

    if ((index + 1) % 50 === 0) {
      console.log(`Progress ${index + 1}/${teachers.length}; details=${detailsOk}; public=${publicOk}; userInfo=${userInfoOk}; emails=${emails.size}`);
    }
  }

  console.log(`Syncing teacher schedules for ${emails.size} discovered emails...`);
  for (const email of emails) {
    try {
      await duCache.syncTeacherSchedule(email);
      schedulesOk += 1;
    } catch (err) {
      failures.push({ type: 'schedule', email, status: err.status || 500, error: err.message });
    }
  }

  const summary = {
    teachers: teachers.length,
    detailsOk,
    publicOk,
    userInfoOk,
    emails: emails.size,
    schedulesOk,
    failures: failures.length
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) {
    console.log(JSON.stringify(failures.slice(0, 100), null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
