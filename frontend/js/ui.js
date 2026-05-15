// ============================================
//  ui.js — навигация и глобальный UI
// ============================================
const UI = (() => {
  let currentPage = 'chat';

  function nav(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
    document.getElementById('sidebar')?.classList.remove('open');

    const pageEl = document.getElementById('page-' + page);
    const navEl  = document.querySelector(`.nb[data-page="${page}"]`);
    if (pageEl) pageEl.classList.add('active');
    if (navEl)  navEl.classList.add('active');

    // Lazy init pages
    if (page === 'dashboard') DashUI.init();
    if (page === 'schedule')  ScheduleUI.init();
    if (page === 'attendance') AttendanceUI.init();
    if (page === 'teachers')   TeachersUI.init();
    if (page === 'syllabus')   SyllabusUI.init();
    if (page === 'map')       MapUI.init();
    if (page === 'profile')   ProfileUI.render();
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (window.matchMedia('(max-width: 760px)').matches) {
      sidebar.classList.toggle('open');
    } else {
      sidebar.classList.toggle('collapsed');
    }
  }

  return { nav, toggleSidebar };
})();
