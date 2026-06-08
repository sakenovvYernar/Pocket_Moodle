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

async function getDocsByIds(ids) {
  const refs = ids.map((id) => db.collection(TEACHERS).doc(docId(id)));
  const docs = [];
  for (const chunk of chunks(refs, 250)) {
    docs.push(...await db.getAll(...chunk));
  }
  return docs;
}

async function main() {
  const allOnly = process.argv.includes('--all-only');
  const fromDu = process.argv.includes('--from-du');
  const emailOnly = process.argv.includes('--email-only');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) || 0 : 0;
  const allRef = db.collection(TEACHERS).doc('all');
  console.log('Reading du_teachers/all...');
  const allSnap = await allRef.get();
  const allData = allSnap.data() || {};
  const fullList = allData.teachers?.list || [];
  const list = limit > 0 ? fullList.slice(0, limit) : fullList;
  console.log(`Teachers selected: ${list.length}/${fullList.length}`);
  const byUserId = fromDu ? await fetchUserInfoFromDu(list) : new Map();

  if (!fromDu) {
    const userIds = list.map((teacher) => teacher.userId || teacher.user_id).filter(Boolean);
    const userDocs = await getDocsByIds(userIds);
    userDocs.forEach((snap, index) => {
      if (snap.exists) byUserId.set(String(userIds[index]), snap.data());
    });
  }

  let withEmail = 0;
  let withoutEmail = 0;
  const updatedAt = new Date().toISOString();
  const updatedList = list.map((teacher) => {
    const userId = teacher.userId || teacher.user_id;
    const userDoc = byUserId.get(String(userId)) || null;
    const userInfo = fromDu ? userDoc : userDoc?.userInfo;
    const email = pickEmail(teacher) || pickEmail(userDoc) || pickEmail(userInfo);
    if (email) withEmail += 1;
    else withoutEmail += 1;

    return emailOnly
      ? { ...teacher, email }
      : { ...teacher, email, userInfo: userInfo || teacher.userInfo || null };
  });

  if (!allOnly) {
    for (const chunk of chunks(updatedList, 100)) {
      const batch = db.batch();
      chunk.forEach((teacher) => {
        const teacherId = teacher.id || teacher.teacher_id;
        const userId = teacher.userId || teacher.user_id;
        const payload = {
          email: teacher.email || '',
          updated_at: updatedAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (!emailOnly) payload.userInfo = teacher.userInfo || null;
        if (teacherId) batch.set(db.collection(TEACHERS).doc(docId(teacherId)), payload, { merge: true });
        if (userId) batch.set(db.collection(TEACHERS).doc(docId(userId)), payload, { merge: true });
      });
      await batch.commit();
    }
  }

  const finalList = limit > 0
    ? [...updatedList, ...fullList.slice(limit)]
    : updatedList;

  console.log('Writing du_teachers/all...');
  await allRef.set({
    teachers: {
      ...allData.teachers,
      list: finalList
    },
    updated_at: updatedAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(JSON.stringify({
    total: list.length,
    fullTotal: fullList.length,
    withEmail,
    withoutEmail,
    allOnly,
    fromDu,
    emailOnly
  }, null, 2));
}

async function fetchUserInfoFromDu(list) {
  const result = new Map();
  const queue = list
    .map((teacher) => teacher.userId || teacher.user_id)
    .filter(Boolean)
    .map(String);
  let ok = 0;
  let failed = 0;
  console.log(`Fetching user info from DU: ${queue.length}`);

  for (const userId of queue) {
    try {
      const data = await fetchUserInfo(userId);
      result.set(userId, data);
      ok += 1;
    } catch (err) {
      failed += 1;
    }

    if ((ok + failed) % 25 === 0 || ok + failed === queue.length) {
      console.log(JSON.stringify({ fetched: ok + failed, total: queue.length, ok, failed }));
    }
  }

  return result;
}

async function fetchUserInfo(userId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const url = new URL('/astanait-authorization-module/api/v1/auth/get-user-by-id', process.env.DU_API_BASE_URL || 'https://du.astanait.edu.kz:8765');
    url.searchParams.set('user_id', userId);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...(process.env.DU_TOKEN ? { Authorization: `Bearer ${String(process.env.DU_TOKEN).replace(/^Bearer\s+/i, '').trim()}` } : {}),
        Origin: 'https://du.astanait.edu.kz',
        Referer: 'https://du.astanait.edu.kz/'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data && typeof data === 'object' && 'body' in data ? data.body : data;
  } finally {
    clearTimeout(timer);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
