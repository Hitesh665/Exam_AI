/**
 * ExamAI - Main Application Controller (app.js)
 * Coordinates conversational AI streaming, PDF & image ingestion,
 * Web Speech voice recognition & read-aloud, chat history management,
 * study plan generator, revision flashcards, and plain Canvas progress charts.
 */

// ==========================================
// Setup PDF.js Global Worker
// ==========================================
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ==========================================
// Application State
// ==========================================
let currentChatId = null;
let chatSessions = [];
let attachedFile = null; // { file, type: 'pdf'|'image'|'txt', name, data }
let isStreaming = false;
let isReadAloudEnabled = false;
let speechRecognition = null;
let isSpeechListening = false;

// Sample Initial Flashcards for Revision
let sampleFlashcards = [
  {
    front: 'What is the Principle of Conservation of Energy?',
    back: 'Energy cannot be created or destroyed; it can only be transformed from one form into another. Total energy in an isolated system remains constant.'
  },
  {
    front: 'Define Le Chatelier\'s Principle in Chemical Equilibrium.',
    back: 'If a chemical system at equilibrium experiences a change in concentration, temperature, or pressure, the equilibrium will shift in a direction that counteracts that change.'
  },
  {
    front: 'State Fermat\'s Little Theorem in Number Theory.',
    back: 'If p is a prime number and a is an integer not divisible by p, then a^(p-1) ≡ 1 (mod p).'
  },
  {
    front: 'What is the biological function of Mitochondria?',
    back: 'Mitochondria are double-membraned organelles that generate ATP (adenosine triphosphate) through oxidative phosphorylation during cellular respiration.'
  },
  {
    front: 'Explain the difference between Speed and Velocity in Kinematics.',
    back: 'Speed is a scalar quantity measuring the rate of distance covered, while Velocity is a vector quantity measuring rate of displacement with direction.'
  }
];
let activeFlashcardIndex = 0;

// ==========================================
// Utility Helpers
// ==========================================

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function showRetryDialog(message, onRetry) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast toast--error';
  toast.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:6px;">
      <span>${escapeHtml(message)}</span>
      <button class="btn btn--outline btn--sm btn-retry-action" style="align-self:flex-start; margin-top:4px;">
        🔄 Retry Now
      </button>
    </div>
  `;

  const btn = toast.querySelector('.btn-retry-action');
  btn.addEventListener('click', () => {
    toast.remove();
    if (typeof onRetry === 'function') onRetry();
  });

  container.appendChild(toast);
}

// ==========================================
// Chat Storage (LocalStorage Scoped by User ID)
// ==========================================

function getChatsStorageKey() {
  const user = getCurrentUser();
  return user && user.id ? `${STORAGE_KEYS.CHATS_PREFIX}${user.id}` : null;
}

function loadChatSessions() {
  const key = getChatsStorageKey();
  if (!key) return [];
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveChatSessions() {
  const key = getChatsStorageKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(chatSessions));
}

function getActiveChat() {
  return chatSessions.find((c) => c.id === currentChatId);
}

function createNewChat() {
  const newChat = {
    id: 'chat_' + Date.now(),
    title: 'New Session',
    createdAt: new Date().toISOString(),
    messages: []
  };

  chatSessions.unshift(newChat);
  saveChatSessions();
  switchToChat(newChat.id);
  renderHistoryList();
}

function switchToChat(chatId) {
  currentChatId = chatId;
  const chat = getActiveChat();
  if (!chat) return;

  document.getElementById('currentChatTitle').textContent = chat.title;
  renderMessages();
  renderHistoryList();
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
}

function deleteChat(chatId, e) {
  if (e) e.stopPropagation();
  chatSessions = chatSessions.filter((c) => c.id !== chatId);
  saveChatSessions();

  if (currentChatId === chatId) {
    if (chatSessions.length > 0) {
      switchToChat(chatSessions[0].id);
    } else {
      createNewChat();
    }
  } else {
    renderHistoryList();
  }
}

function renameChat(chatId, e) {
  if (e) e.stopPropagation();
  const chat = chatSessions.find((c) => c.id === chatId);
  if (!chat) return;

  const newTitle = prompt('Enter a new name for this session:', chat.title);
  if (newTitle && newTitle.trim()) {
    chat.title = newTitle.trim().slice(0, 50);
    saveChatSessions();
    if (currentChatId === chatId) {
      document.getElementById('currentChatTitle').textContent = chat.title;
    }
    renderHistoryList();
  }
}

function renderHistoryList(filterQuery = '') {
  const list = document.getElementById('chatHistoryList');
  const countBadge = document.getElementById('historyCountBadge');
  if (!list) return;

  const query = filterQuery.toLowerCase().trim();
  const filtered = chatSessions.filter((c) => c.title.toLowerCase().includes(query));

  if (countBadge) countBadge.textContent = chatSessions.length;

  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = `<li style="padding:10px; font-size:0.8rem; color:var(--text-subtle); text-align:center;">No sessions found</li>`;
    return;
  }

  filtered.forEach((chat) => {
    const li = document.createElement('li');
    li.className = `history-item ${chat.id === currentChatId ? 'history-item--active' : ''}`;
    li.innerHTML = `
      <span class="history-item__title">${escapeHtml(chat.title)}</span>
      <div class="history-item__actions">
        <button class="history-item__btn btn-rename" title="Rename Session">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="history-item__btn btn-delete" title="Delete Session">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    li.addEventListener('click', () => switchToChat(chat.id));
    li.querySelector('.btn-rename').addEventListener('click', (e) => renameChat(chat.id, e));
    li.querySelector('.btn-delete').addEventListener('click', (e) => deleteChat(chat.id, e));

    list.appendChild(li);
  });
}

// ==========================================
// Message Rendering & UI
// ==========================================

