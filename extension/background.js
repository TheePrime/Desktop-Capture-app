const BACKEND = 'http://127.0.0.1:8000';
const HOST_NAME = 'com.capture.helper';

let nativePort = null;
let reconnecting = false


function connectNativeHost() {
  if (reconnecting) return;
  reconnecting = true;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    console.log('[NativeHost] Connected to native host');
    nativePort.onMessage.addListener((msg) => {
      console.log('[NativeHost] Received from Python:', msg);
    });
    nativePort.onDisconnect.addListener(() => {
      console.log('[NativeHost] Disconnected from native host');
      nativePort = null;
      setTimeout(
        connectNativeHost,2000); // auto-retry
    });
  } catch (err) {
    console.error('[NativeHost] Connection error:', err);
    nativePort = null;
    setTimeout(connectNativeHost, 3000);
  }
}


// Always reconnect when the service worker wakes up
chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.runtime.onSuspendCanceled.addListener(connectNativeHost);

// Try to connect immediately
connectNativeHost();

async function sendToBackend(payload) {
  try {
    // First check if Electron app is active
    const statusRes = await fetch(`${BACKEND}/status`);
    let electronActive = false;
    if (statusRes.ok) {
      const status = await statusRes.json();
      electronActive = status.electron_active;
    }

    // Only check for screenshots if Electron is active
    if (electronActive) {
      console.log('[Capture] Checking for recent screenshots...');
      const screenshotRes = await fetch(`${BACKEND}/recent_screenshots?seconds=0.5`);
      if (screenshotRes.ok) {
        const { screenshots = [] } = await screenshotRes.json();
        if (screenshots.length > 0) {
          payload.screenshot_path = screenshots[screenshots.length - 1];
          console.log('[Capture] Found recent screenshot:', payload.screenshot_path);
        }
      }
    } else {
      console.log('[Capture] Skipping screenshots - Electron app not active');
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
        console.warn('[Capture] No native port, reconnecting...');
        connectNativeHost();
      }
      if (!nativePort) {
        resolve({ ok: false, error: 'no native port' });
        return;
      }
      console.log('[Capture] Payload before native send:', payload);
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


