// ============================================
//  api.js — HTTP клиент для бэкенда
// ============================================
const API = (() => {
  const isLocalFrontend =
    location.protocol === 'file:' ||
    (['localhost', '127.0.0.1'].includes(location.hostname) && location.port && location.port !== '3001');
  const BASE = isLocalFrontend ? 'http://localhost:3001/api' : '/api';

  function token() { return localStorage.getItem('aitu_token'); }

  async function req(method, path, body, extraHeaders = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    Object.assign(headers, extraHeaders);

    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      throw new Error(`Не удалось подключиться к серверу (${BASE}). Проверь, что backend запущен на http://localhost:3001.`);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      Object.assign(err, data);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    get:    (p)       => req('GET',    p),
    post:   (p, b)    => req('POST',   p, b),
    patch:  (p, b)    => req('PATCH',  p, b),
    delete: (p)       => req('DELETE', p),

    // Auth
    login:    (email, password)         => req('POST', '/auth/login',    { email, password }),
    register: (name, email, group, pw)  => req('POST', '/auth/register', { name, email, password: pw, group }),
    me:       ()                        => req('GET',  '/auth/me'),
    updateProfile: (data)               => req('PATCH', '/auth/profile',  data),
    telegramAuth: (data)                => req('POST',  '/auth/telegram', data),

    // Chats
    getChats:    ()      => req('GET',    '/chats'),
    createChat:  ()      => req('POST',   '/chats'),
    getChat:     (id)    => req('GET',    `/chats/${id}`),
    deleteChat:  (id)    => req('DELETE', `/chats/${id}`),
    sendMessage: (id, c) => req('POST',   `/chats/${id}/message`, { content: c }),

    // Calendar / Moodle ICS
    connectCalendar: (group, calendar_url) => req('POST', '/calendar/connect', { group, calendar_url }),
    refreshCalendar: ()                    => req('POST', '/calendar/refresh'),
    getEvents: (params = '')               => req('GET', `/calendar/events${params}`),
    getDeadlines: ()                       => req('GET', '/calendar/deadlines'),
    getCalendarSummary: ()                 => req('GET', '/calendar/summary'),

    // DU public teachers
    getTeachers: (params = '')             => req('GET', `/teachers${params}`),
    getTeacher:  (id, params = '')         => req('GET', `/teachers/${id}${params}`),
    getTeacherSchedule: (email) => req('GET', `/du/teacher-schedule/${encodeURIComponent(email)}`),

    // DU cached data
    connectDu: (token, login = '') => req('POST', '/du/auth/token', { token, login }),
    getDuMySchedule: () => req('GET', '/du/schedule/me'),
    getDuGroupSchedule: (group) => req('GET', `/du/schedule/group/${encodeURIComponent(group)}`),
    getSyllabuses: () => req('GET', '/du/syllabus/all'),
    getSyllabus: (id) => req('GET', `/du/syllabus/data/${encodeURIComponent(id)}`),
    syncDuSchedules: (groups, duToken = '') => req('POST', '/du/cache/schedules', { groups, duToken }),
    syncKnownDuSchedules: (duToken = '') => req('POST', '/du/cache/schedules/known', { duToken }),
    syncDuTeacherSchedules: (emails, duToken = '') => req('POST', '/du/cache/teacher-schedules', { emails, duToken }),
    syncDuSyllabuses: (duToken = '') => req('POST', '/du/cache/syllabuses', { duToken }),
    syncDuSyllabusDetails: (ids, duToken = '') => req('POST', '/du/cache/syllabus-details', { ids, duToken }),
  };
})();
