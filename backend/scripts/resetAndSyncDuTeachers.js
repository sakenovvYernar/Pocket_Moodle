require('dotenv').config();

const { db, admin } = require('../config/firebase');
const duCache = require('../services/duCacheService');

const TEACHERS = 'du_teachers';
const TEACHER_SCHEDULES = 'du_teacher_schedules';

function docId(value = '') {
  return Buffer.from(String(value || '').trim().toLowerCase()).toString('base64url');
}

function pickEmail(value) {
  if (!value || typeof value !== 'object') return '';

  const direct = [
    value.email,
    value.username,
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

async function deleteCollection(name) {
  let deleted = 0;

  while (true) {
    const snap = await db.collection(name).limit(350).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    deleted += snap.size;
    console.log(`Deleted ${deleted} docs from ${name}`);
  }

  return deleted;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log('Resetting DU teacher cache collections...');

  const deletedTeacherSchedules = await deleteCollection(TEACHER_SCHEDULES);
  const deletedTeachers = await deleteCollection(TEACHERS);
  console.log(JSON.stringify({ deletedTeachers, deletedTeacherSchedules }, null, 2));

  console.log('Loading teacher list from DU...');
  const listPayload = await duCache.syncTeachers();
  const teachers = listPayload.teachers?.list || [];
  console.log(`Teacher list saved: ${teachers.length}`);

  const enriched = [];
  const failures = [];
  let detailsOk = 0;
  let publicOk = 0;
  let userInfoOk = 0;
  let withEmail = 0;

  for (let index = 0; index < teachers.length; index += 1) {
    const teacher = teachers[index];
    const teacherId = teacher.id || teacher.teacher_id;
    const userId = teacher.userId || teacher.user_id;
    let email = pickEmail(teacher);
    let detail = null;
    let publicInfo = null;
    let userInfo = null;

    if (teacherId) {
      try {
        const payload = await duCache.syncTeacherDetail(teacherId);
        detail = payload.teacher || null;
        email = pickEmail(detail) || email;
        detailsOk += 1;
      } catch (err) {
        failures.push({ type: 'detail', teacherId, status: err.status || 500, error: err.message });
      }
    }

    if (userId) {
      try {
        const payload = await duCache.syncTeacherPublicInfo(userId);
        publicInfo = payload.publicInfo || null;
        email = pickEmail(publicInfo) || email;
        publicOk += 1;
      } catch (err) {
        failures.push({ type: 'publicInfo', userId, status: err.status || 500, error: err.message });
      }

      try {
        const payload = await duCache.syncTeacherUserInfo(userId, teacherId);
        userInfo = payload.userInfo || null;
        email = pickEmail(userInfo) || pickEmail(payload) || email;
        userInfoOk += 1;
      } catch (err) {
        failures.push({ type: 'userInfo', userId, status: err.status || 500, error: err.message });
      }
    }

    if (email) withEmail += 1;

    const updatedAt = new Date().toISOString();
    const mergePayload = {
      email,
      userInfo,
      updated_at: updatedAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (teacherId || userId) {
      const batch = db.batch();
      if (teacherId) batch.set(db.collection(TEACHERS).doc(docId(teacherId)), mergePayload, { merge: true });
      if (userId) batch.set(db.collection(TEACHERS).doc(docId(userId)), mergePayload, { merge: true });
      await batch.commit();
    }

    enriched.push({
      ...teacher,
      email,
      userInfo
    });

    if ((index + 1) % 25 === 0 || index + 1 === teachers.length) {
      console.log(JSON.stringify({
        progress: index + 1,
        total: teachers.length,
        detailsOk,
        publicOk,
        userInfoOk,
        withEmail,
        failures: failures.length
      }));
    }
  }

  console.log('Writing enriched teacher list...');
  const finishedAt = new Date().toISOString();
  await db.collection(TEACHERS).doc('all').set({
    teachers: {
      ...listPayload.teachers,
      list: enriched,
      total_number: listPayload.teachers?.total_number || enriched.length
    },
    source: listPayload.source,
    sync: {
      started_at: startedAt,
      finished_at: finishedAt,
      detailsOk,
      publicOk,
      userInfoOk,
      withEmail,
      failures: failures.length
    },
    updated_at: finishedAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: false });

  await db.collection('du_cache_meta').doc('teachers').set({
    itemCount: enriched.length,
    withEmail,
    failures: failures.length,
    updated_at: finishedAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  const summary = {
    teachers: enriched.length,
    detailsOk,
    publicOk,
    userInfoOk,
    withEmail,
    withoutEmail: enriched.length - withEmail,
    failures: failures.length
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) console.log(JSON.stringify(failures.slice(0, 100), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
