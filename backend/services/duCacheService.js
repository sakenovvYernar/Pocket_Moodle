const { db, admin } = require('../config/firebase');

const DU_API_BASE_URL = process.env.DU_API_BASE_URL || 'https://du.astanait.edu.kz:8765';
const GROUP_SCHEDULES = 'du_group_schedules';
const TEACHERS = 'du_teachers';
const TEACHER_SCHEDULES = 'du_teacher_schedules';
const SYLLABUSES = 'du_syllabuses';
const SYLLABUS_FILES = 'syllabus_files';
const META = 'du_cache_meta';

function nowIso() {
  return new Date().toISOString();
}

function normalizeGroup(value = '') {
  return String(value || '').trim().toUpperCase();
}

function docId(value = '') {
  return Buffer.from(String(value || '').trim().toLowerCase()).toString('base64url');
}

function cleanToken(value = '') {
  return String(value || '').replace(/^Bearer\s+/i, '').trim();
}

function serverDuToken(override = '') {
  return cleanToken(override || process.env.DU_TOKEN || '');
}

function requireDuToken(override = '') {
  const token = serverDuToken(override);
  if (!token) {
    const err = new Error('DU_TOKEN is not configured');
    err.status = 400;
    throw err;
  }
  return token;
}

function buildUrl(path, query = {}) {
  const url = new URL(path, DU_API_BASE_URL);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function fetchDuJson(path, { duToken = '', query = {} } = {}) {
  const token = requireDuToken(duToken);
  const response = await fetch(buildUrl(path, query), {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      Authorization: `Bearer ${token}`,
      Origin: 'https://du.astanait.edu.kz',
      Referer: 'https://du.astanait.edu.kz/',
      'User-Agent': 'Mozilla/5.0'
    }
  });
  const text = await response.text();

  if (!response.ok) {
    const err = new Error(text || `DU API HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = text ? JSON.parse(text) : null;
  if (data && typeof data === 'object' && 'body' in data && 'statusCodeValue' in data) {
    return data.body;
  }
  return data;
}

async function fetchPublicDuJson(path, { query = {} } = {}) {
  const response = await fetch(buildUrl(path, query), {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      Origin: 'https://du.astanait.edu.kz',
      Referer: 'https://du.astanait.edu.kz/',
      'User-Agent': 'Mozilla/5.0'
    }
  });
  const text = await response.text();

  if (!response.ok) {
    const err = new Error(text || `DU API HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = text ? JSON.parse(text) : null;
  if (data && typeof data === 'object' && 'body' in data && 'statusCodeValue' in data) {
    return data.body;
  }
  return data;
}

async function setMeta(key, data) {
  await db.collection(META).doc(key).set({
    ...data,
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function getCachedGroupSchedule(groupName) {
  const group = normalizeGroup(groupName);
  if (!group) return null;
  const snap = await db.collection(GROUP_SCHEDULES).doc(group).get();
  return snap.exists ? snap.data() : null;
}

async function deleteCachedGroupSchedule(groupName) {
  const group = normalizeGroup(groupName);
  if (!group) return;
  await db.collection(GROUP_SCHEDULES).doc(group).delete();
}

async function syncGroupSchedule(groupName, options = {}) {
  const group = normalizeGroup(groupName);
  if (!group) {
    const err = new Error('Group name is required');
    err.status = 400;
    throw err;
  }

  const path = `/astanait-schedule-module/api/v1/schedule/groupName/${encodeURIComponent(group)}`;
  const schedule = await fetchDuJson(path, options);
  const payload = {
    group,
    schedule,
    source: { type: 'du', path },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(GROUP_SCHEDULES).doc(group).set(payload, { merge: true });
  return payload;
}

async function syncGroupSchedules(groups = [], options = {}) {
  const unique = [...new Set(groups.map(normalizeGroup).filter(Boolean))];
  const results = [];
  for (const group of unique) {
    try {
      const data = await syncGroupSchedule(group, options);
      results.push({ group, ok: true, itemCount: countItems(data.schedule) });
    } catch (err) {
      results.push({ group, ok: false, status: err.status || 500, error: err.message });
    }
  }
  await setMeta('group_schedules', { total: results.length, ok: results.filter((item) => item.ok).length });
  return results;
}

async function listKnownGroups() {
  const snap = await db.collection('users').get();
  return [...new Set(snap.docs.map((doc) => normalizeGroup(doc.data().group)).filter(Boolean))].sort();
}

async function syncKnownGroupSchedules(options = {}) {
  const groups = await listKnownGroups();
  return syncGroupSchedules(groups, options);
}

async function getCachedTeacherSchedule(email) {
  const id = docId(email);
  if (!id) return null;
  const snap = await db.collection(TEACHER_SCHEDULES).doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function getCachedTeachers() {
  const snap = await db.collection(TEACHERS).doc('all').get();
  return snap.exists ? snap.data() : null;
}

async function getCachedTeacherDetail(id) {
  const snap = await db.collection(TEACHERS).doc(docId(id)).get();
  return snap.exists ? snap.data() : null;
}

async function syncTeachers(options = {}) {
  const firstPath = '/astanait-teacher-module/api/v1/teacher/pps/get-all-teachers';
  const firstPage = await fetchDuJson(firstPath, { ...options, query: { page: 0 } });
  const pageCount = Number(firstPage?.number_of_pages || 1);
  const list = Array.isArray(firstPage?.list) ? [...firstPage.list] : [];

  for (let page = 1; page < pageCount; page += 1) {
    const data = await fetchDuJson(firstPath, { ...options, query: { page } });
    if (Array.isArray(data?.list)) list.push(...data.list);
  }

  const payload = {
    teachers: {
      ...firstPage,
      list,
      current_page: 0,
      loaded_pages: pageCount,
      total_number: firstPage?.total_number || list.length
    },
    source: { type: 'du', path: firstPath },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(TEACHERS).doc('all').set(payload, { merge: true });

  const batchSize = 400;
  for (let index = 0; index < list.length; index += batchSize) {
    const batch = db.batch();
    list.slice(index, index + batchSize).forEach((teacher) => {
      const id = teacher.id || teacher.teacher_id || teacher.userId || teacher.email;
      if (!id) return;
      batch.set(db.collection(TEACHERS).doc(docId(id)), {
        id: String(id),
        teacher,
        updated_at: payload.updated_at,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();
  }

  await setMeta('teachers', { itemCount: list.length, pages: pageCount });
  return payload;
}

async function syncTeacherDetail(id, options = {}) {
  const cleanId = String(id || '').trim();
  if (!cleanId) {
    const err = new Error('Teacher id is required');
    err.status = 400;
    throw err;
  }

  const path = '/astanait-teacher-module/api/v1/teacher/pps/get-teacher-info';
  const teacher = await fetchDuJson(path, { ...options, query: { teacher_id: cleanId } });
  const payload = {
    id: cleanId,
    teacher,
    source: { type: 'du', path, query: { teacher_id: cleanId } },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(TEACHERS).doc(docId(cleanId)).set(payload, { merge: true });
  return payload;
}

async function syncTeacherPublicInfo(userId, options = {}) {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) {
    const err = new Error('Teacher userId is required');
    err.status = 400;
    throw err;
  }

  const path = '/astanait-teacher-module/api/v1/teacher/pps/get-teacher-by-user-id';
  const publicInfo = await fetchDuJson(path, { ...options, query: { user_id: cleanUserId } });
  const teacherId = publicInfo?.id || cleanUserId;
  const payload = {
    id: String(teacherId),
    userId: cleanUserId,
    publicInfo,
    sourcePublic: { type: 'du', path, query: { user_id: cleanUserId } },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(TEACHERS).doc(docId(teacherId)).set(payload, { merge: true });
  await db.collection(TEACHERS).doc(docId(cleanUserId)).set(payload, { merge: true });
  return payload;
}

async function syncTeacherUserInfo(userId, teacherId = '') {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) {
    const err = new Error('Teacher userId is required');
    err.status = 400;
    throw err;
  }

  const path = '/astanait-authorization-module/api/v1/auth/get-user-by-id';
  const userInfo = await fetchPublicDuJson(path, { query: { user_id: cleanUserId } });
  const payload = {
    userId: cleanUserId,
    userInfo,
    email: userInfo?.username || '',
    sourceUser: { type: 'du', path, query: { user_id: cleanUserId } },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(TEACHERS).doc(docId(cleanUserId)).set(payload, { merge: true });
  if (teacherId) {
    await db.collection(TEACHERS).doc(docId(teacherId)).set(payload, { merge: true });
  }
  return payload;
}

async function syncTeacherDetails(ids = [], options = {}) {
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  const results = [];
  for (const id of unique) {
    try {
      await syncTeacherDetail(id, options);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, status: err.status || 500, error: err.message });
    }
  }
  await setMeta('teacher_details', { total: results.length, ok: results.filter((item) => item.ok).length });
  return results;
}

async function syncTeacherSchedule(email, options = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const err = new Error('Teacher email is required');
    err.status = 400;
    throw err;
  }

  const path = `/astanait-schedule-module/api/v1/schedule/tutorEmail/${encodeURIComponent(normalizedEmail)}`;
  const schedule = await fetchDuJson(path, options);
  const payload = {
    email: normalizedEmail,
    schedule,
    source: { type: 'du', path },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(TEACHER_SCHEDULES).doc(docId(normalizedEmail)).set(payload, { merge: true });
  return payload;
}

async function syncTeacherSchedules(emails = [], options = {}) {
  const unique = [...new Set(emails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
  const results = [];
  for (const email of unique) {
    try {
      const data = await syncTeacherSchedule(email, options);
      results.push({ email, ok: true, itemCount: countItems(data.schedule) });
    } catch (err) {
      results.push({ email, ok: false, status: err.status || 500, error: err.message });
    }
  }
  await setMeta('teacher_schedules', { total: results.length, ok: results.filter((item) => item.ok).length });
  return results;
}

async function getCachedSyllabuses() {
  const snap = await db.collection(SYLLABUSES).doc('all').get();
  return snap.exists ? snap.data() : null;
}

async function getStaticSyllabusFiles() {
  const snap = await db.collection(SYLLABUS_FILES).orderBy('title').get();
  return snap.docs.map((doc) => doc.data());
}

async function getStaticSyllabusFile(id) {
  const snap = await db.collection(SYLLABUS_FILES).doc(String(id || '')).get();
  return snap.exists ? snap.data() : null;
}

async function getCachedSyllabusDetail(id) {
  const snap = await db.collection(SYLLABUSES).doc(docId(id)).get();
  return snap.exists ? snap.data() : null;
}

async function syncSyllabuses(options = {}) {
  const path = '/astanait-office-module/api/v1/syllabus/all';
  const syllabuses = await fetchDuJson(path, options);
  const payload = {
    syllabuses,
    source: { type: 'du', path },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(SYLLABUSES).doc('all').set(payload, { merge: true });
  await setMeta('syllabuses', { itemCount: countItems(syllabuses) });
  return payload;
}

async function syncSyllabusDetail(id, options = {}) {
  const cleanId = String(id || '').trim();
  if (!cleanId) {
    const err = new Error('Syllabus id is required');
    err.status = 400;
    throw err;
  }

  const path = `/astanait-office-module/api/v1/syllabus/data/${encodeURIComponent(cleanId)}`;
  const syllabus = await fetchDuJson(path, options);
  const payload = {
    id: cleanId,
    syllabus,
    source: { type: 'du', path },
    updated_at: nowIso(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(SYLLABUSES).doc(docId(cleanId)).set(payload, { merge: true });
  return payload;
}

async function syncSyllabusDetails(ids = [], options = {}) {
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  const results = [];
  for (const id of unique) {
    try {
      await syncSyllabusDetail(id, options);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, status: err.status || 500, error: err.message });
    }
  }
  await setMeta('syllabus_details', { total: results.length, ok: results.filter((item) => item.ok).length });
  return results;
}

function countItems(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.list)) return value.list.length;
  if (Array.isArray(value?.content)) return value.content.length;
  if (Array.isArray(value?.data)) return value.data.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value ? 1 : 0;
}

module.exports = {
  getCachedGroupSchedule,
  deleteCachedGroupSchedule,
  syncGroupSchedule,
  syncGroupSchedules,
  syncKnownGroupSchedules,
  listKnownGroups,
  getCachedTeachers,
  getCachedTeacherDetail,
  syncTeachers,
  syncTeacherDetail,
  syncTeacherPublicInfo,
  syncTeacherUserInfo,
  syncTeacherDetails,
  getCachedTeacherSchedule,
  syncTeacherSchedule,
  syncTeacherSchedules,
  getCachedSyllabuses,
  getStaticSyllabusFiles,
  getStaticSyllabusFile,
  getCachedSyllabusDetail,
  syncSyllabuses,
  syncSyllabusDetail,
  syncSyllabusDetails
};
