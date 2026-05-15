// ============================================
//  map.js - Интерактивная карта AITU
// ============================================
const MapPage = (() => {
  let mapLoaded = false;

  function init() {
    loadMap();
  }

  function loadMap() {
    const mapWrap = document.getElementById('map-wrap');
    
    if (mapLoaded) return;
    
    // Создаем iframe с картой
    mapWrap.innerHTML = `
      <div class="map-container">
        <iframe 
          src="https://yuujiso.github.io/aitumap/"
          class="map-iframe"
          title="Карта AITU"
          loading="lazy"
          allowfullscreen>
        </iframe>
        <div class="map-overlay">
          <div class="map-info">
            <h3>🗺️ Интерактивная карта AITU</h3>
            <p>Навигация по кампусу EXPO, блок С1</p>
            <div class="map-features">
              <div class="feature-item">
                <span class="feature-icon">📍</span>
                <span>Поиск аудиторий</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🏢</span>
                <span>3D модель кампуса</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🚻</span>
                <span>Санузлы и зоны отдыха</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🍽️</span>
                <span>Столовые и кафе</span>
              </div>
            </div>
          </div>
          <button class="map-close" onclick="MapPage.hideOverlay()">✕</button>
        </div>
      </div>
    `;
    
    // Автоматически скрываем оверлей через 5 секунд
    setTimeout(() => {
      hideOverlay();
    }, 5000);
    
    mapLoaded = true;
  }

  function hideOverlay() {
    const overlay = document.querySelector('.map-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }
  }

  function reset() {
    mapLoaded = false;
  }

  return { init, reset, hideOverlay };
})();
