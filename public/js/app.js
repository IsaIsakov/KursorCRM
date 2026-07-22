/* ============================================================
   KURSOR — Общая логика (навбар, утилиты). Использует window.API.
   ============================================================ */

function requireAuth(allowedRoles) {
  return API.requireAuth(allowedRoles);
}

function uiIcon(name, className='ui-icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="/img/ui-icons.svg#${name}"></use></svg>`;
}

function renderNavbar(activePage) {
  const user = API.getCurrentUser();
  if (!user) return '';
  const initial = (user.name || 'У').charAt(0).toUpperCase();
  const T = (window.I18N ? I18N.t : (k)=>k);
  const links = user.role === 'student' ? [
    { href:'/pages/dashboard.html', icon:'building', label:T('nav.dashboard'), key:'dashboard' },
    { href:'/pages/catalog.html', icon:'book', label:T('nav.tasks'), key:'catalog' },
    { href:'/pages/leaderboard.html', icon:'chart', label:T('nav.leaderboard'), key:'leaderboard' },
    { href:'/pages/chats.html', icon:'groups', label:'Чаты', key:'chats' },
    { href:'/pages/profile.html', icon:'student', label:T('nav.profile'), key:'profile' },
  ] : (user.role === 'teacher' || user.role === 'assistant') ? [
    { href:'/pages/teacher.html', icon:'student', label:T('nav.students'), key:'teacher' },
    { href:'/pages/chats.html', icon:'groups', label:'Чаты', key:'chats' },
    { href:'/pages/catalog.html', icon:'book', label:T('nav.tasks'), key:'catalog' },
    { href:'/admin/index.html', icon:'tasks', label:T('nav.manage'), key:'admin' },
  ] : user.role === 'curator' ? [
    { href:'/curator/index.html', icon:'tasks', label:'Кабинет куратора', key:'curator' },
  ] : user.role === 'parent' ? [
    { href:'/pages/parent.html', icon:'calendar', label:T('nav.parent'), key:'parent' },
    { href:'/pages/chats.html', icon:'groups', label:'Написать преподавателю', key:'chats' },
  ] : [
    { href:'/admin/index.html', icon:'tasks', label:T('nav.admin'), key:'admin' },
  ];

  const langHtml = window.I18N ? I18N.switcherHtml() : '';

  return `
  <nav class="navbar">
    <a class="navbar-logo" href="/index.html">
      <img src="/img/kursor-logo.webp" alt="KURSOR">
    </a>
    <div class="navbar-menu">
      ${links.map(l => `<a href="${l.href}" class="${l.key === activePage ? 'active' : ''}" style="display:inline-flex;align-items:center;gap:8px"><svg class="ui-icon"><use href="/img/ui-icons.svg#${l.icon}"></use></svg><span data-i18n="${
        l.key==='dashboard'?'nav.dashboard':l.key==='catalog'?'nav.tasks':l.key==='leaderboard'?'nav.leaderboard':l.key==='profile'?'nav.profile':l.key==='teacher'?'nav.students':l.key==='admin'?'nav.admin':l.key==='parent'?'nav.parent':l.key==='chats'?'nav.chats':'nav.manage'
      }">${l.label}</span></a>`).join('')}
    </div>
    <div class="navbar-right" style="display:flex;align-items:center;gap:14px">
      ${langHtml}
      <span id="notifBell" class="notif-bell" onclick="toggleNotifPanel()" data-i18n-title="nav.notifications" style="position:relative;cursor:pointer;display:inline-flex">
        <svg class="ui-icon"><use href="/img/ui-icons.svg#bell"></use></svg>
        <span id="notifCount" class="notif-count" style="display:none"></span>
      </span>
      <div class="navbar-user" style="cursor:pointer">
        <a href="/pages/profile.html" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit" data-i18n-title="nav.my_profile">
          ${user.avatar_url
            ? `<img src="${escapeHtml(user.avatar_url)}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover">`
            : `<div class="avatar">${initial}</div>`}
          <div>
            <div style="font-weight:700;font-size:13px">${escapeHtml(user.name)}</div>
            <div style="font-size:11px;color:#64748b" data-i18n="nav.my_profile">${T('nav.my_profile')}</div>
          </div>
        </a>
        <span onclick="logout()" data-i18n-title="nav.logout" style="margin-left:8px;padding:6px;border-radius:6px;cursor:pointer;display:inline-flex">
          <svg class="ui-icon"><use href="/img/ui-icons.svg#logout"></use></svg>
        </span>
      </div>
    </div>
    <div id="notifPanel" class="notif-panel" style="display:none"></div>
  </nav>`;
}

/* ---------- Уведомления (колокольчик) ---------- */
let _notifLoaded = false;
async function loadNotifBadge() {
  try {
    const u = API.getCurrentUser();
    if (!u) return;
    const { unread } = await API.getNotifications();
    const badge = document.getElementById('notifCount');
    if (!badge) return;
    if (unread > 0) { badge.textContent = unread > 99 ? '99+' : unread; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  } catch {}
}

async function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML = `<div style="padding:16px;color:#64748b">${I18N ? I18N.t('common.loading') : '...'}</div>`;
  try {
    const { items } = await API.getNotifications();
    if (!items.length) {
      panel.innerHTML = `<div style="padding:18px;color:#64748b;text-align:center">${I18N.t('notif.empty')}</div>`;
      return;
    }
    const head = `<div class="notif-head"><b>${I18N.t('nav.notifications')}</b>
      <button class="btn btn-sm btn-ghost" onclick="markAllNotif()">${I18N.t('notif.mark_all')}</button></div>`;
    const list = items.map(n => `
      <a class="notif-item ${n.read ? '' : 'unread'} ${n.type === 'missing_report' ? 'urgent' : ''}" href="${n.link || '#'}" onclick="return openNotif(event,'${n.id}',this.href)">
        <div class="notif-text">${n.type === 'missing_report' ? uiIcon('warning') : ''}${escapeHtml(n.text)}</div>
        <div class="notif-time">${fmtDateTime(n.createdAt)}${n.read ? ' · Прочитано' : ' · Новое'}</div>
      </a>`).join('');
    panel.innerHTML = head + `<div class="notif-list">${list}</div>`;
  } catch (e) {
    panel.innerHTML = `<div style="padding:16px;color:#ef4444">${escapeHtml(e.message)}</div>`;
  }
}
async function markNotif(id) { try { await API.markNotifRead(id); loadNotifBadge(); } catch {} }
async function openNotif(event,id,href) {
  event?.preventDefault();
  try { await API.markNotifRead(id); await loadNotifBadge(); }
  finally { if (href && href !== location.href + '#') location.href = href; }
  return false;
}
async function markAllNotif() {
  try {
    await API.markAllNotifRead();
    await loadNotifBadge();
    const panel=document.getElementById('notifPanel');
    if(panel){panel.style.display='none';await toggleNotifPanel();}
  } catch {}
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  const bell = document.getElementById('notifBell');
  if (panel && panel.style.display === 'block' && bell && !bell.contains(e.target) && !panel.contains(e.target)) {
    panel.style.display = 'none';
  }
});

function logout() {
  API.logout();
  window.location.href = '/index.html';
}

function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  const bg = type==='success' ? '#10b981' : type==='error' ? '#ef4444' : type==='warning' ? '#f59e0b' : '#3b82f6';
  t.style.cssText = `position:fixed;top:80px;right:24px;background:${bg};color:white;padding:14px 22px;border-radius:12px;font-weight:700;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.2);animation:fadeIn 0.3s`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='all 0.3s'; }, 2500);
  setTimeout(() => t.remove(), 3000);
}

function fireConfetti() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#fbbf24','#a855f7','#10b981','#3b82f6','#ec4899'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('div');
    const size = 6 + Math.random() * 8;
    p.style.cssText = `position:fixed;width:${size}px;height:${size}px;background:${colors[i%5]};top:30%;left:${Math.random()*100}%;border-radius:${Math.random()>0.5?'50%':'2px'};z-index:9999;pointer-events:none;transition:all 2s ease-out;`;
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.top = (60 + Math.random() * 40) + '%';
      p.style.left = (Math.random() * 100) + '%';
      p.style.transform = `rotate(${Math.random()*720}deg)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 2500);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   Дата: единый безопасный парсер.
   Корень бага «Invalid Date»: даты пишутся как getTime() (число),
   но колонка date — TEXT, и SQLite хранит её как строку "1781568000000".
   new Date("1781568000000") → Invalid Date (числовая строка не парсится
   как timestamp). Этот парсер принимает и число (мс), и числовую строку,
   и ISO-строку ("2026-06-16"), и возвращает Date либо null.
   ============================================================ */
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return isNaN(v) ? null : new Date(v);
  const s = String(v).trim();
  if (!s) return null;
  // Чисто числовая строка → это timestamp в миллисекундах
  const d = /^\d{8,}$/.test(s) ? new Date(Number(s)) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(v, locale) {
  const d = toDate(v);
  return d ? d.toLocaleDateString(locale || undefined) : '—';
}
function fmtDateTime(v, locale) {
  const d = toDate(v);
  return d ? d.toLocaleString(locale || undefined) : '—';
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

window.requireAuth = requireAuth;
window.renderNavbar = renderNavbar;
window.logout = logout;
window.uiIcon = uiIcon;
window.showToast = showToast;
window.fireConfetti = fireConfetti;
window.escapeHtml = escapeHtml;
window.toDate = toDate;
window.fmtDate = fmtDate;
window.fmtDateTime = fmtDateTime;
window.getQueryParam = getQueryParam;
window.toggleNotifPanel = toggleNotifPanel;
window.loadNotifBadge = loadNotifBadge;
window.markNotif = markNotif;
window.openNotif = openNotif;
window.markAllNotif = markAllNotif;

// Подгружаем счётчик уведомлений после отрисовки навбара
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { if (document.getElementById('notifBell')) loadNotifBadge(); }, 300);
});
