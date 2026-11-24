(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LOCALES = globalThis.YNV_LOCALES || {};
  const DEFAULT_LANG = 'en';
  const DEFAULT_STATE = { enabled: false, deep: true, fallback: false };

  let tabId = null;
  let supported = false;
  let lang = DEFAULT_LANG;
  let state = { ...DEFAULT_STATE };

  const hasApi = typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && chrome.storage;
  const strings = () => LOCALES[lang] || LOCALES[DEFAULT_LANG] || {};

  function setText(id, key) {
    const el = $(id);
    const value = strings()[key];
    if (el && value) el.textContent = value;
  }

  function buildLangPicker() {
    const sel = $('lang');
    sel.textContent = '';
    for (const [code, pack] of Object.entries(LOCALES)) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = pack._name || code;
      sel.appendChild(opt);
    }
    sel.value = LOCALES[lang] ? lang : DEFAULT_LANG;
  }

  function render() {
    const s = strings();
    document.documentElement.lang = LOCALES[lang] ? lang : DEFAULT_LANG;
    ['scope', 'langLabel', 'toggleTitle', 'toggleDesc', 'deepTitle', 'deepDesc', 'footer', 'retry']
      .forEach((id) => setText(id, id));

    $('enabled').checked = state.enabled;
    $('deep').checked = state.deep && !state.fallback;
    $('enabled').disabled = !supported;
    $('deep').disabled = !supported || !state.enabled;
    $('dot').classList.toggle('on', supported && state.enabled);

    if (!hasApi) {
      $('err').hidden = false;
      $('err').textContent = s.errPreview || '';
      $('err').classList.add('is-preview');
    } else {
      $('err').classList.remove('is-preview');
      $('err').hidden = supported;
      if (!supported) $('err').textContent = s.errTab || '';
    }

    const note = $('note');
    const retry = $('retry');
    if (!supported || !state.enabled) {
      note.hidden = true;
      retry.hidden = true;
    } else if (state.fallback) {
      note.hidden = false;
      note.textContent = s.noteFallback || '';
      retry.hidden = false;
    } else if (state.deep) {
      note.hidden = false;
      note.textContent = s.noteActive || '';
      retry.hidden = true;
    } else {
      note.hidden = false;
      note.textContent = s.noteL1 || '';
      retry.hidden = true;
    }
  }

  async function send(message) {
    if (tabId === null || !hasApi) throw new Error('no tab');
    const res = await chrome.tabs.sendMessage(tabId, message);
    if (!res || !res.ok) throw new Error('no content script');
    return res;
  }

  async function setState(patch) {
    try {
      const res = await send({ type: 'YNV_SET_STATE', ...patch });
      state = res.state;
    } catch (_) {
      supported = false;
    }
    render();
  }

  async function setLang(code) {
    if (!LOCALES[code]) return;
    lang = code;
    try { await chrome.storage.local.set({ 'ynv.lang': code }); } catch (_) {}
    $('lang').value = code;
    render();
  }

  $('enabled').addEventListener('change', (e) => setState({ enabled: e.target.checked }));
  $('deep').addEventListener('change', (e) => setState({ deep: e.target.checked }));
  $('retry').addEventListener('click', () => setState({ retry: true }));
  $('lang').addEventListener('change', (e) => setLang(e.target.value));

  if (hasApi && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'YNV_STATE' && msg.state) {
        state = msg.state;
        render();
      } else if (msg && msg.type === 'YNV_FALLBACK' && msg.state) {
        state = msg.state;
        render();
      }
    });
  }

  async function init() {
    try {
      const res = await chrome.storage.local.get('ynv.lang');
      const saved = res && res['ynv.lang'];
      lang = saved && LOCALES[saved] ? saved : DEFAULT_LANG;
    } catch (_) { lang = DEFAULT_LANG; }

    buildLangPicker();
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) throw new Error('no active tab');
      tabId = tabs[0].id;
      const res = await send({ type: 'YNV_GET_STATE' });
      state = res.state;
      supported = true;
    } catch (_) {
      supported = false;
    }
    render();
  }

  if (hasApi) init();
  else { lang = DEFAULT_LANG; buildLangPicker(); render(); }
})();
