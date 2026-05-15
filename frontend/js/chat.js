// ============================================
//  chat.js — UI чата с AI
// ============================================
const ChatUI = (() => {
  let currentChatId = null;
  let chats = [];
  let sending = false;

  async function init() {
    await loadChats();
  }

  function reset() {
    currentChatId = null;
    chats = [];
    document.getElementById('ch-list').innerHTML = '';
    clearMessages();
  }

  // ---- History ----
  async function loadChats() {
    try {
      const { chats: list } = await API.getChats();
      chats = list;
      renderHistory();
    } catch (e) {
      console.error('loadChats:', e);
    }
  }

  function renderHistory() {
    const list = document.getElementById('ch-list');
    if (!chats.length) {
      list.innerHTML = '<div style="padding:16px 12px;color:var(--t3);font-size:12px;text-align:center">Нет чатов. Начните новый!</div>';
      return;
    }
    list.innerHTML = chats.map(c => `
      <div class="ch-item ${c._id === currentChatId ? 'active' : ''}"
           onclick="ChatUI.openChat('${c._id}')">
        <div class="ch-item-title">💬 ${escHtml(c.title)}</div>
        <div class="ch-item-time">${fmtDate(c.updatedAt)}</div>
        <button class="ch-delete-btn" onclick="event.stopPropagation(); ChatUI.deleteChat('${c._id}')" title="Удалить чат">
          🗑️
        </button>
      </div>`).join('');
  }

  async function deleteChat(id) {
    if (!confirm('Удалить этот чат?')) return;
    
    try {
      await API.deleteChat(id);
      chats = chats.filter(c => c._id !== id);
      
      if (currentChatId === id) {
        currentChatId = null;
        clearMessages();
        document.getElementById('chat-title').textContent = 'Выберите чат';
      }
      
      renderHistory();
    } catch (e) {
      console.error('deleteChat:', e);
      alert('Ошибка при удалении чата: ' + e.message);
    }
  }

  async function newChat() {
    try {
      const { chat } = await API.createChat();
      chats.unshift(chat);
      currentChatId = chat._id;
      renderHistory();
      clearMessages();
      document.getElementById('chat-title').textContent = 'Новый чат';
    } catch (e) { alert('Ошибка: ' + e.message); }
  }

  async function openChat(id) {
    currentChatId = id;
    renderHistory();
    clearMessages();
    try {
      const { chat } = await API.getChat(id);
      document.getElementById('chat-title').textContent = chat.title;
      if (chat.messages.length === 0) return;
      hideEmpty();
      chat.messages.forEach(m => appendMessage(m.content, m.role, m.time, false));
      scrollBottom();
    } catch (e) { console.error(e); }
  }

  function toggleHistory() {
    document.getElementById('chat-history').classList.toggle('hidden-panel');
  }

  // ---- Send ----
  async function send() {
    if (sending) return;
    const ta   = document.getElementById('chat-input');
    const text = ta.value.trim();
    if (!text) return;

    // Убедимся что есть чат
    if (!currentChatId) await newChat();

    ta.value = '';
    ta.style.height = 'auto';
    sending = true;
    document.getElementById('send-btn').disabled = true;

    hideEmpty();
    const now = new Date().toISOString();
    appendMessage(text, 'user', now);
    const optimisticTitle = text.slice(0, 40) + (text.length > 40 ? '...' : '');
    const activeChat = chats.find(c => c._id === currentChatId);
    if (activeChat && (!activeChat.title || activeChat.title === 'Новый чат')) {
      activeChat.title = optimisticTitle;
      activeChat.updatedAt = now;
      document.getElementById('chat-title').textContent = optimisticTitle;
      renderHistory();
    }
    const typing = showTyping();
    scrollBottom();

    try {
      const { botMessage, chatTitle } = await API.sendMessage(currentChatId, text);
      typing.remove();
      appendMessage(botMessage.content, 'assistant', botMessage.time);
      scrollBottom();

      // Обновляем заголовок в истории
      const chat = chats.find(c => c._id === currentChatId);
      if (chat) {
        chat.title = chatTitle;
        chat.updatedAt = new Date().toISOString();
        renderHistory();
        document.getElementById('chat-title').textContent = chatTitle;
      }
    } catch (e) {
      typing.remove();
      appendMessage('⚠️ Ошибка: ' + e.message + '\n\nПроверьте подключение к серверу.', 'assistant', new Date().toISOString());
      scrollBottom();
    } finally {
      sending = false;
      document.getElementById('send-btn').disabled = false;
    }
  }

  function chip(btn) {
    document.getElementById('chat-input').value = btn.textContent.replace(/^[^\s]+\s/, '');
    send();
  }

  function keydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function resize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 130) + 'px';
  }

  // ---- DOM helpers ----
  function appendMessage(text, role, time, animate = true) {
    const wrap = document.getElementById('chat-msgs');
    const user = Auth.getUser();
    const initials = user ? user.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase() : 'Вы';

    const div = document.createElement('div');
    div.className = `msg-row ${role === 'user' ? 'user' : 'bot'}${animate ? ' anim-up' : ''}`;

    // Форматируем текст — переносы строк → <br>, маркированные строки
    const formatted = formatText(text);

    div.innerHTML = `
      <div class="msg-avatar">${role === 'user' ? initials : '⬡'}</div>
      <div class="msg-content">
        <div class="msg-bubble">${formatted}</div>
        <div class="msg-time">${fmtTime(time)}</div>
      </div>`;
    wrap.appendChild(div);
  }

  function showTyping() {
    const wrap = document.getElementById('chat-msgs');
    const div  = document.createElement('div');
    div.className = 'typing-row anim-up';
    div.innerHTML = `
      <div class="msg-avatar" style="background:var(--abg);border:1px solid var(--a3);color:var(--a)">⬡</div>
      <div class="typing-bubble">
        <div class="td"></div><div class="td"></div><div class="td"></div>
      </div>`;
    wrap.appendChild(div);
    return div;
  }

  function clearMessages() {
    const wrap = document.getElementById('chat-msgs');
    wrap.innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <span class="ce-icon">⬡</span>
        <h3>Привет! Я Pocket Moodle</h3>
        <p>Помогу с расписанием, дедлайнами, attendance и вопросами по учебе.</p>
        <div class="ce-chips">
          <button onclick="ChatUI.chip(this)">Что у меня по дедлайнам?</button>
          <button onclick="ChatUI.chip(this)">Объясни ближайшее расписание</button>
          <button onclick="ChatUI.chip(this)">Как улучшить attendance?</button>
          <button onclick="ChatUI.chip(this)">Что самое срочное сегодня?</button>
        </div>
      </div>`;
  }

  function hideEmpty() {
    const el = document.getElementById('chat-empty');
    if (el) el.remove();
  }

  function scrollBottom() {
    const wrap = document.getElementById('chat-msgs');
    wrap.scrollTop = wrap.scrollHeight;
  }

  // Простое форматирование текста бота
  function formatText(text) {
    // Экранируем HTML
    let t = escHtml(text);
    // Переносы строк → <br>
    t = t.replace(/\n\n+/g, '</p><p>');
    t = t.replace(/\n/g, '<br>');
    // Жирный **text**
    t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Маркированные пункты: • или -
    t = t.replace(/(^|<br>)[•\-]\s(.+)/g, '$1<span style="display:flex;gap:6px;margin:2px 0"><span style="color:var(--a);flex-shrink:0">›</span><span>$2</span></span>');
    return `<p>${t}</p>`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return fmtTime(iso);
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  }

  return { init, reset, newChat, openChat, deleteChat, toggleHistory, send, chip, keydown, resize };
})();
