document.addEventListener('DOMContentLoaded', async () => {
  AppPrefs.init();
  Auth.initTabs();

  const restored = await Auth.tryRestoreSession();
  if (restored) {
    Auth.enterApp();
  } else if (typeof Landing !== 'undefined' && !Landing.isTelegramMiniApp()) {
    Landing.showLanding();
  } else {
    Auth.enterAuth();
  }
});