function renderMessages() {
  const container = document.getElementById('messagesContainer');
  const welcome = document.getElementById('welcomeScreen');
  if (!container) return;

  const chat = getActiveChat();
  if (!chat || chat.messages.length === 0) {
    container.innerHTML = '';
    if (welcome) {
      container.appendChild(welcome);
      welcome.style.display = 'flex';
    }
    return;
  }

  if (welcome) welcome.style.display = 'none';
  container.innerHTML = '';

  chat.messages.forEach((msg, idx) => {
    appendMessageBubble(msg, idx === chat.messages.length - 1);
  });

  scrollChatToBottom();
}

function appendMessageBubble(msg, isLast = false) {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  const isUser = msg.role === 'user';
  const row = document.createElement('div');
  row.className = `message-row ${isUser ? 'message-row--user' : 'message-row--ai'}`;

  const timeStr = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  let attachmentHtml = '';
  if (msg.attachment) {
    if (msg.attachment.type === 'image' && msg.attachment.data) {
      attachmentHtml = `<img src="${msg.attachment.data}" class="bubble-attachment-img" alt="Attached study diagram">`;
    } else if (msg.attachment.name) {
      attachmentHtml = `<div style="font-size:0.75rem; margin-bottom:6px; opacity:0.85;">📎 ${escapeHtml(msg.attachment.name)}</div>`;
    }
  }

  let formattedContent = '';
  if (isUser) {
    formattedContent = escapeHtml(msg.content).replace(/\n/g, '<br>');
  } else {
    // Markdown sanitized via marked.js and DOMPurify
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      formattedContent = DOMPurify.sanitize(marked.parse(msg.content || ''));
    } else {
      formattedContent = escapeHtml(msg.content || '').replace(/\n/g, '<br>');
    }
  }

  row.innerHTML = `
    <div class="message-avatar">${isUser ? 'You' : 'AI'}</div>
    <div class="message-body">
      <div class="message-meta">
        <span>${isUser ? 'You' : 'ExamAI Tutor'}</span>
        <span>•</span>
        <span>${timeStr}</span>
      </div>
      <div class="message-bubble">
        ${attachmentHtml}
        <div class="message-text">${formattedContent}</div>
      </div>
      ${
        !isUser
          ? `
        <div class="message-actions">
          <button class="btn-msg-action btn-copy-msg" title="Copy answer to clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>Copy</span>
          </button>
          ${
            isLast
              ? `
          <button class="btn-msg-action btn-regen-msg" title="Regenerate this response">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span>Regenerate</span>
          </button>
          `
              : ''
          }
        </div>
      `
          : ''
      }
    </div>
  `;

  // Attach button actions
  const copyBtn = row.querySelector('.btn-copy-msg');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(msg.content).then(() => showToast('Copied to clipboard!', 'success'));
    });
  }

  const regenBtn = row.querySelector('.btn-regen-msg');
  if (regenBtn) {
    regenBtn.addEventListener('click', () => regenerateLastResponse());
  }

  // Render Mathematical & Chemical Formulas via KaTeX
  const textContainer = row.querySelector('.message-text');
  if (textContainer && !isUser) {
    renderKaTeX(textContainer);
  }

  container.appendChild(row);
  return row;
}

