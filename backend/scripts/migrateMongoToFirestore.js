require('dotenv').config();

const { MongoClient, ObjectId } = require('mongodb');
const { db, admin } = require('../config/firebase');

function normalizeDate(value) {
  if (!value) return new Date().toISOString();
  return new Date(value).toISOString();
}

function normalizeUser(user) {
  return {
    name: user.name || 'Student',
    email: user.email || '',
    passwordHash: user.password || user.passwordHash || '',
    telegram_id: user.telegram_id || '',
    group: user.group || '',
    calendar_url: user.calendar_url || '',
    avatar: user.avatar || '',
    role: user.role || 'student',
    settings: {
      language: 'ru',
      notifications: true,
      theme: 'dark',
      ...(user.settings || {})
    },
    createdAt: user.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: user.updatedAt || admin.firestore.FieldValue.serverTimestamp()
  };
}

function normalizeChat(chat) {
  return {
    userId: String(chat.userId || ''),
    title: chat.title || 'Новый чат',
    messages: (chat.messages || []).map((message) => ({
      role: message.role,
      content: message.content,
      time: normalizeDate(message.time || message.createdAt)
    })),
    createdAt: chat.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: chat.updatedAt || admin.firestore.FieldValue.serverTimestamp()
  };
}

async function copyCollection({ mongoDb, mongoName, firestoreName, normalize }) {
  const docs = await mongoDb.collection(mongoName).find({}).toArray();
  let count = 0;

  for (const doc of docs) {
    const id = doc._id instanceof ObjectId ? doc._id.toHexString() : String(doc._id);
    await db.collection(firestoreName).doc(id).set(normalize(doc), { merge: true });
    count += 1;
  }

  console.log(`${mongoName} -> ${firestoreName}: ${count}`);
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('Set MONGODB_URI before running migration');
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  const mongoDb = client.db(process.env.MONGODB_DB || undefined);

  await copyCollection({ mongoDb, mongoName: 'users', firestoreName: 'users', normalize: normalizeUser });
  await copyCollection({ mongoDb, mongoName: 'chats', firestoreName: 'chats', normalize: normalizeChat });

  await client.close();
  console.log('Migration finished');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
