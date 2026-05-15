// ============================================
//  api.js — HTTP клиент для бэкенда
// ============================================
const API = (() => {
  const BASE = '/api'; // Бэкенд на том же хосте

  function token() { return localStorage.getItem('aitu_token'); }

  async function req(method, path, body, extraHeaders = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    Object.assign(headers, extraHeaders);

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

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
    getTeacherSchedule: (email, duToken = '') => req(
      'GET',
      `/teachers/schedule/by-email/${encodeURIComponent(email)}`,
      null,
      duToken ? { 'X-DU-Token': duToken } : {}
    ),

    // DU student data. DU token is optional and normally handled server-side.
    getDuGroupSchedule: (groupName, duToken = '') => req(
      'GET',
      `/du/schedule/group/${encodeURIComponent(groupName)}`,
      null,
      duToken ? { 'X-DU-Token': duToken } : {}
    ),
    getDuMySchedule: () => req('GET', '/du/schedule/me'),
    connectDu: (token, login = '') => req('POST', '/du/auth/token', { token, login }),
    getSyllabuses: () => req('GET', '/du/syllabus/all'),
    getSyllabus: (id) => req('GET', `/du/syllabus/data/${encodeURIComponent(id)}`),
  };
})();