function scrollChatToBottom() {
  const container = document.getElementById('messagesContainer');
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

// ==========================================
// Streaming Chat API Caller
// ==========================================

async function sendChatMessage(customPrompt = null) {
  if (isStreaming) return;

  const textarea = document.getElementById('chatTextarea');
  const text = (customPrompt || textarea.value).trim();

  if (!text && !attachedFile) {
    showToast('Please type a message or attach study material.', 'warning');
    return;
  }

  const chat = getActiveChat();
  if (!chat) return;

  // Prepare user message
  const userMsg = {
    role: 'user',
    content: text,
    timestamp: new Date().toISOString()
  };

  if (attachedFile) {
    userMsg.attachment = {
      type: attachedFile.type,
      name: attachedFile.name,
      mimeType: attachedFile.mimeType,
      data: attachedFile.data
    };
    // If it's a PDF or text file, prepend extracted text to the prompt content
    if (attachedFile.type === 'pdf' || attachedFile.type === 'txt') {
      userMsg.content = `[Attached Notes / Document: ${attachedFile.name}]\n\n${attachedFile.data}\n\n[Student Question]: ${text}`;
    }
  }

  // Clear input bar and preview chip
  if (!customPrompt && textarea) {
    textarea.value = '';
    textarea.style.height = 'auto';
  }
  clearAttachedFile();

  // Save and render user message
  chat.messages.push(userMsg);

  // Auto-set chat session title on first message
  if (chat.messages.length === 1 && text) {
    chat.title = text.slice(0, 36) + (text.length > 36 ? '...' : '');
    document.getElementById('currentChatTitle').textContent = chat.title;
  }

  saveChatSessions();
  renderHistoryList();
  renderMessages();

  // Create temporary AI bubble with typing indicator
  const container = document.getElementById('messagesContainer');
  const aiRow = document.createElement('div');
  aiRow.className = 'message-row message-row--ai';
  aiRow.innerHTML = `
    <div class="message-avatar">AI</div>
    <div class="message-body">
      <div class="message-meta">
        <span>ExamAI Tutor</span>
        <span>•</span>
        <span>Thinking...</span>
      </div>
      <div class="message-bubble">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
  container.appendChild(aiRow);
  scrollChatToBottom();

  const bubbleTextContainer = aiRow.querySelector('.message-bubble');

  try {
    isStreaming = true;

    // Send only the last 10 messages for context
    const recentMessages = chat.messages.slice(-10);

    const response = await authFetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: recentMessages,
        mode: 'chat',
        profile: getUserProfile()
      })
    });

    if (response.status === 401) {
      logout();
      return;
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (response.status === 429 || errData.isRateLimit) {
        aiRow.remove();
        showRetryDialog('Google Gemini rate limit reached. Please wait a moment and click retry.', () => sendChatMessage(text));
        return;
      }
      if (errData.isKeyMissing) {
        bubbleTextContainer.innerHTML = `<span style="color:var(--color-danger);">${escapeHtml(errData.error)}</span>`;
        return;
      }
      throw new Error(errData.error || 'Failed to generate response');
    }

    // Read the chunked response stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulatedText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulatedText += chunk;

      if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        bubbleTextContainer.innerHTML = DOMPurify.sanitize(marked.parse(accumulatedText));
      } else {
        bubbleTextContainer.textContent = accumulatedText;
      }

      scrollChatToBottom();
    }

    // Save AI reply to active chat
    const aiMsg = {
      role: 'model',
      content: accumulatedText,
      timestamp: new Date().toISOString()
    };
    chat.messages.push(aiMsg);
    saveChatSessions();

    // Re-render message row to bind copy and regenerate actions
    aiRow.remove();
    appendMessageBubble(aiMsg, true);

    // Optional Speech Read-Aloud
    if (isReadAloudEnabled && window.speechSynthesis) {
      speakAloud(accumulatedText);
    }
  } catch (err) {
    console.error('Chat error:', err);
    bubbleTextContainer.innerHTML = `<span style="color:var(--color-danger); font-size:0.85rem;">⚠️ ${escapeHtml(err.message || 'Error occurred.')}</span>`;
  } finally {
    isStreaming = false;
  }
}

function regenerateLastResponse() {
  const chat = getActiveChat();
  if (!chat || chat.messages.length === 0) return;

  // If the last message is from the model, remove it
  if (chat.messages[chat.messages.length - 1].role === 'model') {
    chat.messages.pop();
  }

  // Get the last user message text
  const lastUserMsg = chat.messages[chat.messages.length - 1];
  if (!lastUserMsg || lastUserMsg.role !== 'user') return;

  // Pop user message from state so sendChatMessage can re-push it
  chat.messages.pop();
  sendChatMessage(lastUserMsg.content);
}

// ==========================================
// Speech Synthesis (Read-Aloud)
// ==========================================

function speakAloud(markdownText) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // Stop any active speech

  // Strip Markdown tokens for natural speech
  const plainText = markdownText
    .replace(/[#*`_~>[\]]/g, '')
    .replace(/\(.*?\)/g, '')
    .slice(0, 1000); // Limit read aloud length

  const utterance = new SpeechSynthesisUtterance(plainText);
  const voiceLang = document.getElementById('voiceLangSelect')?.value || 'en-US';
  utterance.lang = voiceLang;
  utterance.rate = 1.0;

  window.speechSynthesis.speak(utterance);
}

function toggleReadAloud() {
  isReadAloudEnabled = !isReadAloudEnabled;
  const onIcon = document.querySelector('.icon--speaker-on');
  const offIcon = document.querySelector('.icon--speaker-off');

  if (isReadAloudEnabled) {
    if (onIcon) onIcon.style.display = 'block';
    if (offIcon) offIcon.style.display = 'none';
    showToast('AI Voice Read-Aloud enabled', 'info');
  } else {
    if (onIcon) onIcon.style.display = 'none';
    if (offIcon) offIcon.style.display = 'block';
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    showToast('AI Voice Read-Aloud muted', 'info');
  }
}

// ==========================================
// Voice Input (Web Speech API with Live Interim Stream)
// ==========================================

function initVoiceRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    return null;
  }

  const rec = new SpeechRec();
  rec.continuous = true;
  rec.interimResults = true;

  let baseText = '';

  rec.onstart = () => {
    isSpeechListening = true;
    const btn = document.getElementById('voiceMicBtn');
    if (btn) btn.classList.add('is-listening');
    const textarea = document.getElementById('chatTextarea');
    baseText = textarea ? textarea.value.trim() : '';
    showToast('🎤 Listening... Speak into your microphone (click mic again to stop).', 'info');
  };

  rec.onresult = (e) => {
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
      } else {
        interimTranscript += e.results[i][0].transcript;
      }
    }

    const textarea = document.getElementById('chatTextarea');
    if (textarea) {
      const speechText = (finalTranscript || interimTranscript).trim();
      textarea.value = baseText ? `${baseText} ${speechText}` : speechText;
      textarea.dispatchEvent(new Event('input'));
    }
  };

  rec.onerror = (e) => {
    console.warn('Speech recognition error:', e.error);
    isSpeechListening = false;
    const btn = document.getElementById('voiceMicBtn');
    if (btn) btn.classList.remove('is-listening');

    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      showToast('Microphone access blocked. Click the lock 🔒 icon in your browser address bar and allow Microphone.', 'error');
    } else if (e.error === 'network') {
      showToast('Speech service network error. Ensure your internet connection is active.', 'warning');
    } else if (e.error === 'no-speech') {
      // Quiet timeout
    } else if (e.error === 'audio-capture') {
      showToast('No microphone found on your laptop. Please check your mic connection.', 'error');
    }
  };

  rec.onend = () => {
    isSpeechListening = false;
    const btn = document.getElementById('voiceMicBtn');
    if (btn) btn.classList.remove('is-listening');
  };

  return rec;
}

