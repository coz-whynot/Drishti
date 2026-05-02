/**
 * ws-client.js — Drishti dashboard WebSocket client (watch-mode only).
 *
 * Detects mode at runtime: if the page was opened via file:// (static mode)
 * this is a no-op. If opened via http://localhost:* (watch mode) it connects
 * to ws://<host>/ws, listens for snapshot:updated frames, fetches the new
 * snapshot, and re-renders the dashboard via window.__DRISHTI_RENDER__.
 *
 * Auto-reconnects with exponential backoff on close.
 */
(function () {
  if (typeof window === 'undefined') return;

  const indicator = document.getElementById('liveIndicator');

  function setIndicator(state, text) {
    if (!indicator) return;
    indicator.classList.remove('live', 'offline', 'static');
    indicator.classList.add(state);
    indicator.textContent = text;
  }

  // Static mode = file:// → nothing to do.
  if (window.location.protocol === 'file:') {
    setIndicator('static', '○ Static');
    return;
  }
  if (!/^https?:$/.test(window.location.protocol)) {
    setIndicator('static', '○ Static');
    return;
  }

  // Watch mode bootstrap.
  const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
    window.location.host + '/ws';
  let ws = null;
  let reconnectDelay = 500;       // 0.5s, doubles up to ~30s
  const MAX_RECONNECT = 30000;

  setIndicator('offline', '○ Connecting...');

  function applyUpdate() {
    fetch('/drishti-scans/current.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(snapshot => {
        if (typeof window.__DRISHTI_RENDER__ === 'function') {
          window.__DRISHTI_RENDER__(snapshot);
        } else {
          window.__DRISHTI_SNAPSHOT__ = snapshot;
        }
      })
      .catch(err => {
        // Fail loud in console — surface real errors instead of swallowing.
        console.error('[drishti] failed to fetch updated snapshot:', err);
      });
  }

  function connect() {
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[drishti] WebSocket construction failed:', err);
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      setIndicator('live', '● Live');
      reconnectDelay = 500;
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'snapshot:updated') {
        applyUpdate();
      }
      // hello frames are informational; nothing to do.
    });

    ws.addEventListener('close', () => {
      setIndicator('offline', '○ Offline');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // close fires after error; let close handle reconnect.
    });
  }

  function scheduleReconnect() {
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT);
      connect();
    }, reconnectDelay);
  }

  connect();
})();
