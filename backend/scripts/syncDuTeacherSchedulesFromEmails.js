require('dotenv').config();

const duCache = require('../services/duCacheService');

async function main() {
  const cached = await duCache.getCachedTeachers();
  const teachers = cached?.teachers?.list || [];
  const emails = [...new Set(
    teachers
      .map((teacher) => String(teacher.email || '').trim().toLowerCase())
      .filter((email) => email.includes('@'))
  )].sort();

  let ok = 0;
  let nonEmpty = 0;
  const failures = [];

  console.log(`Teacher emails for schedule sync: ${emails.length}`);

  for (let index = 0; index < emails.length; index += 1) {
    const email = emails[index];
    try {
      const payload = await duCache.syncTeacherSchedule(email);
      const count = Array.isArray(payload.schedule) ? payload.schedule.length : 0;
      ok += 1;
      if (count > 0) nonEmpty += 1;
    } catch (err) {
      failures.push({ email, status: err.status || 500, error: err.message });
    }

    if ((index + 1) % 25 === 0 || index + 1 === emails.length) {
      console.log(JSON.stringify({
        progress: index + 1,
        total: emails.length,
        ok,
        nonEmpty,
        failures: failures.length
      }));
    }
  }

  console.log(JSON.stringify({
    emails: emails.length,
    ok,
    nonEmpty,
    empty: ok - nonEmpty,
    failures: failures.length
  }, null, 2));

  if (failures.length) console.log(JSON.stringify(failures.slice(0, 100), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
