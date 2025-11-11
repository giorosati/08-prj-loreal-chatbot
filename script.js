/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

// Debug startup: make it easy to see if the script loaded and elements exist
console.log('[chat] script loaded');
if (!chatForm) console.error('[chat] chatForm element not found (id=chatForm)');
if (!userInput) console.error('[chat] userInput element not found (id=userInput)');
if (!chatWindow) console.error('[chat] chatWindow element not found (id=chatWindow)');

// Set initial message
chatWindow.textContent = "Hello! How can I help you today?";

// Cloudflare Worker url
const workerUrl = 'https://loreal-app-worker.giovanni-rosati.workers.dev/';

// L'Oreal-specific guardrail so every reply stays on brand
const systemPrompt = "You are the L'Oreal Smart Product Advisor. Only answer questions about L'Oreal products, skincare routines, ingredients, or recommendations. Politely decline anything else.";


/**
 * Append a message to the chat window.
 * sender: 'user' | 'bot'
 */
function appendMessage(text, sender = 'bot') {
  // Remove the initial welcome text when the first message is added
  if (chatWindow.textContent === "Hello! How can I help you today?") {
    chatWindow.textContent = '';
  }

  const message = document.createElement('div');
  message.className = `message ${sender}`;
  message.textContent = text;
  chatWindow.appendChild(message);
  // keep viewport scrolled to the bottom
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

  // Append user message to the chat window
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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]
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
      if (contentType.includes('application/json')) {
        const data = await res.json();
        botResponse = data.choices?.[0]?.message?.content ?? data.result ?? JSON.stringify(data);
      } else {
        botResponse = await res.text();
      }

      thinking.remove();
      appendMessage(botResponse, 'bot');
    } catch (err) {
      console.error('Worker request failed', err);
      thinking.remove();
      appendMessage('Error contacting worker: ' + err.message, 'bot');
    }
  })();
});