async function toggleVoiceInput() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Voice input is not supported in this browser. Please use Google Chrome or Microsoft Edge.', 'warning');
    return;
  }

  // Pre-check / request browser mic permission if mediaDevices is available
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && !isSpeechListening) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (permErr) {
      console.warn('Mic permission check:', permErr);
      showToast('Microphone access is blocked. Click the 🔒 lock icon in the address bar and select "Allow".', 'error');
      return;
    }
  }

  if (!speechRecognition) {
    speechRecognition = initVoiceRecognition();
  }

  if (!speechRecognition) return;

  if (isSpeechListening) {
    try {
      speechRecognition.stop();
    } catch (e) {
      console.warn(e);
    }
    isSpeechListening = false;
    const btn = document.getElementById('voiceMicBtn');
    if (btn) btn.classList.remove('is-listening');
  } else {
    try {
      const langSelect = document.getElementById('voiceLangSelect');
      speechRecognition.lang = langSelect ? langSelect.value : 'en-IN';
      speechRecognition.start();
    } catch (err) {
      console.warn('Start voice error:', err);
      try {
        speechRecognition.stop();
      } catch (e) {}
      speechRecognition = initVoiceRecognition();
      try {
        speechRecognition.start();
      } catch (e) {
        showToast('Could not start microphone. Please refresh the page and try again.', 'error');
      }
    }
  }
}

// ==========================================
// File Attachment Ingestion (PDF, Images, TXT)
// ==========================================

async function handleFileUpload(file) {
  if (!file) return;

  // 5MB Limit Validation
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    showToast('File exceeds the 5 MB limit. Please upload a smaller file.', 'error');
    return;
  }

  const preview = document.getElementById('filePreviewContainer');
  const chipName = document.getElementById('fileChipName');
  const chipInfo = document.getElementById('fileChipInfo');

  const extension = file.name.split('.').pop().toLowerCase();

  // 1. PDF File: Extract text using pdf.js
  if (file.type === 'application/pdf' || extension === 'pdf') {
    try {
      showToast('Extracting text from PDF...', 'info');
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(' ');
        fullText += `[Page ${i}]\n${pageText}\n\n`;
      }

      attachedFile = {
        type: 'pdf',
        name: file.name,
        data: fullText
      };

      if (chipName) chipName.textContent = file.name;
      if (chipInfo) chipInfo.textContent = `PDF • ${pdf.numPages} Pages`;
      if (preview) preview.style.display = 'block';
      showToast('PDF notes extracted successfully!', 'success');
    } catch (err) {
      console.error('PDF extraction failed:', err);
      showToast('Could not extract text from this PDF file.', 'error');
    }
  }
  // 2. Image File: Convert to base64 Data URL for Gemini inlineData
  else if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      attachedFile = {
        type: 'image',
        name: file.name,
        mimeType: file.type,
        data: e.target.result
      };

      if (chipName) chipName.textContent = file.name;
      if (chipInfo) chipInfo.textContent = `Image • ${(file.size / 1024).toFixed(0)} KB`;
      if (preview) preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
  // 3. Plain Text File
  else if (file.type === 'text/plain' || extension === 'txt') {
    const reader = new FileReader();
    reader.onload = (e) => {
      attachedFile = {
        type: 'txt',
        name: file.name,
        data: e.target.result
      };

      if (chipName) chipName.textContent = file.name;
      if (chipInfo) chipInfo.textContent = `Text • ${(file.size / 1024).toFixed(0)} KB`;
      if (preview) preview.style.display = 'block';
    };
    reader.readAsText(file);
  } else {
    showToast('Unsupported file type. Please upload a PDF, image, or text file.', 'warning');
  }
}

function clearAttachedFile() {
  attachedFile = null;
  const preview = document.getElementById('filePreviewContainer');
  if (preview) preview.style.display = 'none';
  const fileInput = document.getElementById('fileAttachmentInput');
  if (fileInput) fileInput.value = '';
}

// ==========================================
// Exam Countdown Live Timer
// ==========================================

function updateExamCountdown() {
  const profile = getUserProfile();
  const examTitleElem = document.getElementById('countdownExamTitle');
  const daysElem = document.getElementById('countdownDays');
  const hoursElem = document.getElementById('countdownHours');
  const minsElem = document.getElementById('countdownMinutes');

  if (examTitleElem) {
    examTitleElem.textContent = profile.exam ? profile.exam : 'Target Exam';
  }

  if (!profile.examDate) {
    if (daysElem) daysElem.textContent = '--';
    if (hoursElem) hoursElem.textContent = '--';
    if (minsElem) minsElem.textContent = '--';
    return;
  }

  const target = new Date(profile.examDate).getTime();
  const now = new Date().getTime();
  const diff = target - now;

  if (diff <= 0) {
    if (daysElem) daysElem.textContent = '00';
    if (hoursElem) hoursElem.textContent = '00';
    if (minsElem) minsElem.textContent = '00';
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (daysElem) daysElem.textContent = String(days).padStart(2, '0');
  if (hoursElem) hoursElem.textContent = String(hours).padStart(2, '0');
  if (minsElem) minsElem.textContent = String(minutes).padStart(2, '0');
}

// ==========================================
// Personalization Profile Modal Handlers
// ==========================================

function openProfileModal() {
  const modal = document.getElementById('profileModal');
  const profile = getUserProfile();

  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('profileGrade').value = profile.grade || '';
  document.getElementById('profileExam').value = profile.exam || '';
  document.getElementById('profileExamDate').value = profile.examDate || '';
  document.getElementById('profileSubjects').value = profile.subjects || '';
  document.getElementById('profileWeakTopics').value = profile.weakTopics || '';
  document.getElementById('profileAnswerStyle').value =
    profile.answerStyle || 'Point-wise with marking rubrics';

  if (modal) modal.classList.add('is-open');
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) modal.classList.remove('is-open');
}

function handleProfileSubmit(e) {
  e.preventDefault();

  const profile = {
    name: document.getElementById('profileName').value.trim(),
    grade: document.getElementById('profileGrade').value.trim(),
    exam: document.getElementById('profileExam').value.trim(),
    examDate: document.getElementById('profileExamDate').value,
    subjects: document.getElementById('profileSubjects').value.trim(),
    weakTopics: document.getElementById('profileWeakTopics').value.trim(),
    answerStyle: document.getElementById('profileAnswerStyle').value
  };

  saveUserProfile(profile);
  closeProfileModal();
  updateProfileBadges();
  updateExamCountdown();
  showToast('Exam profile saved! Tutor personalized.', 'success');
}

