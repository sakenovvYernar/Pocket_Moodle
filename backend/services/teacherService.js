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

  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(text || `DU API HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return text ? JSON.parse(text) : null;
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

function valueToText(value) {
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const fullName = [value.lastName || value.surname, value.firstName, value.middleName].filter(Boolean).join(' ');
    return value.titleRu || value.titleEn || value.titleKz || value.nameRu || value.nameEn || value.nameKz || value.name || value.title || value.fullName || fullName || value.value || value.label || '';
  }
  return value === undefined || value === null ? '' : String(value);
}

function normalizeTeacher(item) {
  const firstName = item.firstName || item.firstname || item.name || item.nameKz || item.nameRu || item.nameEn || '';
  const lastName = item.lastName || item.lastname || item.surname || item.surnameKz || item.surnameRu || item.surnameEn || '';
  const middleName = item.middleName || item.middlename || item.patronymic || item.patronymicKz || item.patronymicRu || item.patronymicEn || '';
  const fullName = item.fullName || item.full_name || item.fio || item.teacherName || [lastName, firstName, middleName].filter(Boolean).join(' ');
  const department = typeof item.department === 'string'
    ? item.department
    : item.department?.titleRu || item.department?.titleEn || item.department?.titleKz || '';
  const position = typeof item.position === 'string'
    ? item.position
    : item.position?.titleRu || item.position?.titleEn || item.position?.titleKz || item.positionName || '';

  return {
    id: item.id || item.teacherId || item.teacher_id || '',
    userId: item.userId || item.user_id || '',
    name: fullName || item.email || '�������������',
    email: item.email || item.mail || item.corporateEmail || item.corporate_email || item.login || '',
    department: department || item.departmentName || item.academicDepartment || item.academicDepartmentName || '',
    position: position || item.teacherPosition || item.teacherPositionName || '',
    scientificDegree: valueToText(item.scientificDegree || item.scientificDegreeDto || item.academicDegree || item.academicDegreeDto || ''),
    academicStatus: valueToText(item.academicStatus || item.academicStatusDto || item.status || ''),
    citizenship: valueToText(item.citizenship || ''),
    nationality: valueToText(item.nationality || ''),
    scientificInterests: Array.isArray(item.scientificInterests) ? item.scientificInterests : [],
    taughtCourses: Array.isArray(item.taughtCourses) ? item.taughtCourses : [],
    raw: item
  };
}

function normalizeList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.list)
      ? payload.list
      : Array.isArray(payload?.content)
        ? payload.content
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

  return list.map(normalizeTeacher).filter((teacher) => teacher.name);
}

function scoreTeacher(teacher, query) {
  const q = query.toLowerCase();
  const name = teacher.name.toLowerCase();
  const haystack = [teacher.name, teacher.email, teacher.department, teacher.position].join(' ').toLowerCase();
  if (name === q) return 100;
  if (name.includes(q)) return 80;
  if (teacher.email.toLowerCase().includes(q)) return 70;
  return q.split(/\s+/).filter((part) => part.length > 1 && haystack.includes(part)).length * 10;
}

async function searchTeachers(query, { limit = 5 } = {}) {
  const data = await fetchAllTeachers({ all: '1' });
  const normalized = normalizeList(data);
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return normalized.slice(0, limit);

  return normalized
    .map((teacher) => ({ teacher, score: scoreTeacher(teacher, cleanQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.teacher.name.localeCompare(b.teacher.name))
    .slice(0, limit)
    .map((item) => item.teacher);
}

async function getTeacherDetail(teacher, duToken = '') {
  const detail = teacher.id
    ? await fetchJson(buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-teacher-info', {
      teacher_id: teacher.id
    }), { duToken }).catch(() => null)
    : null;

  const publicInfo = teacher.userId
    ? await fetchJson(buildUrl('/astanait-teacher-module/api/v1/teacher/pps/get-teacher-by-user-id', {
      user_id: teacher.userId
    }), { duToken }).catch(() => null)
    : null;

  return { detail, publicInfo };
}

module.exports = {
  buildUrl,
  fetchJson,
  publicQuery,
  fetchAllTeachers,
  normalizeTeacher,
  normalizeList,
  searchTeachers,
  getTeacherDetail,
  valueToText
};
