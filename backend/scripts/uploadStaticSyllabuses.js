require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, bucket, admin } = require('../config/firebase');

const SOURCE_DIR = path.resolve(__dirname, '..', '..', 'data', 'syllabuses');
const COLLECTION = 'syllabus_files';
const STORAGE_PREFIX = 'syllabuses/static';

function normalizeSpace(value = '') {
  return String(value).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function slug(value) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яёәғқңөұүһі]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'syllabus';
}

function parseFileName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName, ext);
  const teacherMatch = base.match(/\[([^\]]+)\]/);
  const yearMatch = base.match(/\((\d{4})-(\d{4})\)/);
  const yearSingleMatch = base.match(/\b(20\d{2})\b/);
  const codeMatch = base.match(/\b[A-ZА-Я]{2,}\s?\d{3,4}\b/);

  let title = base
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\(\d{4}-\d{4}\)/g, '')
    .replace(/\b20\d{2}[-_ ]?20?\d{2}\b/g, '')
    .replace(/\s+-\s+\d+(?:-\d+)?$/g, '')
    .replace(/-\d+(?:-\d+)?$/g, '');

  title = normalizeSpace(title);

  return {
    title: title || normalizeSpace(base),
    teacher: teacherMatch ? normalizeSpace(teacherMatch[1]) : '',
    academicYear: yearMatch ? `${yearMatch[1]}-${yearMatch[2]}` : (yearSingleMatch ? yearSingleMatch[1] : ''),
    code: codeMatch ? normalizeSpace(codeMatch[0]) : '',
    fileName,
    fileType: ext.replace('.', '') || 'pdf'
  };
}

function downloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Missing folder: ${SOURCE_DIR}`);
  }

  const files = fs.readdirSync(SOURCE_DIR)
    .filter((name) => fs.statSync(path.join(SOURCE_DIR, name)).isFile())
    .filter((name) => path.extname(name).toLowerCase() === '.pdf')
    .sort((a, b) => a.localeCompare(b));

  console.log(`PDF files found: ${files.length}`);
  console.log(`Storage bucket: ${bucket.name}`);

  let uploaded = 0;
  const failures = [];

  for (let index = 0; index < files.length; index += 1) {
    const fileName = files[index];
    const localPath = path.join(SOURCE_DIR, fileName);
    const stat = fs.statSync(localPath);
    const meta = parseFileName(fileName);
    const docId = hash(fileName);
    const storagePath = `${STORAGE_PREFIX}/${slug(meta.title)}-${docId}.pdf`;
    const token = crypto.randomUUID();
    const fileUrl = downloadUrl(bucket.name, storagePath, token);

    try {
      await bucket.upload(localPath, {
        destination: storagePath,
        resumable: false,
        metadata: {
          contentType: 'application/pdf',
          metadata: {
            firebaseStorageDownloadTokens: token,
            originalFileName: fileName
          }
        }
      });

      await db.collection(COLLECTION).doc(docId).set({
        id: docId,
        ...meta,
        originalFileName: fileName,
        size: stat.size,
        mimeType: 'application/pdf',
        storageBucket: bucket.name,
        storagePath,
        fileUrl,
        source: 'static-upload',
        searchText: normalizeSpace([
          meta.title,
          meta.code,
          meta.teacher,
          meta.academicYear,
          fileName
        ].filter(Boolean).join(' ')).toLowerCase(),
        uploaded_at: new Date().toISOString(),
        uploadedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      uploaded += 1;
    } catch (err) {
      failures.push({ fileName, error: err.message });
    }

    if ((index + 1) % 20 === 0 || index + 1 === files.length) {
      console.log(JSON.stringify({
        progress: index + 1,
        total: files.length,
        uploaded,
        failures: failures.length
      }));
    }
  }

  await db.collection('du_cache_meta').doc('static_syllabuses').set({
    total: files.length,
    uploaded,
    failures: failures.length,
    updated_at: new Date().toISOString(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(JSON.stringify({
    files: files.length,
    uploaded,
    failures: failures.length
  }, null, 2));

  if (failures.length) console.log(JSON.stringify(failures.slice(0, 50), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