function updateProfileBadges() {
  const profile = getUserProfile();
  const user = getCurrentUser();

  const nameElem = document.getElementById('userDisplayName');
  const examElem = document.getElementById('userDisplayExam');
  const avatarElem = document.getElementById('userAvatarText');

  const displayName = profile.name || (user ? user.name : 'Student');
  if (nameElem) nameElem.textContent = displayName;
  if (examElem) examElem.textContent = profile.exam ? `Exam: ${profile.exam}` : 'Exam: General';
  if (avatarElem) avatarElem.textContent = displayName.charAt(0).toUpperCase();
}

// ==========================================
// ==========================================
// KaTeX Math Rendering Helper
// ==========================================

function renderKaTeX(element) {
  if (typeof renderMathInElement === 'function' && element) {
    renderMathInElement(element, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }
}

// ==========================================
// Flashcards Tool (SuperMemo SM-2 Spaced Repetition)
// ==========================================

function getFlashcardsStorageKey() {
  const user = getCurrentUser();
  return user && user.id ? `examai_flashcards_${user.id}` : 'examai_flashcards_guest';
}

function loadFlashcardsDeck() {
  const key = getFlashcardsStorageKey();
  const raw = localStorage.getItem(key);
  if (!raw) {
    // Initialize default deck with SM-2 metadata
    const today = new Date().toISOString().split('T')[0];
    const initialDeck = sampleFlashcards.map((c, i) => ({
      id: 'fc_init_' + i,
      front: c.front,
      back: c.back,
      reps: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: today
    }));
    localStorage.setItem(key, JSON.stringify(initialDeck));
    return initialDeck;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveFlashcardsDeck(deck) {
  const key = getFlashcardsStorageKey();
  localStorage.setItem(key, JSON.stringify(deck));
}

let flashcardsDeck = [];

function updateFlashcardStats() {
  const totalElem = document.getElementById('srTotalCards');
  const dueElem = document.getElementById('srDueToday');
  const masteredElem = document.getElementById('srMastered');

  const today = new Date().toISOString().split('T')[0];
  const dueCount = flashcardsDeck.filter((c) => !c.dueDate || c.dueDate <= today).length;
  const masteredCount = flashcardsDeck.filter((c) => (c.easeFactor || 2.5) >= 2.5 && (c.reps || 0) >= 3).length;

  if (totalElem) totalElem.textContent = flashcardsDeck.length;
  if (dueElem) dueElem.textContent = dueCount;
  if (masteredElem) masteredElem.textContent = masteredCount;
}

function renderActiveFlashcard() {
  if (flashcardsDeck.length === 0) {
    flashcardsDeck = loadFlashcardsDeck();
  }

  const card = flashcardsDeck[activeFlashcardIndex];
  const cardElement = document.getElementById('activeFlashcard');
  const front = document.getElementById('flashcardFrontText');
  const back = document.getElementById('flashcardBackText');
  const counter = document.getElementById('flashcardCounter');

  if (cardElement) cardElement.classList.remove('is-flipped');

  if (!card) {
    if (front) front.textContent = 'No flashcards in deck. Type a topic above and click Generate!';
    if (back) back.textContent = 'Empty Deck';
    if (counter) counter.textContent = '0 / 0';
    return;
  }

  if (front) {
    front.textContent = card.front;
    renderKaTeX(front);
  }
  if (back) {
    back.textContent = card.back;
    renderKaTeX(back);
  }
  if (counter) {
    counter.textContent = `Card ${activeFlashcardIndex + 1} / ${flashcardsDeck.length}`;
  }

  updateFlashcardStats();
}

function rateFlashcardSM2(quality) {
  if (flashcardsDeck.length === 0) return;
  const card = flashcardsDeck[activeFlashcardIndex];
  if (!card) return;

  // Calculate SuperMemo SM-2 interval and ease factor
  let reps = card.reps || 0;
  let interval = card.interval || 0;
  let ef = card.easeFactor || 2.5;

  if (quality >= 3) {
    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = quality === 3 ? 2 : quality === 4 ? 4 : 7;
    } else {
      interval = Math.round(interval * ef);
    }
    reps += 1;
  } else {
    reps = 0;
    interval = 1;
  }

  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ef < 1.3) ef = 1.3;

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);

  card.reps = reps;
  card.interval = interval;
  card.easeFactor = Math.round(ef * 100) / 100;
  card.dueDate = nextDate.toISOString().split('T')[0];

  saveFlashcardsDeck(flashcardsDeck);

  const qualityNames = { 0: 'Again', 3: 'Hard', 4: 'Good', 5: 'Easy' };
  showToast(`Card rated: ${qualityNames[quality]} (Next review in ${interval} day${interval > 1 ? 's' : ''})`, 'info');

  // Advance to next card
  activeFlashcardIndex = (activeFlashcardIndex + 1) % flashcardsDeck.length;
  renderActiveFlashcard();
}

