(() => {
  'use strict';

  const STATE_KEY = 'ynv.state';
  const LANG_KEY = 'ynv.lang';
  const CH_PAGE = 'ynv:page';
  const CH_CONTENT = 'ynv:content';
  const DEFAULT = { enabled: false, deep: true, fallback: false };
  const DEFAULT_LANG = 'en';
  const FALLBACK_HINT = {
    hintTitle: 'YouTube No Video.',
    hintSub: "To play the video, go to the extension on your browser's toolbar."
  };
  const LOCALES = globalThis.YNV_LOCALES || {};

  let enabled = false;
  let lang = DEFAULT_LANG;

  function strings() {
    return LOCALES[lang] || LOCALES[DEFAULT_LANG] || FALLBACK_HINT;
  }

  function read() {
    try {
      const raw = window.sessionStorage.getItem(STATE_KEY);
      if (!raw) return { ...DEFAULT };
      const s = JSON.parse(raw);
      return { enabled: !!s.enabled, deep: s.deep !== false, fallback: !!s.fallback };
    } catch (_) {
      return { ...DEFAULT };
    }
  }

  function write(s) {
    try { window.sessionStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {}
    window.postMessage({ channel: CH_CONTENT, type: 'STATE_CHANGED', state: s }, '*');
  }

  function mark(v) {
    if (!v.hasAttribute('data-ynv')) v.setAttribute('data-ynv', '1');
  }

  function applyHintText(host) {
    const s = strings();
    host.setAttribute('data-ynv-title', s.hintTitle || FALLBACK_HINT.hintTitle);
    host.setAttribute('data-ynv-sub', s.hintSub || FALLBACK_HINT.hintSub);
  }

  function refreshHints() {
    document.querySelectorAll('[data-ynv-host]').forEach(applyHintText);
  }

  function clearHost(h) {
    h.removeAttribute('data-ynv-host');
    h.removeAttribute('data-ynv-title');
    h.removeAttribute('data-ynv-sub');
    h.classList.remove('ynv-relative');
  }

  const PLAYER_SEL = [
    'ytd-player', '#movie_player', '.html5-video-player',
    '.html5-video-container', '#player-container', '#player'
  ].join(', ');

  function markHost(v) {
    // Hover previews and ad thumbnails also create <video> nodes: only the
    // real player gets the hint, and never more than one at a time.
    let inPlayer = false;
    try { inPlayer = !!(v.closest && v.closest(PLAYER_SEL)); } catch (_) {}
    if (!inPlayer) return;

    const host = v.parentElement;
    if (!host || host.hasAttribute('data-ynv-host')) return;
    if (document.querySelectorAll('[data-ynv-host]').length) return;
    host.setAttribute('data-ynv-host', '1');
    applyHintText(host);
    try {
      if (window.getComputedStyle(host).position === 'static') host.classList.add('ynv-relative');
    } catch (_) {
      host.classList.add('ynv-relative');
    }
  }

  function markAll(v) { mark(v); markHost(v); }

  function unmarkAll() {
    document.querySelectorAll('video[data-ynv]').forEach(v => v.removeAttribute('data-ynv'));
    document.querySelectorAll('[data-ynv-host]').forEach(clearHost);
  }

  let heartbeatTimer = 0;

  function dismissStillThere() {
    const dialogs = document.querySelectorAll(
      'yt-confirm-dialog-renderer, ytd-confirm-dialog-renderer, [role="dialog"]'
    );
    for (const dlg of dialogs) {
      const text = (dlg.textContent || '').trim().slice(0, 400);
      if (!/still there|continue watching|还在观看|仍在观看|继续播放|视频已暂停/i.test(text)) continue;
      const btn = dlg.querySelector('#confirm-button, button, yt-button-renderer');
      if (btn) { btn.click(); return; }
    }
  }

  function startIdleGuard() {
    if (heartbeatTimer) return;
    heartbeatTimer = window.setInterval(() => {
      try { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); } catch (_) {}
      dismissStillThere();
    }, 30000);
  }

  function stopIdleGuard() {
    if (heartbeatTimer) { window.clearInterval(heartbeatTimer); heartbeatTimer = 0; }
  }

  function applyState(s) {
    enabled = !!s.enabled;
    if (enabled) {
      // Drop stale hosts from a previous player instance before re-marking.
      document.querySelectorAll('[data-ynv-host]').forEach(clearHost);
      document.querySelectorAll('video').forEach(markAll);
      startIdleGuard();
    } else {
      unmarkAll();
      stopIdleGuard();
    }
  }

  let lastDismiss = 0;
  const domObserver = new MutationObserver((records) => {
    if (!enabled) return;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'VIDEO') markAll(n);
        else if (n.querySelectorAll) n.querySelectorAll('video').forEach(markAll);
      }
    }
    const now = Date.now();
    if (now - lastDismiss > 1000) { lastDismiss = now; dismissStillThere(); }
  });

  function startDomObserver() {
    const root = document.documentElement;
    if (!root) return false;
    domObserver.observe(root, { childList: true, subtree: true });
    return true;
  }

  if (!startDomObserver()) {
    document.addEventListener('DOMContentLoaded', startDomObserver, { once: true });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const reply = (payload) => { try { sendResponse(payload); } catch (_) {} };
    if (!msg || typeof msg.type !== 'string') { reply({ ok: false }); return true; }

    if (msg.type === 'YNV_GET_STATE') { reply({ ok: true, state: read() }); return true; }

    if (msg.type === 'YNV_SET_STATE') {
      const cur = read();
      const next = { ...cur };
      if (typeof msg.enabled === 'boolean') next.enabled = msg.enabled;
      if (typeof msg.deep === 'boolean') next.deep = msg.deep;
      if (msg.retry === true || (msg.deep === true && cur.fallback)) {
        next.deep = true;
        next.fallback = false;
      }
      write(next);
      applyState(next);
      reply({ ok: true, state: next });
      return true;
    }

    reply({ ok: false, error: 'unknown type' });
    return true;
  });

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.channel !== CH_PAGE || d.type !== 'FALLBACK') return;
    const s = read();
    applyState(s);
    try {
      chrome.runtime.sendMessage(
        { type: 'YNV_FALLBACK', reason: d.reason, state: s },
        () => void chrome.runtime.lastError
      );
    } catch (_) {}
  });

  function setLang(value) {
    lang = value && LOCALES[value] ? value : DEFAULT_LANG;
    refreshHints();
  }

  function initLang() {
    try {
      chrome.storage.local.get(LANG_KEY, (res) => setLang(res && res[LANG_KEY]));
    } catch (_) { /* storage unavailable: keep English */ }
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[LANG_KEY]) return;
        setLang(changes[LANG_KEY].newValue);
      });
    } catch (_) {}
  }

  applyState(read());
  initLang();
})();
