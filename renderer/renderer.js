// Navigation
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');

function navigateTo(pageName) {
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageName);
  });

  pages.forEach(page => {
    page.classList.toggle('active', page.id === `page-${pageName}`);
  });
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navigateTo(item.dataset.page);
  });
});

// Make navigateTo available globally for inline onclick handlers
window.navigateTo = navigateTo;

// Chat functionality
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');

function addMessage(text, isUser = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;

  const avatarHTML = isUser
    ? `<div class="message-avatar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      </div>`
    : `<div class="message-avatar">
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" stroke="#6366f1" stroke-width="2.5"/>
          <circle cx="16" cy="16" r="6" fill="#6366f1"/>
        </svg>
      </div>`;

  messageDiv.innerHTML = `
    ${avatarHTML}
    <div class="message-content">
      <p>${escapeHtml(text)}</p>
    </div>
  `;

  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  addMessage(text, true);
  chatInput.value = '';

  // Simulate AI response
  setTimeout(() => {
    const responses = [
      'Thank you for your message! I\'m here to help.',
      'That\'s an interesting question. Let me think about it...',
      'I understand. Could you tell me more about what you need?',
      'I\'m processing your request. OneManCrew AI is at your service!',
      'Great question! Let me provide you with some insights.',
    ];
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    addMessage(randomResponse, false);
  }, 800);
}

sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Focus chat input when navigating to chat page
const chatNavItem = document.querySelector('[data-page="chat"]');
if (chatNavItem) {
  chatNavItem.addEventListener('click', () => {
    setTimeout(() => chatInput.focus(), 100);
  });
}

console.log('OneManCrew AI - Renderer initialized');
