/* ============================================================
   KURSOR — API-клиент (заменяет localStorage-Storage).
   ============================================================ */
(function () {
  const LEGACY_TOKEN_KEY = 'kursor_jwt';
  const USER_KEY = 'kursor_user_cache';
  const CSRF_KEY = 'kursor_csrf';
  // One-time migration: JWTs must never remain readable by JavaScript.
  localStorage.removeItem(LEGACY_TOKEN_KEY);

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)(?:__Host-kursor_csrf|kursor_csrf)=([^;]+)/);
    if (match) { try { return decodeURIComponent(match[1]); } catch {} }
    return sessionStorage.getItem(CSRF_KEY) || '';
  }

  async function request(method, url, body) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers = isForm ? {} : { 'Content-Type': 'application/json' };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-CSRF-Token'] = csrfToken();
    const controller = new AbortController();
    // Mobile uploads of a 150 MB lesson video can legitimately take several
    // minutes. Ordinary JSON requests retain the short timeout.
    const timeout = setTimeout(() => controller.abort(), isForm ? 10 * 60 * 1000 : 30000);
    let resp;
    try {
      resp = await fetch(url, {
        method, headers, signal: controller.signal,
        credentials: 'same-origin',
        body: body !== undefined ? (isForm ? body : JSON.stringify(body)) : undefined,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Сервер не ответил вовремя. Попробуйте ещё раз.');
      throw new Error('Нет соединения с сервером. Проверьте интернет и повторите.');
    } finally { clearTimeout(timeout); }
    if (resp.status === 401) {
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(CSRF_KEY);
      if (!location.pathname.endsWith('/index.html') && location.pathname !== '/') {
        location.href = '/index.html';
      }
      throw new Error('Не авторизован');
    }
    let data = null;
    try { data = await resp.json(); } catch {}
    if (!resp.ok) {
      if (data && data.code === 'PASSWORD_CHANGE_REQUIRED' && !location.pathname.endsWith('/change-password.html')) {
        location.href = '/change-password.html';
      }
      const detail = data && Array.isArray(data.details) && data.details[0] ? `: ${data.details[0].message}` : '';
      const msg = (data && data.error) ? data.error + detail : `Ошибка ${resp.status}`;
      throw new Error(msg);
    }
    return data;
  }

  const API_ = {
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b),
    put: (u, b) => request('PUT', u, b),
    del: (u) => request('DELETE', u),
  };

  function multipart(data) {
    const form = new FormData();
    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined || value === null) continue;
      form.append(key, value);
    }
    return form;
  }

  async function login(loginStr, password) {
    const { user, csrfToken: csrf } = await API_.post('/api/auth/login', { login: loginStr, password });
    if (csrf) sessionStorage.setItem(CSRF_KEY, csrf);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  }

  function getToken() { return null; }

  function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }

  async function refreshCurrentUser() {
    const { user, csrfToken: csrf } = await API_.get('/api/auth/me');
    if (csrf) sessionStorage.setItem(CSRF_KEY, csrf);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  }

  function logout() {
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() };
    fetch('/api/auth/logout', { method: 'POST', headers, body: '{}', credentials: 'same-origin', keepalive: true }).catch(() => {});
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(CSRF_KEY);
  }

  let _modules = null, _tasks = null, _users = null;
  async function getModules(force = false) {
    if (!_modules || force) _modules = await API_.get('/api/modules');
    return _modules;
  }
  async function getTasks(force = false) {
    if (!_tasks || force) _tasks = await API_.get('/api/tasks');
    return _tasks;
  }
  async function getUsers(force = false) {
    if (!_users || force) _users = await API_.get('/api/users');
    return _users;
  }
  async function getStudents() { return await API_.get('/api/users/students'); }
  async function getStaff() { return await API_.get('/api/users/staff'); }
  const searchStudents = (q) => API_.get('/api/users/students?q=' + encodeURIComponent(q || ''));

  const createUser   = (data) => API_.post('/api/users', data);
  const updateUser   = (id, data) => API_.put('/api/users/' + encodeURIComponent(id), data);
  const deleteUser   = (id) => API_.del('/api/users/' + encodeURIComponent(id));

  const createModule = (data) => API_.post('/api/modules', data);
  const updateModule = (id, data) => API_.put('/api/modules/' + encodeURIComponent(id), data);
  const deleteModule = (id) => API_.del('/api/modules/' + encodeURIComponent(id));
  const createTask   = (data) => API_.post('/api/tasks', data);
  const updateTask   = (id, data) => API_.put('/api/tasks/' + id, data);
  const deleteTask   = (id) => API_.del('/api/tasks/' + id);

  const getMyProgress     = () => API_.get('/api/progress/me');
  const getAllProgress    = () => API_.get('/api/progress');
  const getUserProgress   = (id) => API_.get('/api/progress/' + encodeURIComponent(id));
  const recordAttempt     = (taskId) => API_.post('/api/progress/attempt', { taskId });
  const recordComplete    = (taskId, points, usedHint, submission) =>
                              API_.post('/api/progress/complete', { taskId, points, usedHint, submission });
  const reviewSubmission = (userId, taskId, approved) => API_.post('/api/progress/review/' + encodeURIComponent(userId) + '/' + encodeURIComponent(taskId), { approved });


  const getLesson      = (mid) => API_.get('/api/lessons/' + encodeURIComponent(mid));
  const listLessons    = () => API_.get('/api/lessons');
  const setIntroStep   = (mid, step, total) => API_.post('/api/lessons/' + encodeURIComponent(mid) + '/intro-step', { step, total });
  const submitMiniTask = (mid, answer) => API_.post('/api/lessons/' + encodeURIComponent(mid) + '/mini-task', { answer });

  async function uploadAvatar(userId, dataUrl) {
    const r = await API_.post('/api/users/' + encodeURIComponent(userId) + '/avatar', { dataUrl });
    if (r && r.user) localStorage.setItem(USER_KEY, JSON.stringify(r.user));
    return r;
  }
  async function deleteAvatar(userId) {
    const r = await API_.del('/api/users/' + encodeURIComponent(userId) + '/avatar');
    if (r && r.user) localStorage.setItem(USER_KEY, JSON.stringify(r.user));
    return r;
  }

  let _ws = null;
  function connectWS(onMessage) {
    if (_ws) try { _ws.close(); } catch {}
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    _ws = new WebSocket(`${proto}://${location.host}/ws`);
    _ws.onmessage = (ev) => {
      try { onMessage(JSON.parse(ev.data)); } catch {}
    };
    _ws.onclose = () => { _ws = null; };
    return _ws;
  }

  function requireAuth(allowedRoles) {
    const u = getCurrentUser();
    if (!u) { location.href = '/index.html'; return null; }
    if (u.mustChangePassword && !location.pathname.endsWith('/change-password.html')) {
      location.href = '/change-password.html'; return null;
    }
    if (allowedRoles && !allowedRoles.includes(u.role)) {
      alert('Доступ запрещён'); location.href = '/index.html'; return null;
    }
    return u;
  }

  /* ---------- Фаза 1: обратная связь и материалы ---------- */
  const getFeedback    = (q) => API_.get('/api/feedback' + (q ? ('?' + q) : ''));
  const createFeedback = (data) => API_.post('/api/feedback', data);
  const deleteFeedback = (id) => API_.del('/api/feedback/' + encodeURIComponent(id));

  const getMaterials   = (q) => API_.get('/api/materials' + (q ? ('?' + q) : ''));
  const createMaterial = (data) => data && data.file ? request('POST', '/api/materials', multipart(data)) : API_.post('/api/materials', data);
  const updateMaterial = (id, data) => data && data.file ? request('PUT', '/api/materials/' + encodeURIComponent(id), multipart(data)) : API_.put('/api/materials/' + encodeURIComponent(id), data);
  const deleteMaterial = (id) => API_.del('/api/materials/' + encodeURIComponent(id));

  const getCourseAccess    = (q) => API_.get('/api/teacher-course-access' + (q ? ('?' + q) : ''));
  const createCourseAccess = (data) => API_.post('/api/teacher-course-access', data);
  const updateCourseAccess = (id, data) => API_.put('/api/teacher-course-access/' + encodeURIComponent(id), data);
  const deleteCourseAccess = (id) => API_.del('/api/teacher-course-access/' + encodeURIComponent(id));

  /* ---------- Фаза 2: CRM ---------- */
  const getBranches   = () => API_.get('/api/branches');
  const createBranch  = (data) => API_.post('/api/branches', data);
  const updateBranch  = (id, data) => API_.put('/api/branches/' + encodeURIComponent(id), data);
  const deleteBranch  = (id) => API_.del('/api/branches/' + encodeURIComponent(id));

  const getTariffs    = () => API_.get('/api/tariffs');
  const createTariff  = (data) => API_.post('/api/tariffs', data);
  const updateTariff  = (id, data) => API_.put('/api/tariffs/' + encodeURIComponent(id), data);
  const deleteTariff  = (id) => API_.del('/api/tariffs/' + encodeURIComponent(id));

  const getGroups       = () => API_.get('/api/groups');
  const getGroup        = (id) => API_.get('/api/groups/' + encodeURIComponent(id));
  const createGroup     = (data) => API_.post('/api/groups', data);
  const updateGroup     = (id, data) => API_.put('/api/groups/' + encodeURIComponent(id), data);
  const deleteGroup     = (id) => API_.del('/api/groups/' + encodeURIComponent(id));
  const getSchedule     = (gid) => API_.get('/api/groups/' + encodeURIComponent(gid) + '/schedule');
  const addSchedule     = (gid, data) => API_.post('/api/groups/' + encodeURIComponent(gid) + '/schedule', data);
  const deleteSchedule  = (gid, sid) => API_.del('/api/groups/' + encodeURIComponent(gid) + '/schedule/' + encodeURIComponent(sid));
  const getMembers      = (gid) => API_.get('/api/groups/' + encodeURIComponent(gid) + '/members');
  const addMember       = (gid, data) => API_.post('/api/groups/' + encodeURIComponent(gid) + '/members', data);
  const removeMember    = (gid, mid) => API_.del('/api/groups/' + encodeURIComponent(gid) + '/members/' + encodeURIComponent(mid));

  const getCrmStudents     = (q) => API_.get('/api/students-crm' + (q ? ('?' + q) : ''));
  const getCrmStudent      = (id) => API_.get('/api/students-crm/' + encodeURIComponent(id));
  const getMyGroupStudents = () => API_.get('/api/students-crm/me-as-teacher');
  const createCrmStudent   = (data) => API_.post('/api/students-crm', data);
  const updateCrmStudent   = (id, data) => API_.put('/api/students-crm/' + encodeURIComponent(id), data);
  const deleteCrmStudent   = (id) => API_.del('/api/students-crm/' + encodeURIComponent(id));
  const getCrmOverview     = () => API_.get('/api/crm/overview');
  const getCrmLeads        = () => API_.get('/api/crm/leads');
  const createCrmLead      = data => API_.post('/api/crm/leads', data);
  const updateCrmLead      = (id,data) => API_.put('/api/crm/leads/' + encodeURIComponent(id), data);
  const deleteCrmLead      = id => API_.del('/api/crm/leads/' + encodeURIComponent(id));
  const getCrmTasks        = () => API_.get('/api/crm/tasks');
  const createCrmTask      = data => API_.post('/api/crm/tasks', data);
  const updateCrmTask      = (id,data) => API_.put('/api/crm/tasks/' + encodeURIComponent(id), data);
  const deleteCrmTask      = id => API_.del('/api/crm/tasks/' + encodeURIComponent(id));
  const getClientCredentials = sid => API_.get('/api/client-credentials?student_id=' + encodeURIComponent(sid));
  const sendClientCredentials = data => API_.post('/api/client-credentials/send', data);

  /* ---------- Права преподавателей ---------- */
  const getPermissionKeys = () => API_.get('/api/teacher-permissions/keys');
  const getPermissions    = (tid) => API_.get('/api/teacher-permissions/' + encodeURIComponent(tid));
  const setPermissions    = (tid, data) => API_.put('/api/teacher-permissions/' + encodeURIComponent(tid), data);

  /* ---------- Фаза 3: занятия, посещаемость, ДЗ ---------- */
  const getSessions      = (q) => API_.get('/api/lesson-sessions' + (q ? ('?' + q) : ''));
  const getCalendar      = (q) => API_.get('/api/calendar' + (q ? ('?' + q) : ''));
  const createSession    = (data) => API_.post('/api/lesson-sessions', data);
  const deleteSession    = (id) => API_.del('/api/lesson-sessions/' + encodeURIComponent(id));
  const getSessionAttendance = (id) => API_.get('/api/lesson-sessions/' + encodeURIComponent(id) + '/attendance');
  const saveAttendance   = (data) => API_.post('/api/attendance', data);

  const getHomework      = (q) => API_.get('/api/homework' + (q ? ('?' + q) : ''));
  const getMyHomework    = () => API_.get('/api/homework/me');
  const createHomework   = (data) => API_.post('/api/homework', data);
  const deleteHomework   = (id) => API_.del('/api/homework/' + encodeURIComponent(id));

  /* ---------- Фаза 4: артефакты занятий ---------- */
  const getArtifacts    = (q) => API_.get('/api/session-artifacts' + (q ? ('?' + q) : ''));
  const createArtifact  = (data) => data && data.file ? request('POST', '/api/session-artifacts', multipart(data)) : API_.post('/api/session-artifacts', data);
  const deleteArtifact  = (id) => API_.del('/api/session-artifacts/' + encodeURIComponent(id));

  /* ---------- Фаза 5: родительский кабинет ---------- */
  const parentChildren   = () => API_.get('/api/parent/children');
  const parentProgress   = (sid) => API_.get('/api/parent/progress/' + encodeURIComponent(sid));
  const parentAttendance = (sid) => API_.get('/api/parent/attendance/' + encodeURIComponent(sid));
  const parentFeedback   = (sid) => API_.get('/api/parent/feedback/' + encodeURIComponent(sid));
  const parentArtifacts  = (sid) => API_.get('/api/parent/artifacts/' + encodeURIComponent(sid));
  const parentFeed       = (sid) => API_.get('/api/parent/feed/'      + encodeURIComponent(sid));
  const parentCalendar   = (sid, from, to) => API_.get('/api/parent/calendar/' + encodeURIComponent(sid) + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
  const parentRequests   = (sid) => API_.get('/api/parent/requests/' + encodeURIComponent(sid));
  const createAbsenceNotice = (data) => API_.post('/api/parent/absence-notices', data);
  const cancelAbsenceNotice = (id) => API_.del('/api/parent/absence-notices/' + encodeURIComponent(id));
  const previewFreezeRequest = (data) => API_.post('/api/parent/freeze-requests/preview', data);
  const createFreezeRequest = (data) => API_.post('/api/parent/freeze-requests', data);
  const cancelFreezeRequest = (id) => API_.del('/api/parent/freeze-requests/' + encodeURIComponent(id));
  const getCareRequests = (status) => API_.get('/api/care-requests?status=' + encodeURIComponent(status || 'pending'));
  const decideCareRequest = (id, data) => API_.put('/api/care-requests/' + encodeURIComponent(id) + '/decision', data);
  const getAbsenceNotices = (from, to) => API_.get('/api/absence-notices?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));

  /* ---------- Фаза 6: уведомления ---------- */
  const getNotifications  = () => API_.get('/api/notifications');
  const markNotifRead     = (id) => API_.put('/api/notifications/' + encodeURIComponent(id) + '/read');
  const markAllNotifRead  = () => API_.put('/api/notifications/read-all');
  const deleteNotif       = (id) => API_.del('/api/notifications/' + encodeURIComponent(id));

  /* ---------- Чаты ---------- */
  const getChats = () => API_.get('/api/chats');
  const getGroupMessages = (id) => API_.get('/api/chats/groups/' + encodeURIComponent(id) + '/messages');
  const sendGroupMessage = (id, body) => API_.post('/api/chats/groups/' + encodeURIComponent(id) + '/messages', { body });
  const createParentThread = data => API_.post('/api/chats/parent-threads', data);
  const getParentThreadMessages = id => API_.get('/api/chats/parent-threads/' + encodeURIComponent(id) + '/messages');
  const sendParentThreadMessage = (id, body) => API_.post('/api/chats/parent-threads/' + encodeURIComponent(id) + '/messages', { body });

  /* ---------- Импорт / экспорт ---------- */
  function exportUrl(dataset, format) {
    return '/api/export/' + dataset + '?format=' + (format || 'csv');
  }
  async function exportDownload(dataset, format) {
    const resp = await fetch(exportUrl(dataset, format), {
      credentials: 'same-origin',
    });
    if (!resp.ok) throw new Error('Ошибка экспорта (' + resp.status + ')');
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = dataset + '.' + (format === 'json' ? 'json' : 'csv');
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }
  const importData = (dataset, payload, dryRun) =>
    API_.post('/api/import/' + dataset + (dryRun ? '?dryRun=true' : ''), payload);


  // Привязка родитель ↔ дети
  const getParentChildren = (parentId) => API_.get('/api/users/' + encodeURIComponent(parentId) + '/children');
  const setParentChildren = (parentId, children) => API_.put('/api/users/' + encodeURIComponent(parentId) + '/children', { children });
  const getStudentParents = (studentId) => API_.get('/api/users/' + encodeURIComponent(studentId) + '/parents');

  window.API = {
    login, logout, getToken, getCurrentUser, refreshCurrentUser, requireAuth,
    getModules, getTasks, getUsers, getStudents, getStaff, searchStudents,
    createUser, updateUser, deleteUser,
    getParentChildren, setParentChildren, getStudentParents,
    createModule, updateModule, deleteModule,
    createTask, updateTask, deleteTask,
    getMyProgress, getAllProgress, getUserProgress,
    recordAttempt, recordComplete, reviewSubmission,
    uploadAvatar, deleteAvatar,
    getLesson, listLessons, setIntroStep, submitMiniTask,
    connectWS, _request: request,
    // фаза 1
    getFeedback, createFeedback, deleteFeedback,
    getMaterials, createMaterial, updateMaterial, deleteMaterial,
    getCourseAccess, createCourseAccess, updateCourseAccess, deleteCourseAccess,
    // фаза 2
    getBranches, createBranch, updateBranch, deleteBranch,
    getTariffs, createTariff, updateTariff, deleteTariff,
    getGroups, getGroup, createGroup, updateGroup, deleteGroup,
    getSchedule, addSchedule, deleteSchedule,
    getMembers, addMember, removeMember,
    getCrmStudents, getCrmStudent, getMyGroupStudents,
    createCrmStudent, updateCrmStudent, deleteCrmStudent,
    getCrmOverview, getCrmLeads, createCrmLead, updateCrmLead, deleteCrmLead,
    getCrmTasks, createCrmTask, updateCrmTask, deleteCrmTask, getClientCredentials, sendClientCredentials,
    getPermissionKeys, getPermissions, setPermissions,
    // фаза 3
    getSessions, getCalendar, createSession, deleteSession, getSessionAttendance, saveAttendance,
    getHomework, getMyHomework, createHomework, deleteHomework,
    // фаза 4
    getArtifacts, createArtifact, deleteArtifact,
    // фаза 5
    parentChildren, parentProgress, parentAttendance, parentFeedback, parentArtifacts, parentFeed,
    parentCalendar, parentRequests, createAbsenceNotice, cancelAbsenceNotice,
    previewFreezeRequest, createFreezeRequest, cancelFreezeRequest,
    getCareRequests, decideCareRequest, getAbsenceNotices,
    // фаза 6
    getNotifications, markNotifRead, markAllNotifRead, deleteNotif,
    getChats, getGroupMessages, sendGroupMessage, createParentThread, getParentThreadMessages, sendParentThreadMessage,
    // WhatsApp
    getWaMeta:       ()       => request('GET',  '/api/whatsapp/meta'),
    getWaState:      ()       => request('GET',  '/api/whatsapp/state'),
    getWaSettings:   ()       => request('GET',  '/api/whatsapp/settings'),
    saveWaSettings:  (data)   => request('PUT',  '/api/whatsapp/settings', data),
    getWaTemplates:  ()       => request('GET',  '/api/whatsapp/templates'),
    createWaTemplate:(data)   => request('POST', '/api/whatsapp/templates', data),
    updateWaTemplate:(id,d)   => request('PUT',  `/api/whatsapp/templates/${id}`, d),
    deleteWaTemplate:(id)     => request('DELETE',`/api/whatsapp/templates/${id}`),
    waTest:          (data)   => request('POST', '/api/whatsapp/test', data),
    waSendNow:       (data)   => request('POST', '/api/whatsapp/send-now', data),
    getWaLog:        ()       => request('GET',  '/api/whatsapp/log'),
    // импорт/экспорт
    exportUrl, exportDownload, importData,
  };
})();