async function generateAIFlashcards() {
  const input = document.getElementById('flashcardTopicInput');
  const topic = input ? input.value.trim() : '';

  if (!topic) {
    showToast('Please enter an exam topic to generate flashcards.', 'warning');
    return;
  }

  const btn = document.getElementById('generateFlashcardsBtn');
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Generating...</span>';
    }

    const response = await authFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'flashcards',
        topic,
        count: 6,
        profile: getUserProfile()
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to generate flashcards');
    }

    if (Array.isArray(data.flashcards) && data.flashcards.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const newCards = data.flashcards.map((c) => ({
        id: 'fc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        front: c.front,
        back: c.back,
        reps: 0,
        interval: 0,
        easeFactor: 2.5,
        dueDate: today
      }));

      flashcardsDeck.unshift(...newCards);
      saveFlashcardsDeck(flashcardsDeck);
      activeFlashcardIndex = 0;
      renderActiveFlashcard();
      if (input) input.value = '';
      showToast(`Added ${newCards.length} AI flashcards to your deck!`, 'success');
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error generating cards.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
        <span>Generate Cards</span>
      `;
    }
  }
}

function openFlashcardsModal() {
  const modal = document.getElementById('flashcardsModal');
  flashcardsDeck = loadFlashcardsDeck();
  activeFlashcardIndex = 0;
  renderActiveFlashcard();
  if (modal) modal.classList.add('is-open');
}

function closeFlashcardsModal() {
  const modal = document.getElementById('flashcardsModal');
  if (modal) modal.classList.remove('is-open');
}

// ==========================================
// Export Chat Session to Markdown File
// ==========================================

function exportChatSession() {
  const chat = getActiveChat();
  if (!chat || !chat.messages || chat.messages.length === 0) {
    showToast('No messages in this session to export.', 'warning');
    return;
  }

  const profile = getUserProfile();
  let markdown = `# ${chat.title || 'ExamAI Study Notes'}\n\n`;
  markdown += `**Date:** ${new Date(chat.createdAt || Date.now()).toLocaleString()}\n`;
  markdown += `**Student:** ${profile.name || 'Student'}\n`;
  if (profile.exam) markdown += `**Target Exam:** ${profile.exam}\n`;
  markdown += `\n---\n\n`;

  chat.messages.forEach((msg) => {
    const isUser = msg.role === 'user';
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
    markdown += `### ${isUser ? '👤 You' : '🤖 ExamAI Tutor'} (${time})\n\n`;
    markdown += `${msg.content}\n\n---\n\n`;
  });

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(chat.title || 'examai-notes').toLowerCase().replace(/[^a-z0-9]/gi, '_')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Notes downloaded as Markdown file!', 'success');
}

// ==========================================
// Study Plan Generator
// ==========================================

function openStudyPlanModal() {
  const modal = document.getElementById('studyPlanModal');
  const profile = getUserProfile();

  if (profile.weakTopics) {
    document.getElementById('planTopics').value = profile.weakTopics;
  }
  if (modal) modal.classList.add('is-open');
}

function closeStudyPlanModal() {
  const modal = document.getElementById('studyPlanModal');
  if (modal) modal.classList.remove('is-open');
}

async function handleStudyPlanSubmit(e) {
  e.preventDefault();

  const daysLeft = document.getElementById('planDaysLeft').value;
  const hoursPerDay = document.getElementById('planHoursPerDay').value;
  const topics = document.getElementById('planTopics').value;
  const submitBtn = document.getElementById('generatePlanBtn');
  const resultDiv = document.getElementById('studyPlanResult');
  const markdownDiv = document.getElementById('studyPlanMarkdown');

  const prompt = `Generate a realistic, high-yield day-by-day Revision Study Timetable.
Days remaining until exam: ${daysLeft} days.
Daily study time available: ${hoursPerDay} hours per day.
Priority subjects and difficult topics: "${topics}".
Organize the timetable by Days/Weeks with Spaced Repetition, dedicated mock test days, and 5-minute active recall breaks.`;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Formulating Plan with AI...';
    }

    const response = await authFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        mode: 'chat',
        profile: getUserProfile()
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let planText = '';

    if (resultDiv) resultDiv.style.display = 'block';
    if (markdownDiv) markdownDiv.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      planText += decoder.decode(value, { stream: true });
      if (markdownDiv && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        markdownDiv.innerHTML = DOMPurify.sanitize(marked.parse(planText));
      }
    }
  } catch (err) {
    showToast(err.message || 'Error generating study schedule', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create AI Revision Schedule';
    }
  }
}

// ==========================================
// Progress Tracker & Plain Canvas Chart
// ==========================================

function openProgressModal() {
  const modal = document.getElementById('progressModal');
  if (modal) modal.classList.add('is-open');
  renderProgressUI();
}

function closeProgressModal() {
  const modal = document.getElementById('progressModal');
  if (modal) modal.classList.remove('is-open');
}

function renderProgressUI() {
  const progress = getStudentProgress();
  if (!progress) return;

  const totalTestsElem = document.getElementById('statTotalTests');
  const totalQuestionsElem = document.getElementById('statQuestionsPracticed');
  const avgAccuracyElem = document.getElementById('statAvgAccuracy');

  if (totalTestsElem) totalTestsElem.textContent = progress.totalTests;
  if (totalQuestionsElem) totalQuestionsElem.textContent = progress.totalQuestions;

  // Calculate percentages
  const mcqPct = progress.types.mcq.total > 0
    ? Math.round((progress.types.mcq.correct / progress.types.mcq.total) * 100)
    : 0;

  const oneMarkPct = progress.types.one_mark.total > 0
    ? Math.round((progress.types.one_mark.correct / progress.types.one_mark.total) * 100)
    : 0;

  const shortPct = progress.types.short.total > 0
    ? Math.round((progress.types.short.scored / progress.types.short.total) * 100)
    : 0;

  const longPct = progress.types.long.total > 0
    ? Math.round((progress.types.long.scored / progress.types.long.total) * 100)
    : 0;

  const validPcts = [mcqPct, oneMarkPct, shortPct, longPct].filter((p) => p > 0);
  const overallAvg = validPcts.length > 0
    ? Math.round(validPcts.reduce((a, b) => a + b, 0) / validPcts.length)
    : 0;

  if (avgAccuracyElem) avgAccuracyElem.textContent = `${overallAvg}%`;

  // Update progress bars
  const mcqBar = document.getElementById('progMcqBar');
  const oneMarkBar = document.getElementById('progOneMarkBar');
  const shortBar = document.getElementById('progShortBar');
  const longBar = document.getElementById('progLongBar');

  if (mcqBar) mcqBar.style.width = `${mcqPct}%`;
  if (oneMarkBar) oneMarkBar.style.width = `${oneMarkPct}%`;
  if (shortBar) shortBar.style.width = `${shortPct}%`;
  if (longBar) longBar.style.width = `${longPct}%`;

  document.getElementById('progMcqPct').textContent = `${mcqPct}%`;
  document.getElementById('progOneMarkPct').textContent = `${oneMarkPct}%`;
  document.getElementById('progShortPct').textContent = `${shortPct}%`;
  document.getElementById('progLongPct').textContent = `${longPct}%`;

  // Draw chart on plain Canvas
  drawCanvasChart({
    MCQ: mcqPct,
    '1-Mark': oneMarkPct,
    Short: shortPct,
    Long: longPct
  });
}

