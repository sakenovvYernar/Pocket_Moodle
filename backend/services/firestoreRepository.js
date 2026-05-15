const bcrypt = require('bcryptjs');
const { db, admin } = require('../config/firebase');

const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;

function nowIso() {
  return new Date().toISOString();
}

function cleanUser(id, data) {
  if (!data) return null;
  const { passwordHash, ...safe } = data;
  const duAuth = safe.du_auth || {};
  return {
    _id: id,
    id,
    name: safe.name || 'Student',
    email: safe.email || '',
    telegram_id: safe.telegram_id || '',
    group: safe.group || '',
    calendar_url: safe.calendar_url || '',
    avatar: safe.avatar || '',
    role: safe.role || 'student',
    du_connected: Boolean(duAuth.accessToken),
    du_login: duAuth.login || '',
    du_updated_at: duAuth.updated_at || null,
    settings: {
      language: 'ru',
      notifications: true,
      theme: 'dark',
      ...(safe.settings || {})
    },
    createdAt: safe.createdAt?.toDate?.()?.toISOString?.() || safe.createdAt || null,
    updatedAt: safe.updatedAt?.toDate?.()?.toISOString?.() || safe.updatedAt || null
  };
}

function cleanChat(id, data) {
  const messages = (data.messages || []).map((message) => ({
    role: message.role,
    content: message.content,
    time: message.time || message.createdAt || nowIso()
  }));

  return {
    _id: id,
    id,
    userId: data.userId,
    title: data.title || 'Новый чат',
    messages,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || null
  };
}

async function findUserByEmail(email) {
  const snapshot = await db.collection('users').where('email', '==', String(email).toLowerCase()).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data(), safe: cleanUser(doc.id, doc.data()) };
}

async function findUserByTelegramId(telegramId) {
  const snapshot = await db.collection('users').where('telegram_id', '==', String(telegramId)).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data(), safe: cleanUser(doc.id, doc.data()) };
}

async function createUser({ name, email, password, group, telegram_id = '', calendar_url = '' }) {
  const passwordHash = password ? await bcrypt.hash(password, 12) : '';
  const ref = db.collection('users').doc();
  const data = {
    name,
    email: email ? String(email).toLowerCase() : '',
    passwordHash,
    telegram_id: telegram_id ? String(telegram_id) : '',
    group,
    calendar_url,
    avatar: '',
    role: 'student',
    settings: { language: 'ru', notifications: true, theme: 'dark' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await ref.set(data);
  const doc = await ref.get();
  return cleanUser(ref.id, doc.data());
}

async function verifyPassword(userRecord, password) {
  return bcrypt.compare(password, userRecord.data.passwordHash || '');
}

async function getUserById(id) {
  const doc = await db.collection('users').doc(id).get();
  if (!doc.exists) return null;
  return cleanUser(doc.id, doc.data());
}

async function getUserPrivateById(id) {
  const doc = await db.collection('users').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, data: doc.data(), safe: cleanUser(doc.id, doc.data()) };
}

async function updateUser(id, updates) {
  await db.collection('users').doc(id).set({
    ...updates,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return getUserById(id);
}

async function listChats(userId) {
  const snapshot = await db.collection('chats')
    .where('userId', '==', userId)
    .get();
  return snapshot.docs.map((doc) => {
    const chat = cleanChat(doc.id, doc.data());
    delete chat.messages;
    return chat;
  }).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function createChat(userId) {
  const ref = db.collection('chats').doc();
  const createdAt = nowIso();
  await ref.set({
    userId,
    title: 'Новый чат',
    messages: [],
    createdAt,
    updatedAt: createdAt
  });
  const doc = await ref.get();
  return cleanChat(doc.id, doc.data());
}

async function getChat(userId, chatId) {
  const doc = await db.collection('chats').doc(chatId).get();
  if (!doc.exists) return null;
  const chat = cleanChat(doc.id, doc.data());
  return chat.userId === userId ? chat : null;
}

async function deleteChat(userId, chatId) {
  const chat = await getChat(userId, chatId);
  if (!chat) return false;
  await db.collection('chats').doc(chatId).delete();
  return true;
}

async function appendMessages(userId, chatId, messages, title) {
  const chat = await getChat(userId, chatId);
  if (!chat) return null;

  const nextMessages = [...chat.messages, ...messages];
  await db.collection('chats').doc(chatId).set({
    messages: nextMessages,
    title,
    updatedAt: nowIso()
  }, { merge: true });

  return getChat(userId, chatId);
}

async function saveEventsCache(userId, events) {
  await db.collection('events_cache').doc(userId).set({
    user_id: userId,
    events,
    updated_at: nowIso(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function getEventsCache(userId) {
  const doc = await db.collection('events_cache').doc(userId).get();
  if (!doc.exists) return { user_id: userId, events: [], updated_at: null };
  return doc.data();
}

async function createNotification(userId, payload) {
  const ref = db.collection('notifications').doc();
  await ref.set({
    user_id: userId,
    status: 'pending',
    createdAt: serverTimestamp(),
    ...payload
  });
  return { id: ref.id, ...payload };
}

module.exports = {
  findUserByEmail,
  findUserByTelegramId,
  createUser,
  verifyPassword,
  getUserById,
  getUserPrivateById,
  updateUser,
  listChats,
  createChat,
  getChat,
  deleteChat,
  appendMessages,
  saveEventsCache,
  getEventsCache,
  createNotification
};
