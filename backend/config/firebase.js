const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(json);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const filePath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  return null;
}

if (!admin.apps.length) {
  const serviceAccount = readServiceAccount();

  admin.initializeApp(serviceAccount
    ? { credential: admin.credential.cert(serviceAccount) }
    : { credential: admin.credential.applicationDefault() }
  );
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db };