function drawCanvasChart(data) {
  const canvas = document.getElementById('progressCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  const categories = Object.keys(data);
  const paddingLeft = 50;
  const paddingBottom = 40;
  const chartWidth = width - paddingLeft - 20;
  const chartHeight = height - paddingBottom - 30;

  // Draw background horizontal grid lines (0%, 25%, 50%, 75%, 100%)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillStyle = '#9ca3af';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';

  for (let i = 0; i <= 4; i++) {
    const yVal = 25 * i;
    const yPos = height - paddingBottom - (chartHeight * (yVal / 100));

    ctx.beginPath();
    ctx.moveTo(paddingLeft, yPos);
    ctx.lineTo(width - 20, yPos);
    ctx.stroke();

    ctx.fillText(`${yVal}%`, paddingLeft - 8, yPos + 4);
  }

  // Draw Bars
  const barWidth = 44;
  const barGap = (chartWidth - categories.length * barWidth) / (categories.length + 1);

  categories.forEach((cat, idx) => {
    const val = data[cat] || 0;
    const barHeight = chartHeight * (val / 100);
    const x = paddingLeft + barGap + idx * (barWidth + barGap);
    const y = height - paddingBottom - barHeight;

    // Gradient Fill for Bar
    const grad = ctx.createLinearGradient(0, y, 0, height - paddingBottom);
    grad.addColorStop(0, '#6366f1');
    grad.addColorStop(1, '#06b6d4');

    ctx.fillStyle = grad;
    ctx.beginPath();
    // Rounded top bar
    ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
    ctx.fill();

    // Percentage text above bar
    ctx.fillStyle = '#f3f4f6';
    ctx.textAlign = 'center';
    ctx.fillText(`${val}%`, x + barWidth / 2, y - 6);

    // Category label beneath bar
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(cat, x + barWidth / 2, height - paddingBottom + 20);
  });
}

// ==========================================
// Sidebar Handlers (Responsive Toggle & Close)
// ==========================================

function toggleSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;

  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.remove('sidebar--collapsed');
    const willOpen = !sidebar.classList.contains('is-open');
    if (willOpen) {
      sidebar.classList.add('is-open');
      if (overlay) overlay.classList.add('is-active');
    } else {
      sidebar.classList.remove('is-open');
      if (overlay) overlay.classList.remove('is-active');
    }
  } else {
    sidebar.classList.remove('is-open');
    if (overlay) overlay.classList.remove('is-active');
    sidebar.classList.toggle('sidebar--collapsed');
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;

  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.remove('sidebar--collapsed');
    sidebar.classList.remove('is-open');
    if (overlay) overlay.classList.remove('is-active');
  } else {
    sidebar.classList.remove('is-open');
    if (overlay) overlay.classList.remove('is-active');
    sidebar.classList.add('sidebar--collapsed');
  }
}

function openSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;

  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.remove('sidebar--collapsed');
    sidebar.classList.add('is-open');
    if (overlay) overlay.classList.add('is-active');
  } else {
    sidebar.classList.remove('is-open');
    if (overlay) overlay.classList.remove('is-active');
    sidebar.classList.remove('sidebar--collapsed');
  }
}

// Backward compatibility alias
function openMobileSidebar() { openSidebar(); }
function closeMobileSidebar() { closeSidebar(); }

