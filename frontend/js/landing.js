const Landing = (() => {
  function render() {
    const root = document.getElementById('landing-screen');
    if (!root || root.dataset.rendered === 'true') return;

    root.innerHTML = `
      <header class="landing-topbar">
        <a class="landing-brand" href="#landing-home" aria-label="Pocket Moodle">
          <img class="landing-logo" src="img/POCKET(2).png" alt="Pocket Moodle" />
          <div>
            <div class="landing-brand-name">Pocket Moodle</div>
            <div class="landing-brand-sub">Astana IT University</div>
          </div>
        </a>
        <nav class="landing-nav" aria-label="Навигация лендинга">
          <a href="#aitu-about">AITU</a>
          <a href="#aitu-campus">Кампус</a>
          <a href="#landing-info">Сервис</a>
        </nav>
        <button class="landing-login" onclick="Landing.enterAuth()">Войти</button>
      </header>

      <main class="landing-main" id="landing-home">
        <section class="landing-hero">
          <div class="landing-copy">
            <p class="landing-kicker">AI assistant for AITU students</p>
            <h1>Astana IT University в одном удобном пространстве</h1>
            <p class="landing-lead">Pocket Moodle собирает расписание, преподавателей, силлабусы, дедлайны и быстрые ответы по университету в интерфейсе, который удобно открыть с сайта или из Telegram Mini App.</p>
            <div class="landing-actions">
              <button class="btn-submit landing-cta" onclick="Landing.enterAuth()">Начать</button>
              <a class="landing-secondary" href="#aitu-about">Узнать про AITU</a>
            </div>
          </div>

          <div class="landing-photo-grid" aria-label="Фотографии кампуса и учебной среды">
            <figure class="landing-photo large">
              <img src="https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=900&q=85" alt="Современный университетский кампус" />
              <figcaption>Кампус в деловом районе EXPO</figcaption>
            </figure>
            <figure class="landing-photo">
              <img src="https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=700&q=85" alt="Учебная аудитория" />
              <figcaption>Аудитории и лаборатории</figcaption>
            </figure>
            <figure class="landing-photo">
              <img src="https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=700&q=85" alt="Библиотека" />
              <figcaption>Библиотека и зоны учебы</figcaption>
            </figure>
            <figure class="landing-photo wide">
              <img src="https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=85" alt="Командная работа студентов" />
              <figcaption>Проекты, стартапы и IT-среда</figcaption>
            </figure>
          </div>
        </section>

        <section class="landing-section landing-about" id="aitu-about">
          <div class="landing-section-head">
            <p class="landing-kicker">About AITU</p>
            <h2>Университет, заточенный под цифровую экономику</h2>
            <p>Astana IT University развивает образование, науку и инновации вокруг цифровой трансформации Казахстана. Кампус расположен в Астане, в бизнес-центре EXPO, блок C1.</p>
          </div>
          <div class="landing-facts">
            <article><b>2019</b><span>год лицензии на образовательную деятельность AITU</span></article>
            <article><b>ICT</b><span>фокус университета: IT, инженерия, данные, кибербезопасность и цифровое управление</span></article>
            <article><b>EXPO C1</b><span>адрес кампуса: проспект Мәңгілік Ел, 55/11, Астана</span></article>
          </div>
        </section>

        <section class="landing-section landing-campus" id="aitu-campus">
          <div class="landing-section-head">
            <p class="landing-kicker">Campus</p>
            <h2>Инфраструктура для учебы, проектов и жизни</h2>
          </div>
          <div class="landing-metrics">
            <article><b>6</b><span>этажей кампуса</span></article>
            <article><b>31</b><span>лекционная аудитория</span></article>
            <article><b>800</b><span>мест в концертном холле</span></article>
            <article><b>500 м²</b><span>библиотека</span></article>
            <article><b>1000 м²</b><span>coworking-зона</span></article>
            <article><b>190</b><span>мест в столовой</span></article>
          </div>
        </section>

        <section class="landing-section landing-info" id="landing-info">
          <div class="landing-section-head">
            <p class="landing-kicker">Pocket Moodle</p>
            <h2>Что есть внутри</h2>
            <p>После входа студент получает доступ к учебным данным, которые мы уже переносим в собственный кэш: так интерфейс работает быстрее и меньше зависит от ручного поиска в разных системах.</p>
          </div>
          <div class="landing-grid">
            <article><b>Расписание</b><span>Пары группы и преподавателей из нашей базы DU cache.</span></article>
            <article><b>Силлабусы</b><span>PDF-файлы курсов и детали дисциплин в одном поиске.</span></article>
            <article><b>Преподаватели</b><span>Контакты, школы, должности и расписания по email.</span></article>
            <article><b>AI-оператор</b><span>Ответы по университету и персональному учебному контексту.</span></article>
          </div>
        </section>

        <section class="landing-final">
          <div>
            <p class="landing-kicker">Telegram ready</p>
            <h2>В мини-приложении лендинг пропускается</h2>
            <p>Если студент открывает сервис из Telegram Mini App, он сразу попадает к входу и не видит стартовую страницу.</p>
          </div>
          <button class="btn-submit landing-cta" onclick="Landing.enterAuth()">Войти в Pocket Moodle</button>
        </section>
      </main>
    `;

    root.dataset.rendered = 'true';
  }

  function isTelegramMiniApp() {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    return Boolean(
      window.Telegram?.WebApp ||
      params.has('tgWebAppData') ||
      hash.has('tgWebAppData') ||
      /Telegram/i.test(navigator.userAgent)
    );
  }

  function showLanding() {
    render();
    document.getElementById('landing-screen')?.classList.remove('hidden');
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('app')?.classList.add('hidden');
  }

  function enterAuth() {
    render();
    document.getElementById('landing-screen')?.classList.add('hidden');
    document.getElementById('auth-screen')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('hidden');
  }

  function hide() {
    document.getElementById('landing-screen')?.classList.add('hidden');
  }

  return { isTelegramMiniApp, showLanding, enterAuth, hide };
})();
