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

// Handle messages from content scripts (optional - content scripts send directly to backend)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);
  
  // Just acknowledge the message
  sendResponse({ received: true });
  return true;
});

// Handle persistent port connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Background] Port connected:', port.name);
  
  port.onMessage.addListener((msg) => {
    console.log('[Background] Message from port:', msg);
    // Content scripts handle sending to backend directly
  });
  
  port.onDisconnect.addListener(() => {
    console.log('[Background] Port disconnected:', port.name);
  });
});

console.log('[Background] Service worker ready - extension active');