// ==========================================
// Main Application DOM Initialization
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Session verification & Profile loading
  const token = getAuthToken();
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  updateProfileBadges();
  updateExamCountdown();
  setInterval(updateExamCountdown, 60000); // refresh timer every minute

  // Auto-open personalization modal on first login if no profile exists
  const existingProfile = getUserProfile();
  if (!existingProfile.exam && !existingProfile.name) {
    openProfileModal();
  }

  // 2. Chat Sessions Setup
  chatSessions = loadChatSessions();
  if (chatSessions.length === 0) {
    createNewChat();
  } else {
    switchToChat(chatSessions[0].id);
  }

  // 3. Auto-Growing Textarea & Keyboard Listeners
  const textarea = document.getElementById('chatTextarea');
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // 4. Send Message Button
  const sendBtn = document.getElementById('sendMessageBtn');
  if (sendBtn) sendBtn.addEventListener('click', () => sendChatMessage());

  // 5. Suggestion Chips Actions
  const chips = document.querySelectorAll('.chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      const action = chip.getAttribute('data-action');

      if (action === 'open-quiz') {
        const panel = document.getElementById('quizSelectorPanel');
        if (panel) panel.classList.remove('quiz-selector-panel--collapsed');
      } else if (action === 'open-study-plan') {
        openStudyPlanModal();
      } else if (prompt) {
        sendChatMessage(prompt);
      }
    });
  });

  // 6. Question Type Segmented Controls
  let activeQuestionType = 'mcq';
  const segmentedBtns = document.querySelectorAll('#questionTypeSegmented .segmented-control__btn');
  segmentedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      segmentedBtns.forEach((b) => b.classList.remove('segmented-control__btn--active'));
      btn.classList.add('segmented-control__btn--active');
      activeQuestionType = btn.getAttribute('data-val');
    });
  });

  // Toggle Question Paper Drawer
  const toggleQuizBtn = document.getElementById('toggleQuizPanelBtn');
  const quizPanel = document.getElementById('quizSelectorPanel');
  if (toggleQuizBtn && quizPanel) {
    toggleQuizBtn.addEventListener('click', () => {
      quizPanel.classList.toggle('quiz-selector-panel--collapsed');
    });
  }

  // Generate Paper Button inside Selector Drawer
  const genPaperBtn = document.getElementById('generatePaperBtn');
  if (genPaperBtn) {
    genPaperBtn.addEventListener('click', () => {
      const count = document.getElementById('quizCountSelect')?.value || 5;
      const difficulty = document.getElementById('quizDifficultySelect')?.value || 'Medium';
      const includeExplanations = document.getElementById('quizExplanationsToggle')?.checked !== false;

      // Check if textarea has a specific topic entered
      const topicInput = document.getElementById('chatTextarea')?.value.trim();
      const topic = topicInput || getUserProfile().weakTopics || 'General Examination Syllabus';

      generateQuiz({
        type: activeQuestionType,
        count: parseInt(count, 10),
        difficulty,
        includeExplanations,
        topic
      });
    });
  }

  // 7. File Attachment & Drag/Drop
  const attachBtn = document.getElementById('attachFileBtn');
  const fileInput = document.getElementById('fileAttachmentInput');
  const removeFileBtn = document.getElementById('removeFileBtn');

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFileUpload(file);
    });
  }
  if (removeFileBtn) removeFileBtn.addEventListener('click', clearAttachedFile);

  // 8. Voice Input & Read-Aloud Toggles
  const voiceMicBtn = document.getElementById('voiceMicBtn');
  if (voiceMicBtn) voiceMicBtn.addEventListener('click', toggleVoiceInput);

  const readAloudBtn = document.getElementById('readAloudToggleBtn');
  if (readAloudBtn) readAloudBtn.addEventListener('click', toggleReadAloud);

  // 9. Floating Scroll-to-Bottom
  const scrollBtn = document.getElementById('scrollToBottomBtn');
  const messagesBox = document.getElementById('messagesContainer');
  if (messagesBox && scrollBtn) {
    messagesBox.addEventListener('scroll', () => {
      const isScrolledUp = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight > 200;
      scrollBtn.style.display = isScrolledUp ? 'flex' : 'none';
    });
    scrollBtn.addEventListener('click', scrollChatToBottom);
  }

  // Export Chat Notes Button
  document.getElementById('exportChatBtn')?.addEventListener('click', exportChatSession);

  // 10. Clear Chat Button
  const clearChatBtn = document.getElementById('clearChatBtn');
  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', () => {
      const chat = getActiveChat();
      if (!chat) return;
      if (confirm('Are you sure you want to clear all messages in this session?')) {
        chat.messages = [];
        saveChatSessions();
        renderMessages();
      }
    });
  }

  // 11. Sidebar Controls & Search
  const newChatBtn = document.getElementById('newChatBtn');
  if (newChatBtn) newChatBtn.addEventListener('click', createNewChat);

  const searchInput = document.getElementById('chatSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderHistoryList(e.target.value));
  }

  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  // 12. Modal Buttons
  document.getElementById('profileSettingsBtn')?.addEventListener('click', openProfileModal);
  document.getElementById('closeProfileModalBtn')?.addEventListener('click', closeProfileModal);
  document.getElementById('cancelProfileBtn')?.addEventListener('click', closeProfileModal);
  document.getElementById('profileForm')?.addEventListener('submit', handleProfileSubmit);

  // Flashcards Modal
  document.getElementById('openFlashcardsBtn')?.addEventListener('click', openFlashcardsModal);
  document.getElementById('closeFlashcardsBtn')?.addEventListener('click', closeFlashcardsModal);
  document.getElementById('generateFlashcardsBtn')?.addEventListener('click', generateAIFlashcards);

  document.getElementById('activeFlashcard')?.addEventListener('click', function () {
    this.classList.toggle('is-flipped');
  });

  // SM-2 Spaced Repetition Buttons
  const sm2Buttons = document.querySelectorAll('.btn-sm2');
  sm2Buttons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const quality = parseInt(btn.getAttribute('data-quality'), 10);
      rateFlashcardSM2(quality);
    });
  });

  document.getElementById('nextFlashcardBtn')?.addEventListener('click', () => {
    if (flashcardsDeck.length === 0) return;
    activeFlashcardIndex = (activeFlashcardIndex + 1) % flashcardsDeck.length;
    renderActiveFlashcard();
  });
  document.getElementById('prevFlashcardBtn')?.addEventListener('click', () => {
    if (flashcardsDeck.length === 0) return;
    activeFlashcardIndex = (activeFlashcardIndex - 1 + flashcardsDeck.length) % flashcardsDeck.length;
    renderActiveFlashcard();
  });

  // Study Plan Modal
  document.getElementById('openStudyPlanBtn')?.addEventListener('click', openStudyPlanModal);
  document.getElementById('closeStudyPlanBtn')?.addEventListener('click', closeStudyPlanModal);
  document.getElementById('studyPlanForm')?.addEventListener('submit', handleStudyPlanSubmit);

  // Progress Modal
  document.getElementById('openProgressBtn')?.addEventListener('click', openProgressModal);
  document.getElementById('closeProgressBtn')?.addEventListener('click', closeProgressModal);

  // Backdrop click-to-close for all modal dialogs
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('is-open');
      }
    });
  });

  // Global Escape key handler to close open modals & mobile drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.is-open').forEach((m) => m.classList.remove('is-open'));
      closeSidebar();
    }
  });

  // Logout Button
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to log out of ExamAI?')) {
      logout();
    }
  });
});
