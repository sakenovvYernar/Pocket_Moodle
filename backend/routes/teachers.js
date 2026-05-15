const express = require('express');
const router = express.Router();

const DU_API_BASE_URL = process.env.DU_API_BASE_URL || 'https://du.astanait.edu.kz:8765';
const CACHE_TTL_MS = 10 * 60 * 1000;
let teachersCache = null;

function buildUrl(path, query = {}) {
  const url = new URL(path, DU_API_BASE_URL);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function fetchJson(url, { duToken = '' } = {}) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://du.astanait.edu.kz',
    Referer: 'https://du.astanait.edu.kz/'
  };
  if (duToken) headers.Authorization = `Bearer ${duToken}`;

  const response = await fetch(url, {
    headers
  });

  const text = await response.text();
  if (!response.ok) {
    const err = new Error(text || `DU API HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return text ? JSON.parse(text) : null;
}

function getDuToken(req) {
  const raw = req.headers['x-du-token'] || '';
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}

function publicQuery(query = {}) {
  const next = { ...query };
  delete next.all;
  return next;
}

async function fetchAllTeachers(query = {}) {
  if (teachersCache && Date.now() - teachersCache.createdAt < CACHE_TTL_MS) {
    return teachersCache.data;
  }

  const cleanQuery = publicQuery(query);
  const firstUrl = buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-all-teachers', {
    ...cleanQuery,
    page: cleanQuery.page || 0
  });
  const firstPage = await fetchJson(firstUrl);
  const pageCount = Number(firstPage?.number_of_pages || 1);
  const list = Array.isArray(firstPage?.list) ? [...firstPage.list] : [];

  for (let page = 1; page < pageCount; page += 8) {
    const chunk = Array.from({ length: Math.min(8, pageCount - page) }, (_, index) => page + index);
    const pages = await Promise.all(chunk.map((pageNumber) => {
      const url = buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-all-teachers', {
        ...cleanQuery,
        page: pageNumber
      });
      return fetchJson(url);
    }));

    pages.forEach((pageData) => {
      if (Array.isArray(pageData?.list)) list.push(...pageData.list);
    });
  }

  const data = {
    ...firstPage,
    list,
    current_page: 0,
    loaded_pages: pageCount,
    total_number: firstPage?.total_number || list.length
  };
  teachersCache = { createdAt: Date.now(), data };
  return data;
}

router.get('/', async (req, res) => {
  try {
    const data = req.query.all === '1'
      ? await fetchAllTeachers(req.query)
      : await fetchJson(buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-all-teachers', publicQuery(req.query)));
    res.json({ teachers: data });
  } catch (err) {
    console.error('DU teachers error:', err);
    res.status(err.status || 502).json({ error: 'Не удалось получить список преподавателей DU' });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const url = buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-teacher-by-user-id', {
      user_id: req.params.userId
    });
    const data = await fetchJson(url, { duToken: getDuToken(req) });
    res.json({ teacher: data });
  } catch (err) {
    console.error('DU teacher public user error:', err);
    res.status(err.status || 502).json({ error: 'Не удалось получить публичные данные преподавателя DU' });
  }
});

router.get('/schedule/by-email/:email', async (req, res) => {
  try {
    const url = buildUrl(`/astanait-schedule-module/api/v1/schedule/tutorEmail/${encodeURIComponent(req.params.email)}`);
    const data = await fetchJson(url, { duToken: getDuToken(req) });
    res.json({ schedule: data });
  } catch (err) {
    console.error('DU teacher schedule error:', err);
    res.status(err.status || 502).json({
      error: err.status === 401 || err.status === 403
        ? 'DU не отдал расписание без авторизации'
        : 'Не удалось получить расписание преподавателя DU'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const url = buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-teacher-info', {
      teacher_id: req.params.id
    });
    const [data, publicInfo] = await Promise.all([
      fetchJson(url, { duToken: getDuToken(req) }),
      req.query.userId
        ? fetchJson(buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-teacher-by-user-id', {
          user_id: req.query.userId
        }), { duToken: getDuToken(req) }).catch(() => null)
        : Promise.resolve(null)
    ]);
    res.json({ teacher: data, publicInfo });
  } catch (err) {
    console.error('DU teacher detail error:', err);
    res.status(err.status || 502).json({ error: 'Не удалось получить данные преподавателя DU' });
  }
});

module.exports = router;
