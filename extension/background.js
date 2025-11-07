const BACKEND = 'http://127.0.0.1:8000';
const HOST_NAME = 'com.capture.helper';

async function sendToBackend(payload) {
  try {
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
      chrome.runtime.sendNativeMessage(HOST_NAME, payload, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Capture] Native messaging error:', chrome.runtime.lastError.message);
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        console.log('[Capture] Native messaging response:', response);
        resolve({ ok: true, response });
      });
    } catch (err) {
      console.warn('[Capture] Failed to send native message:', err);
      resolve({ ok: false, error: String(err) });
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'POST_CONTENT') {
    console.log('[Capture] Received POST_CONTENT message:', message);
    const payload = {
      text: message.text,
      url: message.url,
      title: message.title,
      x: message.x,
      y: message.y,
      tabId: sender?.tab?.id,
    };
    
    // Send response immediately to keep port open, then send data asynchronously
    sendResponse({ ok: true, status: 'processing' });
    
    const nativePayload = {
      text: payload.text,
      browser_url: payload.url,
      title: payload.title,
      x: payload.x,
      y: payload.y,
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


