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
  const selectors = [
    'button[aria-label="See more"]',
    'span[role="button"][aria-expanded="false"]',
    'div[data-testid="expand"]',
    'div[aria-label="Show more"]'
  ];
  for (const sel of selectors) {
    let btns;
    try {
      btns = root.querySelectorAll(sel);
    } catch (err) {
      console.warn('[Capture] Invalid selector skipped:', sel, err);
      continue;
    }
    for (const b of btns) {
      try { b.click(); } catch {}
    }
  }

  // Manually click text-based "See more" buttons (querySelector can't match by text)
  const textButtons = Array.from(root.querySelectorAll('span[role="button"], button'))
    .filter((el) => (el.innerText || '').trim().toLowerCase() === 'see more');
  for (const btn of textButtons) {
    try { btn.click(); } catch {}
  }

  await sleep(150);
}

function nearestPostContainer(el) {
  const containers = [
    'article', // common container
    'div[data-testid="tweet"]',
    'div.feed-shared-update-v2',
  ];
  let cur = el;
  while (cur && cur !== document.body) {
    for (const c of containers) {
      if (cur.matches && cur.matches(c)) return cur;
    }
    cur = cur.parentElement;
  }
  return document.body;
}

function extractTextFromContainer(container) {
  const clone = container.cloneNode(true);
  // Remove non-content elements
  clone.querySelectorAll('script,style,noscript,svg').forEach(n => n.remove());
  // Remove buttons/controls
  clone.querySelectorAll('button,[role="button"],a[role="button"]').forEach(n => n.remove());
  return (clone.innerText || '').replace(/\s+/g, ' ').trim();
}

async function handleClick(ev) {
  try {
    console.log('[Capture] Click detected at:', ev.clientX, ev.clientY);
    const container = nearestPostContainer(ev.target);
    await expandSeeMore(container);
    const text = extractTextFromContainer(container);
    
    // Always send click event, even if text is empty
    const payload = {
      type: 'POST_CONTENT',
      text: text || 'No text extracted',
      url: location.href,
      title: document.title,
      x: ev.clientX,
      y: ev.clientY,
    };
    console.log('[Capture] Sending click event:', payload);
    
    // Use one-off sendMessage (reliable for MV3 service workers) if possible
    let sent = false;
    if (canUseChromeRuntime()) {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Capture] Error sending message:', chrome.runtime.lastError);
            return;
          }
          console.log('[Capture] Message response:', response);
          if (response && !response.ok) {
            console.error('[Capture] Backend error:', response.error);
          }
        });
        sent = true;
      } catch (err) {
        console.error('[Capture] sendMessage threw synchronously:', err);
      }
    }

    // If messaging isn't available or failed, fall back to HTTP POST to backend
    if (!sent) {
      try {
        fetch(`${BACKEND}/ext_event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: payload.text, url: payload.url, title: payload.title, x: payload.x, y: payload.y })
        }).then(res => res.json()).then(r => console.log('[Capture] Backend HTTP fallback response:', r)).catch(e => console.error('[Capture] Backend HTTP fallback failed:', e));
        sent = true;
      } catch (e) {
        console.error('[Capture] HTTP fallback threw:', e);
      }
    }
  
  } catch (e) {
    console.error('[Capture] Error in handleClick:', e);
  }
}

window.addEventListener('click', handleClick, { capture: true });


