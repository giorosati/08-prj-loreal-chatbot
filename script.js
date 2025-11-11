/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const clearBtn = document.getElementById("clearBtn");

// Debug startup: make it easy to see if the script loaded and elements exist
console.log('[chat] script loaded');
if (!chatForm) console.error('[chat] chatForm element not found (id=chatForm)');
if (!userInput) console.error('[chat] userInput element not found (id=userInput)');
if (!chatWindow) console.error('[chat] chatWindow element not found (id=chatWindow)');

const INITIAL_GREETING = "Hello! How can I help you today?";
const STORAGE_KEY = "loreal-chat-history";

// Set initial message
chatWindow.textContent = INITIAL_GREETING;

// Cloudflare Worker url
const workerUrl = 'https://loreal-app-worker.giovanni-rosati.workers.dev/';

// L'Oreal-specific guardrail so every reply stays on brand
const systemPrompt = "You are the L'Oreal Smart Product Advisor. Only answer questions about L'Oreal products, skincare routines, ingredients, or recommendations. Politely decline anything else.";

let chatHistory = [];

function getSystemMessage() {
  return { role: 'system', content: systemPrompt };
}

function loadChatHistory() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [getSystemMessage()];
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [getSystemMessage()];
    }
    const filtered = parsed.filter((msg) => msg && typeof msg.role === 'string' && typeof msg.content === 'string');
    if (filtered.length === 0 || filtered[0].role !== 'system') {
      filtered.unshift(getSystemMessage());
    } else {
      filtered[0].content = systemPrompt;
    }
    return filtered;
  } catch (err) {
    console.warn('[chat] failed to load history from storage', err);
    return [getSystemMessage()];
  }
}

function saveChatHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory));
  } catch (err) {
    console.warn('[chat] failed to save history to storage', err);
  }
}

function createMessageElement(text, sender = 'bot') {
  const message = document.createElement('div');
  message.className = `message ${sender}`;
  message.textContent = text;
  return message;
}

function renderConversation() {
  chatWindow.innerHTML = '';
  const visibleMessages = chatHistory.filter((msg) => msg.role !== 'system');

  if (visibleMessages.length === 0) {
    chatWindow.textContent = INITIAL_GREETING;
    return;
  }

  visibleMessages.forEach((msg) => {
    const sender = msg.role === 'user' ? 'user' : 'bot';
    chatWindow.appendChild(createMessageElement(msg.content, sender));
  });
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function extractText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  return String(content ?? '');
}

function resetConversation() {
  chatHistory = [getSystemMessage()];
  saveChatHistory();
  renderConversation();
  userInput.value = '';
  userInput.focus();
}

chatHistory = loadChatHistory();
renderConversation();


/**
 * Append a message to the chat window.
 * sender: 'user' | 'bot'
 */
function appendMessage(text, sender = 'bot') {
  if (chatWindow.textContent === INITIAL_GREETING) {
    chatWindow.textContent = '';
  }

  chatWindow.appendChild(createMessageElement(text, sender));
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Handle form submit: capture input and display it */
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();

  console.log('[chat] submit handler invoked');

  // Get the trimmed text from the input
  const text = userInput.value.trim();
  console.log('[chat] user input:', text);
  if (!text) return; // ignore empty submits

  // Append user message to history and UI
  chatHistory.push({ role: 'user', content: text });
  saveChatHistory();
  appendMessage(text, 'user');

  // Clear the input for the next message
  userInput.value = '';
  userInput.focus();

  // Show a temporary bot 'thinking' message (we'll replace this when we have a real response)
  const thinking = document.createElement('div');
  thinking.className = 'message bot thinking';
  thinking.textContent = '…';
  chatWindow.appendChild(thinking);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // POST to the Cloudflare Worker. The worker should forward to OpenAI and return
  // a JSON response similar to OpenAI's chat completion object (choices[0].message.content).
  (async () => {
    try {
      console.log('[chat] sending fetch to worker:', workerUrl);

      const payload = {
        model: 'gpt-4o',
        messages: chatHistory
      };

      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Worker responded ${res.status}: ${errText}`);
      }

      // Attempt to parse JSON; fall back to text if not JSON
      const contentType = res.headers.get('content-type') || '';
      let botResponse;
      let assistantMessage;
      if (contentType.includes('application/json')) {
        const data = await res.json();
        assistantMessage = data.choices?.[0]?.message;
        botResponse = extractText(assistantMessage?.content ?? data.result ?? '');
        if (!botResponse) {
          botResponse = JSON.stringify(data);
        }
      } else {
        botResponse = await res.text();
      }

      thinking.remove();
      appendMessage(botResponse, 'bot');

      if (assistantMessage) {
        const content = extractText(assistantMessage.content);
        chatHistory.push({ role: assistantMessage.role || 'assistant', content });
        saveChatHistory();
      } else if (botResponse) {
        chatHistory.push({ role: 'assistant', content: botResponse });
        saveChatHistory();
      }
    } catch (err) {
      console.error('Worker request failed', err);
      thinking.remove();
      appendMessage('Error contacting worker: ' + err.message, 'bot');
    }
  })();
});

if (clearBtn) {
  clearBtn.addEventListener('click', resetConversation);
}
