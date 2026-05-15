const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const repo = require('../services/firestoreRepository');

const DU_API_BASE_URL = process.env.DU_API_BASE_URL || 'https://du.astanait.edu.kz:8765';

function buildUrl(path, query = {}) {
  const url = new URL(path, DU_API_BASE_URL);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

function getDuToken(req, preferredToken = '') {
  const raw = preferredToken || req.headers['x-du-token'] || process.env.DU_TOKEN || '';
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}

function normalizeGroupCandidates(groupName) {
  const raw = String(groupName || '').trim();
  const normalized = raw
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
  const withHyphen = normalized.includes('-')
    ? normalized
    : normalized.replace(/^([A-ZА-Я]+)(\d{2,})$/i, '$1-$2');

  return [...new Set([raw, raw.toUpperCase(), normalized, withHyphen].filter(Boolean))];
}

function scheduleUrlsForGroup(groupName) {
  const encoded = encodeURIComponent(groupName);
  return [
    buildUrl(`/astanait-schedule-module/api/v1/schedule/groupName/${encoded}`),
    buildUrl(`/astanait-schedule-module/api/v1/schedule/studentGroupName/${encoded}`),
    buildUrl(`/astanait-schedule-module/api/v1/schedule/studentGroup/${encoded}`),
    buildUrl(`/astanait-schedule-module/api/v1/schedule/eduGroupName/${encoded}`),
    buildUrl(`/astanait-schedule-module/api/v1/schedule/group-name/${encoded}`),
    buildUrl(`/astanait-schedule-module/api/v1/schedule/group-name`, { groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule', { groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule', { group: groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule', { studentGroupName: groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule', { name: groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule/groupName', { groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule/groupName', { name: groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule/groupName', { group_name: groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule/group', { groupName }),
    buildUrl('/astanait-schedule-module/api/v1/schedule/group', { name: groupName }),
    buildUrl(`/astanait-schedule-module/api/v1/schedule/group/${encoded}`)
  ];
}

function valueToText(value) {
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return value.titleRu || value.titleEn || value.titleKz || value.name || value.fullName || value.value || '';
  }
  return value === undefined || value === null ? '' : String(value);
}

function looksLikeScheduleItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const keys = [
    'disciplineName', 'discipline', 'subject', 'subjectName', 'courseName', 'courseUnitName',
    'lessonName', 'title', 'moduleName', 'className',
    'startTime', 'start_time', 'start', 'begin', 'beginTime', 'timeStart', 'from',
    'room', 'classroom', 'cabinet', 'auditorium', 'auditory', 'auditoryName', 'location',
    'teacherName', 'teacherFullName', 'tutorName', 'lecturer', 'lecturerName'
  ];
  return keys.some((key) => valueToText(item[key]));
}

function countScheduleItems(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countScheduleItems(item), 0);
  if (!value || typeof value !== 'object') return 0;
  if (looksLikeScheduleItem(value)) return 1;
  return Object.values(value).reduce((sum, item) => sum + countScheduleItems(item), 0);
}

function summarizePayload(value) {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (value && typeof value === 'object') return { type: 'object', keys: Object.keys(value).slice(0, 20) };
  return { type: typeof value };
}

async function fetchJson(url, { duToken = '', method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: 'https://du.astanait.edu.kz',
    Referer: 'https://du.astanait.edu.kz/'
  };
  if (duToken) headers.Authorization = `Bearer ${duToken}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();

  if (!response.ok) {
    const err = new Error(text || `DU API HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return text ? JSON.parse(text) : null;
}

function authUrls() {
  const configured = String(process.env.DU_AUTH_LOGIN_PATHS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const paths = configured.length ? configured : [
    '/astanait-authorization-module/api/v1/auth/login',
    '/astanait-authorization-module/api/v1/auth/login-by-email',
    '/astanait-authorization-module/api/v1/auth/login/email',
    '/astanait-authorization-module/api/v1/auth/sign-in',
    '/astanait-authorization-module/api/v1/auth/signin',
    '/astanait-authorization-module/api/v1/auth/authenticate',
    '/astanait-authorization-module/api/v1/auth/token',
    '/astanait-authorization-module/api/v1/auth',
    '/astanait-authorization-module/api/auth/login',
    '/astanait-authorization-module/api/auth/sign-in',
    '/astanait-authorization-module/oauth/token',
    '/astanait-auth-module/api/v1/auth/login',
    '/astanait-auth-module/api/v1/auth/sign-in',
    '/api/v1/auth/login',
    '/api/auth/login'
  ];
  return paths.map((path) => path.startsWith('http') ? new URL(path) : buildUrl(path));
}

function authPayloads(login, password) {
  return [
    { email: login, password },
    { email: login, password, rememberMe: true },
    { username: login, password },
    { username: login, password, rememberMe: true },
    { login, password },
    { login, password, rememberMe: true },
    { mail: login, password }
  ];
}

function findDeepValue(value, keys) {
  if (!value || typeof value !== 'object') return '';
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  for (const nested of Object.values(value)) {
    const found = findDeepValue(nested, keys);
    if (found) return found;
  }
  return '';
}

function extractAuthTokens(data) {
  const accessToken = findDeepValue(data, [
    'accessToken',
    'access_token',
    'token',
    'jwt',
    'idToken',
    'id_token'
  ]);
  const refreshToken = findDeepValue(data, [
    'refreshToken',
    'refresh_token'
  ]);
  return {
    accessToken: String(accessToken || '').replace(/^Bearer\s+/i, '').trim(),
    refreshToken: String(refreshToken || '').replace(/^Bearer\s+/i, '').trim()
  };
}

async function loginToDu(login, password) {
  const attempts = [];
  for (const url of authUrls()) {
    for (const payload of authPayloads(login, password)) {
      try {
        const data = await fetchJson(url, { method: 'POST', body: payload });
        const tokens = extractAuthTokens(data);
        const attempt = {
          url: url.toString(),
          status: 200,
          payloadKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : []
        };
        attempts.push(attempt);
        if (tokens.accessToken) return { ...tokens, raw: data, source: attempt, attempts };
      } catch (err) {
        attempts.push({
          url: url.toString(),
          status: err.status || 502,
          error: err.message ? String(err.message).slice(0, 220) : 'DU login failed'
        });
      }
    }
  }

  const err = new Error('Не удалось получить DU token. Нужен точный login endpoint DU.');
  err.status = 401;
  err.attempts = attempts;
  err.tried = [...new Set(attempts.map((attempt) => attempt.url))];
  throw err;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/javascript,text/javascript,*/*',
      Origin: 'https://du.astanait.edu.kz',
      Referer: 'https://du.astanait.edu.kz/'
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(text || `DU HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return text;
}

async function discoverScheduleEndpoints() {
  const root = new URL('/', DU_API_BASE_URL).origin.replace(':8765', '');
  const html = await fetchText(root);
  const assetMatches = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gi)];
  const assetUrls = assetMatches
    .map((match) => new URL(match[1], root).toString())
    .filter((url) => url.endsWith('.js'));

  const endpoints = new Set();
  const assets = [];

  for (const assetUrl of assetUrls.slice(0, 30)) {
    try {
      const source = await fetchText(assetUrl);
      const matches = [
        ...source.matchAll(/["'`]([^"'`]*schedule[^"'`]*)["'`]/gi),
        ...source.matchAll(/["'`]([^"'`]*astanait-schedule-module[^"'`]*)["'`]/gi)
      ];
      const found = matches
        .map((match) => match[1])
        .filter((item) => /schedule|group|tutor/i.test(item))
        .slice(0, 80);
      found.forEach((item) => endpoints.add(item));
      if (found.length) assets.push({ assetUrl, found });
    } catch (err) {
      assets.push({ assetUrl, error: err.message });
    }
  }

  return { root, assetCount: assetUrls.length, endpoints: [...endpoints].sort(), assets };
}

async function fetchGroupSchedule(groupName, req, preferredToken = '') {
  const attempts = [];
  let firstEmpty = null;
  let firstError = null;

  for (const group of normalizeGroupCandidates(groupName)) {
    for (const url of scheduleUrlsForGroup(group)) {
      try {
        const schedule = await fetchJson(url, { duToken: getDuToken(req, preferredToken) });
        const itemCount = countScheduleItems(schedule);
        const attempt = {
          group,
          url: url.toString(),
          status: 200,
          itemCount,
          payload: summarizePayload(schedule)
        };
        attempts.push(attempt);

        if (itemCount > 0) return { schedule, group, source: attempt, attempts };
        if (!firstEmpty) firstEmpty = { schedule, group, source: attempt };
      } catch (err) {
        const attempt = {
          group,
          url: url.toString(),
          status: err.status || 502,
          error: err.message ? String(err.message).slice(0, 220) : 'DU request failed'
        };
        attempts.push(attempt);
        if (!firstError) firstError = err;
      }
    }
  }

  if (firstEmpty) return { ...firstEmpty, attempts };

  const err = firstError || new Error('DU schedule endpoints did not return data');
  err.attempts = attempts;
  err.hasDuToken = Boolean(getDuToken(req, preferredToken));
  throw err;
}

async function getSavedDuToken(userId) {
  const privateUser = await repo.getUserPrivateById(userId);
  return privateUser?.data?.du_auth?.accessToken || '';
}

async function fetchDuForUser(req, path, query = {}) {
  const savedDuToken = await getSavedDuToken(req.user._id);
  return fetchJson(buildUrl(path, query), { duToken: getDuToken(req, savedDuToken) });
}

function scheduleErrorResponse(err) {
  const hasServerToken = Boolean(process.env.DU_TOKEN);
  const hasAnyToken = hasServerToken || Boolean(err.hasDuToken);
  const authFailed = err.status === 401 || err.status === 403 || (err.attempts || []).some((attempt) => attempt.status === 401 || attempt.status === 403);
  return {
    error: authFailed && !hasAnyToken
      ? 'Расписание DU требует авторизацию. Подключи DU аккаунт в настройках'
      : authFailed
        ? 'DU не принял DU token. Подключи DU аккаунт заново'
      : 'Не удалось получить расписание группы DU',
    attempts: err.attempts || []
  };
}

router.get('/schedule/group/:groupName', async (req, res) => {
  try {
    const result = await fetchGroupSchedule(req.params.groupName, req);
    res.json(result);
  } catch (err) {
    console.error('DU group schedule error:', err);
    res.status(err.status || 502).json(scheduleErrorResponse(err));
  }
});

router.get('/schedule/me', authGuard, async (req, res) => {
  try {
    const groupName = String(req.user.group || '').trim();
    if (!groupName) {
      return res.status(400).json({ error: 'В профиле не указана группа' });
    }

    const savedDuToken = await getSavedDuToken(req.user._id);
    const result = await fetchGroupSchedule(groupName, req, savedDuToken);
    res.json({ ...result, requestedGroup: groupName });
  } catch (err) {
    console.error('DU current user group schedule error:', err);
    res.status(err.status || 502).json(scheduleErrorResponse(err));
  }
});

router.get('/syllabus/all', authGuard, async (req, res) => {
  try {
    const syllabuses = await fetchDuForUser(req, '/astanait-office-module/api/v1/syllabus/all');
    res.json({ syllabuses });
  } catch (err) {
    console.error('DU syllabus list error:', err);
    res.status(err.status || 502).json({
      error: err.status === 401 || err.status === 403
        ? 'DU не отдал силлабусы. Сохрани свежий DU Bearer token в настройках'
        : 'Не удалось получить список силлабусов DU'
    });
  }
});

router.get('/syllabus/data/:id', authGuard, async (req, res) => {
  try {
    const syllabus = await fetchDuForUser(req, `/astanait-office-module/api/v1/syllabus/data/${encodeURIComponent(req.params.id)}`);
    res.json({ syllabus });
  } catch (err) {
    console.error('DU syllabus detail error:', err);
    res.status(err.status || 502).json({
      error: err.status === 401 || err.status === 403
        ? 'DU не отдал детали силлабуса. Сохрани свежий DU Bearer token в настройках'
        : 'Не удалось получить силлабус DU'
    });
  }
});

router.post('/auth/login', authGuard, async (req, res) => {
  try {
    const login = String(req.body.login || '').trim();
    const password = String(req.body.password || '');
    if (!login || !password) {
      return res.status(400).json({ error: 'Укажи DU логин и пароль' });
    }

    const tokens = await loginToDu(login, password);
    const user = await repo.updateUser(req.user._id, {
      du_auth: {
        login,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || '',
        updated_at: new Date().toISOString(),
        source: tokens.source?.url || ''
      }
    });

    res.json({
      ok: true,
      user,
      source: tokens.source,
      attempts: tokens.attempts
    });
  } catch (err) {
    console.error('DU login error:', err);
    res.status(err.status || 502).json({
      error: err.message || 'Не удалось авторизоваться в DU',
      attempts: err.attempts || [],
      tried: err.tried || []
    });
  }
});

router.get('/schedule/discover', async (req, res) => {
  try {
    res.json(await discoverScheduleEndpoints());
  } catch (err) {
    console.error('DU schedule discover error:', err);
    res.status(err.status || 502).json({ error: 'Не удалось прочитать frontend DU', detail: err.message });
  }
});

router.post('/auth/token', authGuard, async (req, res) => {
  try {
    const rawToken = String(req.body.token || '').replace(/^Bearer\s+/i, '').trim();
    if (!rawToken) {
      return res.status(400).json({ error: 'Вставь DU Bearer token' });
    }

    const user = await repo.updateUser(req.user._id, {
      du_auth: {
        login: req.body.login ? String(req.body.login).trim() : '',
        accessToken: rawToken,
        refreshToken: '',
        updated_at: new Date().toISOString(),
        source: 'manual-token'
      }
    });

    res.json({ ok: true, user });
  } catch (err) {
    console.error('DU token save error:', err);
    res.status(500).json({ error: 'Не удалось сохранить DU token' });
  }
});

module.exports = router;
