/* ============================================================
   KURSOR — Общая логика (навбар, утилиты). Использует window.API.
   ============================================================ */

function requireAuth(allowedRoles) {
  return API.requireAuth(allowedRoles);
}

function renderNavbar(activePage) {
  const user = API.getCurrentUser();
  if (!user) return '';
  const initial = (user.name || 'У').charAt(0).toUpperCase();
  const T = (window.I18N ? I18N.t : (k)=>k);
  const links = user.role === 'student' ? [
    { href:'/pages/dashboard.html', icon:'https://cdn-icons-png.flaticon.com/512/1946/1946436.png', label:T('nav.dashboard'), key:'dashboard' },
    { href:'/pages/catalog.html', icon:'https://cdn-icons-png.flaticon.com/512/2232/2232688.png', label:T('nav.tasks'), key:'catalog' },
    { href:'/pages/leaderboard.html', icon:'https://cdn-icons-png.flaticon.com/512/2583/2583344.png', label:T('nav.leaderboard'), key:'leaderboard' },
    { href:'/pages/profile.html', icon:'https://cdn-icons-png.flaticon.com/512/1144/1144760.png', label:T('nav.profile'), key:'profile' },
  ] : (user.role === 'teacher' || user.role === 'assistant') ? [
    { href:'/pages/teacher.html', icon:'https://cdn-icons-png.flaticon.com/512/1995/1995450.png', label:T('nav.students'), key:'teacher' },
    { href:'/pages/catalog.html', icon:'https://cdn-icons-png.flaticon.com/512/2232/2232688.png', label:T('nav.tasks'), key:'catalog' },
    { href:'/admin/index.html', icon:'https://cdn-icons-png.flaticon.com/512/3524/3524388.png', label:T('nav.manage'), key:'admin' },
  ] : user.role === 'parent' ? [
    { href:'/pages/parent.html', icon:'https://cdn-icons-png.flaticon.com/512/1946/1946436.png', label:T('nav.parent'), key:'parent' },
  ] : [
    { href:'/admin/index.html', icon:'https://cdn-icons-png.flaticon.com/512/3524/3524388.png', label:T('nav.admin'), key:'admin' },
  ];

  const langHtml = window.I18N ? I18N.switcherHtml() : '';

  return `
  <nav class="navbar">
    <a class="navbar-logo" href="/index.html">
      <img src="${KURSOR_DB.LOGO}" alt="KURSOR">
    </a>
    <div class="navbar-menu">
      ${links.map(l => `<a href="${l.href}" class="${l.key === activePage ? 'active' : ''}" style="display:inline-flex;align-items:center;gap:8px"><img class="ic ic-20" src="${l.icon}" alt=""> <span data-i18n="${
        l.key==='dashboard'?'nav.dashboard':l.key==='catalog'?'nav.tasks':l.key==='leaderboard'?'nav.leaderboard':l.key==='profile'?'nav.profile':l.key==='teacher'?'nav.students':l.key==='admin'?'nav.admin':l.key==='parent'?'nav.parent':'nav.manage'
      }">${l.label}</span></a>`).join('')}
    </div>
    <div class="navbar-right" style="display:flex;align-items:center;gap:14px">
      ${langHtml}
      <span id="notifBell" class="notif-bell" onclick="toggleNotifPanel()" data-i18n-title="nav.notifications" style="position:relative;cursor:pointer;display:inline-flex">
        <img class="ic ic-24" src="https://cdn-icons-png.flaticon.com/512/1827/1827347.png" alt="">
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
          <img class="ic ic-20" src="https://cdn-icons-png.flaticon.com/512/1828/1828479.png" alt="">
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
      <a class="notif-item ${n.read ? '' : 'unread'} ${n.type === 'missing_report' ? 'urgent' : ''}" href="${n.link || '#'}" onclick="markNotif('${n.id}')">
        <div class="notif-text">${n.type === 'missing_report' ? '⚠️ ' : ''}${escapeHtml(n.text)}</div>
        <div class="notif-time">${fmtDateTime(n.createdAt)}</div>
      </a>`).join('');
    panel.innerHTML = head + `<div class="notif-list">${list}</div>`;
  } catch (e) {
    panel.innerHTML = `<div style="padding:16px;color:#ef4444">${escapeHtml(e.message)}</div>`;
  }
}
async function markNotif(id) { try { await API.markNotifRead(id); loadNotifBadge(); } catch {} }
async function markAllNotif() { try { await API.markAllNotifRead(); loadNotifBadge(); toggleNotifPanel(); toggleNotifPanel(); } catch {} }

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
  const bg = type==='success' ? '#10b981' : type==='error' ? '#ef4444' : type==='warning' ? '#f59e0b' : '#3b82f6';
  t.style.cssText = `position:fixed;top:80px;right:24px;background:${bg};color:white;padding:14px 22px;border-radius:12px;font-weight:700;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.2);animation:fadeIn 0.3s`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='all 0.3s'; }, 2500);
  setTimeout(() => t.remove(), 3000);
}

function fireConfetti() {
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
window.markAllNotif = markAllNotif;

// Подгружаем счётчик уведомлений после отрисовки навбара
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { if (document.getElementById('notifBell')) loadNotifBadge(); }, 300);
});
