// ============================================
//  app.js — точка входа фронтенда
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  // Инициализируем переключение вкладок auth
  Auth.initTabs();

  // Пробуем восстановить сессию
  const restored = await Auth.tryRestoreSession();
  if (restored) {
    Auth.enterApp();
  }
  // Иначе показываем auth screen (он виден по умолчанию)
});
