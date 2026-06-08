require('dotenv').config();

const { db, admin } = require('../config/firebase');

const TEACHERS = 'du_teachers';

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
  return direct && String(direct).includes('@')
    ? String(direct).trim().toLowerCase()
    : '';
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function main() {
  const allRef = db.collection(TEACHERS).doc('all');
  const allSnap = await allRef.get();
  if (!allSnap.exists) {
    throw new Error('du_teachers/all is missing. Run resetAndSyncDuTeachers.js again.');
  }

  const allData = allSnap.data() || {};
  const list = allData.teachers?.list || [];
  const userIds = list.map((teacher) => teacher.userId || teacher.user_id).filter(Boolean);
  const refs = userIds.map((userId) => db.collection(TEACHERS).doc(docId(userId)));
  const userDocs = [];

  for (const chunk of chunks(refs, 250)) {
    userDocs.push(...await db.getAll(...chunk));
  }

  const byUserId = new Map();
  userDocs.forEach((snap, index) => {
    if (snap.exists) byUserId.set(String(userIds[index]), snap.data());
  });

  let withEmail = 0;
  const compactList = list.map((teacher) => {
    const userId = teacher.userId || teacher.user_id;
    const cached = byUserId.get(String(userId)) || null;
    const userInfo = cached?.userInfo || null;
    const email = pickEmail(teacher) || pickEmail(cached) || pickEmail(userInfo);
    if (email) withEmail += 1;

    return {
      ...teacher,
      email,
      userInfo
    };
  });

  const updatedAt = new Date().toISOString();
  await allRef.set({
    teachers: {
      ...allData.teachers,
      list: compactList,
      total_number: allData.teachers?.total_number || compactList.length
    },
    source: allData.source,
    sync: {
      ...(allData.sync || {}),
      finalized_at: updatedAt,
      withEmail,
      withoutEmail: compactList.length - withEmail
    },
    updated_at: updatedAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: false });

  await db.collection('du_cache_meta').doc('teachers').set({
    itemCount: compactList.length,
    withEmail,
    withoutEmail: compactList.length - withEmail,
    updated_at: updatedAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(JSON.stringify({
    total: compactList.length,
    withEmail,
    withoutEmail: compactList.length - withEmail
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
