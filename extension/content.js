console.log('[Capture] Content script loaded on:', window.location.href);

const BACKEND = 'http://127.0.0.1:8000';

function canUseChromeRuntime() {
  try {
    return typeof chrome !== 'undefined' && chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function';
  } catch (e) {
    return false;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function expandSeeMore(root) {
  // Broader set of expansion triggers for LinkedIn and X
  const selectors = [
    // LinkedIn standard
    'button[aria-label="See more"]',
    'span[role="button"][aria-expanded="false"]',
    // LinkedIn variations
    '[aria-expanded="false"]',
    'button.see-more-less-button',
    'button.inline-show-more-text',
    // X/Twitter
    'div[data-testid="expand"]',
    'div[aria-label="Show more"]',
    '[data-testid="tweet-text-show-more-link"]',
    // Common patterns
    'button.show-more',
    '.show-more-button',
  ];

  // First pass: standard buttons
  for (const sel of selectors) {
    let btns;
    try {
      btns = root.querySelectorAll(sel);
    } catch (err) {
      console.warn('[Capture] Invalid selector skipped:', sel, err);
      continue;
    }
    for (const b of btns) {
      try { 
        b.click();
        // Small delay between clicks to let UI update
        await sleep(50);
      } catch (e) {
        console.warn('[Capture] Click failed:', e);
      }
    }
  }

  // Second pass: text-based buttons
  const expandTexts = ['see more', 'show more', 'expand', 'read more'];
  const buttonEls = Array.from(root.querySelectorAll('span[role="button"], button, a[role="button"]'));
  for (const btn of buttonEls) {
    try {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (expandTexts.some(t => text.includes(t))) {
        btn.click();
        await sleep(50);
      }
    } catch (e) {
      console.warn('[Capture] Text-based click failed:', e);
    }
  }

  // Wait for expansions to complete
  await sleep(250);
}

function nearestPostContainer(el) {
  // Simplified selector list - get any container that might have content
  const selectors = [
    // LinkedIn post containers
    '.feed-shared-update-v2',
    '.feed-shared-mini-update-v2',
    '.occludable-update',
    '[data-urn]',
    // X/Twitter containers  
    '[data-testid="tweet"]',
    '[role="article"]',
    // Generic content
    'article',
    '.post',
    // Fallback to closest major container
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '.update-components-text'
  ];

  // Walk up the tree looking for containers
  let current = el;
  while (current && current !== document.body) {
    for (const selector of selectors) {
      try {
        if (current.matches(selector)) {
          console.log('[Capture] Found container:', selector);
          return current;
        }
      } catch (e) {
        console.warn('[Capture] Selector match failed:', e);
      }
    }
    current = current.parentElement;
  }

  // If no container found, return closest parent with content
  console.log('[Capture] No specific container found, using parent');
  return el.parentElement || document.body;
  
  let cur = el;
  while (cur && cur !== document.body) {
    if (!cur.matches) continue;
    for (const [selector, validator] of Object.entries(containers)) {
      if (cur.matches(selector)) {
        if (typeof validator === 'function') {
          if (validator(cur)) return cur;
        } else {
          return cur;
        }
      }
    }
    cur = cur.parentElement;
  }
  
  // If we didn't find a post container, try a broader search within
  // a reasonable ancestor to handle embedded/quote posts
  cur = el;
  let searchRoot = el;
  for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
    searchRoot = cur;
    cur = cur.parentElement;
  }
  
  for (const [selector, validator] of Object.entries(containers)) {
    const candidates = Array.from(searchRoot.querySelectorAll(selector));
    for (const candidate of candidates) {
      if (typeof validator === 'function') {
        if (validator(candidate)) return candidate;
      } else {
        return candidate;
      }
    }
  }
  
  return document.body;
}

function extractTextFromContainer(container) {
  console.log('[Capture] Extracting text from container:', container.tagName, container.className);
  
  // Try LinkedIn-specific selectors first
  const linkedInSelectors = [
    '.feed-shared-update-v2__description',
    '.feed-shared-text-view',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-update-v2__commentary',
    '.update-components-text',
    '[data-test-id="main-feed-activity-card__commentary"]'
  ];

  for (const selector of linkedInSelectors) {
    const element = container.querySelector(selector);
    if (element) {
      console.log('[Capture] Found LinkedIn text container:', selector);
      const text = (element.innerText || element.textContent || '').trim();
      if (text) {
        console.log('[Capture] LinkedIn text preview:', text.slice(0, 100) + '...');
        return text;
      }
    }
  }

  // Fallback to general extraction
  console.log('[Capture] Using general text extraction');
  const clone = container.cloneNode(true);
  
  // Remove non-content elements
  clone.querySelectorAll('script,style,noscript,svg,iframe,img').forEach(n => n.remove());
  
  // Remove buttons/controls/headers
  clone.querySelectorAll('button,[role="button"],a[role="button"],[role="heading"],header,nav').forEach(n => n.remove());
  
  // Remove LinkedIn UI elements
  clone.querySelectorAll('.feed-shared-control-menu,.feed-shared-social-actions,.social-details-social-counts').forEach(n => n.remove());
  
  const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  console.log('[Capture] General text preview:', text.slice(0, 100) + '...');
  return text;
}

async function handleClick(ev) {
  try {
    console.log('[Capture] Click detected at:', ev.clientX, ev.clientY);
    console.log('[Capture] Screen coords:', window.screenX, window.screenY);
    
    // Get clicked element's text content first
    let directText = '';
    try {
      directText = ev.target.innerText || ev.target.textContent || '';
    } catch (e) {
      console.warn('[Capture] Failed to get direct text:', e);
    }

    // Then try to find a larger container
    let containerText = '';
    try {
      const container = nearestPostContainer(ev.target);
      await expandSeeMore(container);
      containerText = extractTextFromContainer(container);
    } catch (e) {
      console.warn('[Capture] Container extraction failed:', e);
    }

    // Use the longer text content
    const text = containerText.length > directText.length ? containerText : directText;
    
    // More accurate coordinate calculation
    const dpr = window.devicePixelRatio || 1;
    const globalX = Math.round((window.screenX || window.screenLeft || 0) + (ev.clientX * dpr));
    const globalY = Math.round((window.screenY || window.screenTop || 0) + (ev.clientY * dpr));
    
    console.log('[Capture] Sending click:', {
      globalX, globalY,
      dpr,
      screenX: window.screenX,
      screenY: window.screenY,
      url: location.href,
      text: text.slice(0, 100) + '...' // Log preview
    });

    const payload = {
      type: 'POST_CONTENT',
      text: text || 'No text extracted',
      url: location.href,
      title: document.title,
      x: ev.clientX,
      y: ev.clientY,
      // Approximate global screen coordinates (may be used by native host to map display)
      global_x: Math.round((window.screenX || window.screenLeft || 0) + ev.clientX * (window.devicePixelRatio || 1)),
      global_y: Math.round((window.screenY || window.screenTop || 0) + ev.clientY * (window.devicePixelRatio || 1)),
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    console.log('[Capture] Sending click event:', payload);
    
    // Always send to the extension background which will handle native host or
    // HTTP fallback. Avoid doing page-origin fetches (these trigger PNA/CORS
    // errors on HTTPS sites like LinkedIn). The background has host_permissions
    // for the local backend and will perform the HTTP POST when native fails.
    try {
      if (canUseChromeRuntime()) {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Capture] Error sending message to background:', chrome.runtime.lastError);
            return;
          }
          console.log('[Capture] Message response from background:', response);
          if (response && !response.ok) {
            console.error('[Capture] Background reported error:', response.error);
          }
        });
      } else {
        // If runtime isn't available (very unusual for extension content scripts),
        // we avoid doing a direct fetch to the page origin because that can be
        // blocked by PNA/CORS on some sites. Log and skip.
        console.warn('[Capture] chrome.runtime not available in content script; skipping HTTP fallback to avoid PNA/CORS issues');
      }
    } catch (err) {
      console.error('[Capture] sendMessage threw synchronously:', err);
    }
  
  } catch (e) {
    console.error('[Capture] Error in handleClick:', e);
  }
}

// Add debounce to prevent duplicate events
let lastClickTime = 0;
const CLICK_DEBOUNCE_MS = 200;

function onMouseEvent(ev) {
  // Only handle left clicks
  if (ev.button !== 0) return;
  
  // Debounce rapid clicks
  const now = Date.now();
  if (now - lastClickTime < CLICK_DEBOUNCE_MS) {
    console.log('[Capture] Debounced click event');
    return;
  }
  lastClickTime = now;

  handleClick(ev);
}

// Only listen for mousedown to get the most accurate click position
window.addEventListener('mousedown', onMouseEvent, { capture: true });

// Handle PDF embeds specially
function installPdfListeners() {
  const pdfElements = document.querySelectorAll('embed[type="application/pdf"], object[type="application/pdf"]');
  pdfElements.forEach(el => {
    try {
      el.addEventListener('mousedown', onMouseEvent, { capture: true });
    } catch (err) {
      console.warn('[Capture] Could not attach to PDF viewer:', err);
    }
  });
}

// Install PDF handlers now and after a delay for dynamic embeds
installPdfListeners();
setTimeout(installPdfListeners, 1000);


