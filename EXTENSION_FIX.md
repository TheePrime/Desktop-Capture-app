# Extension CORS Fix

## Problem
The extension was failing to send click data to the backend with two errors:

1. **CORS/Private Network Access Error:**
   ```
   Access to fetch at 'http://127.0.0.1:8000/ext_event' from origin 'https://www.linkedin.com' 
   has been blocked by CORS policy: Permission was denied for this request to access the `unknown` 
   address space.
   ```

2. **Port Connection Errors:**
   ```
   Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist.
   ```

## Root Causes

### 1. Private Network Access (PNA)
Chrome has a security feature called **Private Network Access** that blocks websites from public networks (like HTTPS sites) from accessing local servers (localhost) without explicit permission.

The backend CORS middleware was configured correctly, but it was missing the specific header required for Private Network Access: `Access-Control-Allow-Private-Network: true`

### 2. Unnecessary Extension Messaging
The `content.js` script was trying to send data to the background script via:
- `chrome.runtime.connect()` - creating persistent ports
- `chrome.runtime.sendMessage()` - one-off messages
- WebSocket fallback

Since the extension now sends data **directly to the backend via HTTP**, all this extension messaging code was unnecessary and causing errors.

## Solutions Applied

### Backend Fix (backend/main.py)
Added Private Network Access middleware to allow requests from public websites to localhost:

```python
# Add Private Network Access (PNA) headers for Chrome extension
@app.middleware("http")
async def add_pna_headers(request, call_next):
    response = await call_next(request)
    # Allow requests from public websites to localhost
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response
```

### Extension Fix (extension/content.js)
1. **Removed port connection code** - No longer creates persistent ports to background script
2. **Removed sendMessage fallback** - No longer tries to send data to background script
3. **Removed WebSocket fallback** - Not needed since HTTP works
4. **Simplified to HTTP only** - Only sends data directly to backend via fetch()

## Result
✅ Extension sends click data directly to backend via HTTP  
✅ No more CORS errors  
✅ No more "Could not establish connection" errors  
✅ Cleaner, simpler code with fewer failure points  

## How It Works Now

```
User clicks on LinkedIn post
        ↓
content.js captures click + text
        ↓
fetch('http://127.0.0.1:8000/ext_event')
        ↓
Backend receives request with PNA header
        ↓
Backend saves to clicks.ndjson + triggers screenshot
        ↓
Electron displays in Activities tab
```

## Testing
1. Reload the extension in Chrome (chrome://extensions)
2. Go to LinkedIn: https://www.linkedin.com/feed/
3. Click on a post
4. Check browser console - should see: `[Capture] Successfully sent to backend via HTTP`
5. Check backend logs - should see the request processed
6. No CORS errors, no connection errors

## Notes
- Backend must be running on port 8000 for extension to work
- The Private Network Access header is required for Chrome 117+ when accessing localhost from HTTPS sites
- All extension messaging code was removed to eliminate unnecessary complexity and errors
