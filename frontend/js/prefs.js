const AppPrefs = (() => {
  const LANG_KEY = 'aitu_lang';
  const THEME_KEY = 'aitu_theme';
  const langs = ['kk', 'ru', 'en'];
  const themes = ['light', 'dark'];
  const cp1251Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('windows-1251') : null;
  const cp1251Encode = new Map();

  if (cp1251Decoder) {
    for (let i = 0; i < 256; i += 1) {
      cp1251Encode.set(cp1251Decoder.decode(Uint8Array.from([i])), i);
    }
  }

  function repairMojibakeToken(token) {
    if (!cp1251Decoder || !/[РСрСЃвЂТљ]/.test(token)) return token;
    const bytes = [];
    for (const char of token) {
      if (!cp1251Encode.has(char)) return token;
      bytes.push(cp1251Encode.get(char));
    }
    const fixed = new TextDecoder().decode(Uint8Array.from(bytes));
    return fixed.includes('\uFFFD') ? token : fixed;
  }

  function repairMojibakeText(text) {
    return String(text || '').replace(/[\u0080-\u00ff\u0400-\u04ff\u2010-\u2026\u2030-\u203a\u20ac\u2122]+/g, repairMojibakeToken);
  }

  const dict = {
    ru: {
      'auth.loginTab': 'Вход',
      'auth.registerTab': 'Регистрация',
      'auth.welcome': 'С возвращением',
      'auth.loginSub': 'Войдите, чтобы продолжить',
      'auth.email': 'Электронная почта',
      'auth.password': 'Пароль',
      'auth.name': 'Имя и фамилия',
      'auth.group': 'Группа',
      'auth.confirm': 'Подтверждение',
      'auth.passwordMin': 'минимум 6 символов',
      'auth.repeatPassword': 'повторите пароль',
      'auth.loginBtn': 'Войти',
      'auth.registerBtn': 'Зарегистрироваться',
      'auth.logout': 'Выйти',
      'auth.passwordMismatch': 'Пароли не совпадают',
      'auth.passwordTooShort': 'Пароль минимум 6 символов',
      'nav.chat': 'Чат',
      'nav.deadlines': 'Дедлайны',
      'nav.schedule': 'Расписание',
      'nav.teachers': 'Преподаватели',
      'nav.syllabus': 'Силлабусы',
      'nav.settings': 'Настройки',
      'nav.map': 'Карта',
      'sidebar.collapse': 'Свернуть',
      'sidebar.open': 'Открыть меню',
      'prefs.language': 'Язык',
      'prefs.theme': 'Тема',
      'prefs.appearance': 'Внешний вид',
      'prefs.themeLabel': 'Тема интерфейса',
      'prefs.light': 'Светлая',
      'prefs.dark': 'Тёмная',
      'common.loading': 'Загрузка...',
      'common.noGroup': 'Без группы',
      'chat.history': 'Чаты',
      'chat.newChat': 'Новый чат',
      'chat.online': 'AI на связи',
      'chat.emptyTitle': 'Привет! Я Pocket Moodle',
      'chat.emptyText': 'Помогу с вопросами об Astana IT University: поступление, программы, стоимость, расписание и всё остальное.',
      'chat.chipAdmission': 'Как поступить в AITU?',
      'chat.chipCost': 'Стоимость обучения',
      'chat.chipPrograms': 'Образовательные программы',
      'chat.chipDates': 'Даты зачисления',
      'chat.chipDorm': 'Есть ли общежитие?',
      'chat.chipLanguage': 'На каком языке обучение?',
      'chat.placeholder': 'Задайте вопрос об AITU или любую другую тему...',
      'chat.send': 'Отправить',
      'chat.hint': 'Pocket Moodle может ошибаться. Важные учебные данные сверяйте с Moodle.',
      'pages.deadlinesTitle': 'Дедлайны',
      'pages.deadlinesSub': 'Горящие и ближайшие события из Moodle Calendar',
      'pages.scheduleTitle': 'Расписание',
      'pages.scheduleSub': 'Пары из Moodle Calendar',
      'pages.attendanceSub': 'Быстрый расчёт посещаемости и допустимых пропусков',
      'pages.teachersTitle': 'Поиск преподавателей',
      'pages.teachersSub': 'Автоматическая загрузка из Moodle Calendar',
      'pages.syllabusTitle': 'Силлабусы',
      'pages.syllabusSub': 'Список и детали силлабусов из DU',
      'pages.mapTitle': 'Карта кампуса',
      'pages.mapSub': 'EXPO, блок C1, Астана',
      'pages.settingsTitle': 'Настройки',
      'pages.settingsSub': 'Профиль, уведомления и индивидуальный Moodle Calendar URL'
    },
    kk: {
      'auth.loginTab': 'Кіру',
      'auth.registerTab': 'Тіркелу',
      'auth.welcome': 'Қайта қош келдіңіз',
      'auth.loginSub': 'Жалғастыру үшін жүйеге кіріңіз',
      'auth.email': 'Электрондық пошта',
      'auth.password': 'Құпиясөз',
      'auth.name': 'Аты-жөні',
      'auth.group': 'Топ',
      'auth.confirm': 'Растау',
      'auth.passwordMin': 'кемінде 6 таңба',
      'auth.repeatPassword': 'құпиясөзді қайталаңыз',
      'auth.loginBtn': 'Кіру',
      'auth.registerBtn': 'Тіркелу',
      'auth.logout': 'Шығу',
      'auth.passwordMismatch': 'Құпиясөздер сәйкес келмейді',
      'auth.passwordTooShort': 'Құпиясөз кемінде 6 таңба болуы керек',
      'nav.chat': 'Чат',
      'nav.deadlines': 'Дедлайндар',
      'nav.schedule': 'Кесте',
      'nav.teachers': 'Оқытушылар',
      'nav.syllabus': 'Силлабустар',
      'nav.settings': 'Баптаулар',
      'nav.map': 'Карта',
      'sidebar.collapse': 'Жинау',
      'sidebar.open': 'Мәзірді ашу',
      'prefs.language': 'Тіл',
      'prefs.theme': 'Тақырып',
      'prefs.appearance': 'Сыртқы көрініс',
      'prefs.themeLabel': 'Интерфейс тақырыбы',
      'prefs.light': 'Жарық',
      'prefs.dark': 'Қараңғы',
      'common.loading': 'Жүктелуде...',
      'common.noGroup': 'Топ жоқ',
      'chat.history': 'Чаттар',
      'chat.newChat': 'Жаңа чат',
      'chat.online': 'AI байланыста',
      'chat.emptyTitle': 'Сәлем! Мен Pocket Moodle',
      'chat.emptyText': 'Astana IT University туралы сұрақтарға көмектесемін: қабылдау, бағдарламалар, оқу ақысы, кесте және тағы басқалар.',
      'chat.chipAdmission': 'AITU-ға қалай түсуге болады?',
      'chat.chipCost': 'Оқу ақысы',
      'chat.chipPrograms': 'Білім беру бағдарламалары',
      'chat.chipDates': 'Қабылдау күндері',
      'chat.chipDorm': 'Жатақхана бар ма?',
      'chat.chipLanguage': 'Оқу қай тілде өтеді?',
      'chat.placeholder': 'AITU туралы немесе басқа тақырыпта сұрақ қойыңыз...',
      'chat.send': 'Жіберу',
      'chat.hint': 'Pocket Moodle қателесуі мүмкін. Маңызды оқу деректерін Moodle арқылы тексеріңіз.',
      'pages.deadlinesTitle': 'Дедлайндар',
      'pages.deadlinesSub': 'Moodle Calendar ішіндегі жақын және шұғыл оқиғалар',
      'pages.scheduleTitle': 'Кесте',
      'pages.scheduleSub': 'Moodle Calendar сабақтары',
      'pages.attendanceSub': 'Қатысымды және рұқсат етілетін қалуларды жылдам есептеу',
      'pages.teachersTitle': 'Оқытушыларды іздеу',
      'pages.teachersSub': 'Moodle Calendar арқылы автоматты жүктеу',
      'pages.syllabusTitle': 'Силлабустар',
      'pages.syllabusSub': 'DU ішіндегі силлабустар тізімі мен мәліметтері',
      'pages.mapTitle': 'Кампус картасы',
      'pages.mapSub': 'EXPO, C1 блогы, Астана',
      'pages.settingsTitle': 'Баптаулар',
      'pages.settingsSub': 'Профиль, хабарламалар және жеке Moodle Calendar URL'
    },
    en: {
      'auth.loginTab': 'Sign in',
      'auth.registerTab': 'Register',
      'auth.welcome': 'Welcome back',
      'auth.loginSub': 'Sign in to continue',
      'auth.email': 'Email',
      'auth.password': 'Password',
      'auth.name': 'Full name',
      'auth.group': 'Group',
      'auth.confirm': 'Confirmation',
      'auth.passwordMin': 'at least 6 characters',
      'auth.repeatPassword': 'repeat password',
      'auth.loginBtn': 'Sign in',
      'auth.registerBtn': 'Create account',
      'auth.logout': 'Log out',
      'auth.passwordMismatch': 'Passwords do not match',
      'auth.passwordTooShort': 'Password must be at least 6 characters',
      'nav.chat': 'Chat',
      'nav.deadlines': 'Deadlines',
      'nav.schedule': 'Schedule',
      'nav.teachers': 'Teachers',
      'nav.syllabus': 'Syllabi',
      'nav.settings': 'Settings',
      'nav.map': 'Map',
      'sidebar.collapse': 'Collapse',
      'sidebar.open': 'Open menu',
      'prefs.language': 'Language',
      'prefs.theme': 'Theme',
      'prefs.appearance': 'Appearance',
      'prefs.themeLabel': 'Interface theme',
      'prefs.light': 'Light',
      'prefs.dark': 'Dark',
      'common.loading': 'Loading...',
      'common.noGroup': 'No group',
      'chat.history': 'Chats',
      'chat.newChat': 'New chat',
      'chat.online': 'AI is online',
      'chat.emptyTitle': 'Hi! I am Pocket Moodle',
      'chat.emptyText': 'I can help with Astana IT University questions: admission, programs, tuition, schedule, and more.',
      'chat.chipAdmission': 'How do I apply to AITU?',
      'chat.chipCost': 'Tuition cost',
      'chat.chipPrograms': 'Degree programs',
      'chat.chipDates': 'Enrollment dates',
      'chat.chipDorm': 'Is there a dormitory?',
      'chat.chipLanguage': 'What language is used for study?',
      'chat.placeholder': 'Ask about AITU or anything else...',
      'chat.send': 'Send',
      'chat.hint': 'Pocket Moodle can make mistakes. Check important academic data in Moodle.',
      'pages.deadlinesTitle': 'Deadlines',
      'pages.deadlinesSub': 'Urgent and upcoming events from Moodle Calendar',
      'pages.scheduleTitle': 'Schedule',
      'pages.scheduleSub': 'Classes from Moodle Calendar',
      'pages.attendanceSub': 'Quick attendance and absence allowance calculator',
      'pages.teachersTitle': 'Teacher search',
      'pages.teachersSub': 'Automatic loading from Moodle Calendar',
      'pages.syllabusTitle': 'Syllabi',
      'pages.syllabusSub': 'Syllabus list and details from DU',
      'pages.mapTitle': 'Campus map',
      'pages.mapSub': 'EXPO, C1 block, Astana',
      'pages.settingsTitle': 'Settings',
      'pages.settingsSub': 'Profile, notifications, and personal Moodle Calendar URL'
    }
  };

  function getLanguage() {
    const saved = localStorage.getItem(LANG_KEY);
    return langs.includes(saved) ? saved : 'ru';
  }

  function getTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (themes.includes(saved)) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function t(key) {
    const lang = getLanguage();
    return repairMojibakeText(dict[lang]?.[key] || dict.ru[key] || key);
  }

  function applyLanguage() {
    const lang = getLanguage();
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
    const select = document.getElementById('language-select');
    if (select) select.value = lang;
  }

  function applyTheme() {
    const theme = getTheme();
    document.documentElement.dataset.theme = theme;
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = theme;
  }

  function init() {
    applyTheme();
    applyLanguage();
  }

  function setLanguage(lang) {
    if (!langs.includes(lang)) return;
    localStorage.setItem(LANG_KEY, lang);
    applyLanguage();
    if (document.getElementById('page-profile')?.classList.contains('active') && typeof ProfileUI !== 'undefined') {
      ProfileUI.render();
      applyLanguage();
    }
    window.dispatchEvent(new CustomEvent('prefs:language-change', { detail: { lang } }));
  }

  function setTheme(theme) {
    if (!themes.includes(theme)) return;
    localStorage.setItem(THEME_KEY, theme);
    applyTheme();
  }

  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  return { init, t, getLanguage, getTheme, setLanguage, setTheme, toggleTheme, applyLanguage, applyTheme };
})();
