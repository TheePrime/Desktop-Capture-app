const BACKEND = 'http://127.0.0.1:8000';

console.log('[Background] Service worker initialized');

// Handle PDF document loading - inject content script
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.url.toLowerCase().endsWith('.pdf') || details.url.includes('.pdf')) {
    console.log('[Background] PDF navigation completed:', details.url);
    // Inject content script into PDF viewer
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['content.js']
    }).catch(err => console.error('[Background] PDF script injection failed:', err));
  }
}, {
  url: [{ pathSuffix: '.pdf' }, { urlContains: '.pdf' }]
});

// Handle messages from content scripts and forward to backend
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);
  
  if (message && message.type === 'POST_CONTENT') {
    console.log('[Background] Forwarding click data to backend');
    
    // Forward to backend via fetch (background scripts can access localhost)
    fetch(`${BACKEND}/ext_event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    })
    .then(response => {
      if (response.ok) {
        console.log('[Background] Successfully sent to backend');
        sendResponse({ success: true, message: 'Sent to backend' });
      } else {
        console.error('[Background] Backend returned error:', response.status);
        sendResponse({ success: false, error: `Backend error: ${response.status}` });
      }
    })
    .catch(error => {
      console.error('[Background] Failed to reach backend:', error);
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Acknowledge other message types
  sendResponse({ received: true });
  return true;
});

// Handle persistent port connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Background] Port connected:', port.name);
  
  port.onMessage.addListener((msg) => {
    console.log('[Background] Message from port:', msg);
    
    if (msg && msg.type === 'POST_CONTENT') {
      // Forward to backend
      fetch(`${BACKEND}/ext_event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      })
      .then(response => {
        if (response.ok) {
          console.log('[Background] Port message forwarded to backend');
          port.postMessage({ success: true });
        } else {
          console.error('[Background] Backend error:', response.status);
          port.postMessage({ success: false, error: response.status });
        }
      })
      .catch(error => {
        console.error('[Background] Failed to reach backend:', error);
        port.postMessage({ success: false, error: error.message });
      });
    }
  });
  
  port.onDisconnect.addListener(() => {
    console.log('[Background] Port disconnected:', port.name);
  });
});

console.log('[Background] Service worker ready - extension active');
