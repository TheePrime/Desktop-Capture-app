const BACKEND = 'http://127.0.0.1:8000';
const HOST_NAME = 'com.capture.helper';

let nativePort = null;
let reconnecting = false


let connectionAttempts = 0;
const MAX_RETRIES = 5;
const RETRY_DELAYS = [2000, 4000, 8000, 16000, 32000]; // Exponential backoff

function getRetryDelay() {
  const index = Math.min(connectionAttempts, RETRY_DELAYS.length - 1);
  return RETRY_DELAYS[index];
}

function connectNativeHost() {
  if (reconnecting) return;
  
  // Check if we've hit the retry limit
  if (connectionAttempts >= MAX_RETRIES) {
    console.error('[NativeHost] Maximum connection attempts reached. Please check if native_host.py is running.');
    return;
  }
  
  reconnecting = true;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    console.log('[NativeHost] Connected to native host');
    
    // Reset connection attempts on successful connection
    connectionAttempts = 0;
    
    nativePort.onMessage.addListener((msg) => {
      console.log('[NativeHost] Received from Python:', msg);
      // Check for error status
      if (msg.status === 'error') {
        console.error('[NativeHost] Error from native host:', msg.error);
      }
    });
    
    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('[NativeHost] Disconnected from native host:', error?.message);
      nativePort = null;
      reconnecting = false;
      
      // Increment attempts and schedule retry
      connectionAttempts++;
      if (connectionAttempts < MAX_RETRIES) {
        const delay = getRetryDelay();
        console.log(`[NativeHost] Retrying connection in ${delay}ms (attempt ${connectionAttempts} of ${MAX_RETRIES})`);
        setTimeout(connectNativeHost, delay);
      } else {
        console.error('[NativeHost] Maximum retries reached. Please restart the native host.');
      }
    });
  } catch (err) {
    console.error('[NativeHost] Connection error:', err);
    nativePort = null;
    reconnecting = false;
    
    // Schedule retry with backoff
    connectionAttempts++;
    if (connectionAttempts < MAX_RETRIES) {
      const delay = getRetryDelay();
      console.log(`[NativeHost] Retrying connection in ${delay}ms (attempt ${connectionAttempts} of ${MAX_RETRIES})`);
      setTimeout(connectNativeHost, delay);
    }
  }
}


// Handle PDF document loading
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.url.toLowerCase().endsWith('.pdf')) {
    console.log('[Capture] PDF navigation completed:', details.url);
    // Inject content script into PDF viewer
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['content.js']
    }).catch(err => console.error('[Capture] PDF script injection failed:', err));
  }
}, {
  url: [{ pathSuffix: '.pdf' }, { urlContains: '.pdf' }]
});

// Always reconnect when the service worker wakes up
chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.runtime.onSuspendCanceled.addListener(connectNativeHost);

// Try to connect immediately
connectNativeHost();

