const Auth = (() => {
  let currentUser = null;

  function getUser() {
    return currentUser;
  }

  function setUser(user) {
    currentUser = user;
    const displayName = user.name || 'Student';
    const initials = displayName
      .split(' ')
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();

    document.getElementById('sb-avatar').textContent = initials;
    document.getElementById('sb-uname').textContent = displayName.split(' ')[0];
    document.getElementById('sb-ugroup').textContent = user.group || AppPrefs.t('common.noGroup');
  }

  function initTabs() {
    document.querySelectorAll('.atab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.atab').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.aform').forEach((form) => form.classList.remove('active'));
        document.getElementById('form-' + tab).classList.add('active');

        const slider = document.querySelector('.atab-slider');
        slider.classList.toggle('right', tab === 'register');

        document.getElementById('login-err').textContent = '';
        document.getElementById('reg-err').textContent = '';
      });
    });
  }

  function submitIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }

  async function login(e) {
    e.preventDefault();
    const form = e.target;
    const email = form.email.value.trim();
    const pw = form.password.value;
    const errEl = document.getElementById('login-err');
    const btn = form.querySelector('.btn-submit');

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';

    try {
      const { token, user } = await API.login(email, pw);
      localStorage.setItem('aitu_token', token);
      setUser(user);
      enterApp();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span>${AppPrefs.t('auth.loginBtn')}</span>${submitIcon()}`;
    }
  }

  async function register(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const group = form.group.value.trim();
    const pw = form.password.value;
    const confirm = form.confirm.value;
    const errEl = document.getElementById('reg-err');

    if (pw !== confirm) {
      errEl.textContent = AppPrefs.t('auth.passwordMismatch');
      return;
    }
    if (pw.length < 6) {
      errEl.textContent = AppPrefs.t('auth.passwordTooShort');
      return;
    }

    const btn = form.querySelector('.btn-submit');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';

    try {
      const { token, user } = await API.register(name, email, group, pw);
      localStorage.setItem('aitu_token', token);
      setUser(user);
      enterApp();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span>${AppPrefs.t('auth.registerBtn')}</span>${submitIcon()}`;
    }
  }

  function logout() {
    localStorage.removeItem('aitu_token');
    currentUser = null;
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    ChatUI.reset();
  }

  function enterApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    ChatUI.init();
    ProfileUI.init();
  }

  async function tryRestoreSession() {
    const tok = localStorage.getItem('aitu_token');
    if (!tok) return false;

    try {
      const { user } = await API.me();
      setUser(user);
      return true;
    } catch {
      localStorage.removeItem('aitu_token');
      return false;
    }
  }

  return { login, register, logout, getUser, setUser, initTabs, tryRestoreSession, enterApp };
})();