async function sendToBackend(payload) {
  try {
    console.log('[Capture] Sending to Electron app...');
    const electronData = {
      ...payload,
      timestamp: new Date().toISOString(),
      app_name: 'chrome',
    };

    // Try WebSocket first
    try {
      const ws = new WebSocket('ws://localhost:8000/ws');
      await new Promise((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify(electronData));
          ws.close();
          resolve();
        };
        ws.onerror = reject;
        setTimeout(reject, 1000); // 1s timeout
      });
      return { ok: true };
    } catch (e) {
      console.warn('[Capture] WebSocket failed, trying HTTP...');
    }

    console.log('[Capture] Sending to backend:', payload);
    const res = await fetch(`${BACKEND}/ext_event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[Capture] Backend error:', res.status, text);
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const result = await res.json();
    console.log('[Capture] Backend response:', result);
    return result;
  } catch (e) {
    console.error('[Capture] Failed to send to backend:', e);
    return { error: String(e) };
  }
}

function sendToNativeHost(payload) {
  return new Promise((resolve) => {
    try {
      if (!nativePort) {
        console.warn('[Capture] No native port available');
        // Only try to reconnect if we haven't hit the retry limit
        if (connectionAttempts < MAX_RETRIES) {
          console.log('[Capture] Attempting to reconnect...');
          connectNativeHost();
        }
        // Fall back to HTTP immediately rather than waiting
        resolve({ ok: false, error: 'no native port' });
        return;
      }
      
      console.log('[Capture] Payload before native send:', payload);
      
      // Add timeout for native messaging
      const timeoutId = setTimeout(() => {
        console.warn('[Capture] Native messaging timeout');
        cleanup();
        resolve({ ok: false, error: 'timeout' });
      }, 5000); // 5 second timeout
      const onMessage = (msg) => {
        console.log('[Capture] Native response:', msg);
        cleanup();
        resolve({ ok: true, response: msg });
      };
      const onDisconnect = () => {
        console.warn('[Capture] Native port disconnected during send');
        cleanup();
        resolve({ ok: false, error: 'native disconnect' });
      };
      function cleanup() {
        try { nativePort.onMessage.removeListener(onMessage); } catch {}
        try { nativePort.onDisconnect.removeListener(onDisconnect); } catch {}
      }
      nativePort.onMessage.addListener(onMessage);
      nativePort.onDisconnect.addListener(onDisconnect);
      nativePort.postMessage(payload);
    } catch (err) {
      console.warn('[Capture] Failed to post to native port:', err);
      resolve({ ok: false, error: String(err) });
    }
  });
}

// Debounce for duplicate messages
const messageDebounce = new Map(); // tabId -> { payload, timestamp }
const DEBOUNCE_MS = 200;

// Receive one-off messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'POST_CONTENT') {
    const tabId = sender?.tab?.id;
    const now = Date.now();
    
    // Check for duplicate message from this tab
    if (tabId) {
      const lastMsg = messageDebounce.get(tabId);
      if (lastMsg && now - lastMsg.timestamp < DEBOUNCE_MS) {
        console.log('[Capture] Debounced duplicate message from tab', tabId);
        sendResponse({ ok: true, status: 'debounced' });
        return false;
      }
    }
    
    console.log('[Capture] Received POST_CONTENT message:', message);
    const payload = {
      text: message.text,
      url: message.url,
      title: message.title,
      x: message.x,
      y: message.y,
      global_x: message.global_x,
      global_y: message.global_y,
      devicePixelRatio: message.devicePixelRatio,
      tabId: tabId,
    };
    
    // Send response immediately to keep port open, then send data asynchronously
    sendResponse({ ok: true, status: 'processing' });
    
    const nativePayload = {
      text: payload.text,
      browser_url: payload.url,
      title: payload.title,
      x: payload.x,
      y: payload.y,
      global_x: payload.global_x,
      global_y: payload.global_y,
      devicePixelRatio: payload.devicePixelRatio,
      tabId: payload.tabId,
    };

    sendToNativeHost(nativePayload)
      .then((nativeResult) => {
        if (!nativeResult.ok) {
          console.log('[Capture] Falling back to HTTP:', nativeResult.error);
          return sendToBackend(payload);
        }
        return nativeResult;
      })
      .then((result) => {
        if (!result) {
          return;
        }
        if (result.error) {
          console.error('[Capture] Backend returned error:', result.error);
        } else {
          console.log('[Capture] Successfully processed payload');
        }
      })
      .catch((e) => {
        console.error('[Capture] Processing payload failed:', e);
      });
    
    // Return false since we already sent the response
    return false;
  }
});

// Receive messages from persistent content ports
chrome.runtime.onConnect.addListener((port) => {
  console.log('[NativeHost] Chrome Port connected:', port.name);
  if (port.name !== 'capture') {
    return;
  }
  port.onMessage.addListener((message) => {
    if (!message || message.type !== 'POST_CONTENT') return;
    const payload = {
      text: message.text,
      url: message.url,
      title: message.title,
      x: message.x,
      y: message.y,
      global_x: message.global_x,
      global_y: message.global_y,
      devicePixelRatio: message.devicePixelRatio,
      tabId: message.tabId,
    };
    const nativePayload = {
      text: payload.text,
      browser_url: payload.url,
      title: payload.title,
      x: payload.x,
      y: payload.y,
      global_x: payload.global_x,
      global_y: payload.global_y,
      devicePixelRatio: payload.devicePixelRatio,
      tabId: payload.tabId,
    };
    sendToNativeHost(nativePayload)
      .then((nativeResult) => {
        if (!nativeResult.ok) {
          console.log('[Capture] Falling back to HTTP (port):', nativeResult.error);
          return sendToBackend(payload);
        }
        return nativeResult;
      })
      .then((result) => {
        if (!result) return;
        if (result.error) {
          console.error('[Capture] Backend returned error (port):', result.error);
        } else {
          console.log('[Capture] Successfully processed payload (port)');
        }
      })
      .catch((e) => {
        console.error('[Capture] Processing payload via port failed:', e);
      });
  });
});


