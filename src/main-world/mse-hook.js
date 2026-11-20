(() => {
  'use strict';

  const STATE_KEY = 'ynv.state';
  const CH_PAGE = 'ynv:page';
  const CH_CONTENT = 'ynv:content';
  const DEFAULT_STATE = { enabled: false, deep: true, fallback: false };

  let cached = null;
  let cachedAt = 0;

  function readState() {
    const now = Date.now();
    if (cached && now - cachedAt < 150) return cached;
    let out = DEFAULT_STATE;
    try {
      const raw = window.sessionStorage.getItem(STATE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        out = { enabled: !!s.enabled, deep: s.deep !== false, fallback: !!s.fallback };
      }
    } catch (_) { /* storage unavailable: stay inactive */ }
    cached = out;
    cachedAt = now;
    return out;
  }

  function deepActive() {
    const s = readState();
    return s.enabled && s.deep && !s.fallback;
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.channel !== CH_CONTENT || d.type !== 'STATE_CHANGED') return;
    cached = null;
    cachedAt = 0;
  });

  const ctors = [window.MediaSource, window.ManagedMediaSource].filter(Boolean);
  const SBP = window.SourceBuffer && window.SourceBuffer.prototype;
  const elProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (!ctors.length || !SBP || !elProto || typeof SBP.appendBuffer !== 'function') return;

  const nativeAppend = SBP.appendBuffer;
  const sbBufferedDesc = Object.getOwnPropertyDescriptor(SBP, 'buffered');
  const nativeCreateObjectURL = window.URL.createObjectURL;

  const urlToMs = new Map();
  const msToAudioSb = new WeakMap();
  const msToElement = new WeakMap();
  const elementToMs = new WeakMap();
  const patchedElements = new WeakSet();

  let droppedSegments = 0;
  let droppedBytes = 0;

  function primaryVideo() {
    try { return window.document.querySelector('video'); } catch (_) { return null; }
  }

  function isMediaSource(v) {
    return !!v && typeof v.addSourceBuffer === 'function' && v.sourceBuffers != null;
  }

  function syntheticRanges(el) {
    const t = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : t + 60;
    const end = Math.min(dur, Math.max(t + 1, t + 30));
    return { length: 1, start: () => 0, end: () => end };
  }

  function audioRangesFor(el) {
    const ms = elementToMs.get(el);
    const audio = ms && msToAudioSb.get(ms);
    if (audio) {
      try { return audio.buffered; } catch (_) {}
    }
    return syntheticRanges(el);
  }

  function patchGetter(el, name, fake) {
    const d = Object.getOwnPropertyDescriptor(elProto, name);
    if (!d || !d.get) return;
    Object.defineProperty(el, name, {
      configurable: true,
      get() { return deepActive() ? fake.call(this) : d.get.call(this); }
    });
  }

  function patchElement(el) {
    if (!el || patchedElements.has(el)) return;
    patchedElements.add(el);
    patchGetter(el, 'buffered', function () { return audioRangesFor(this); });
    patchGetter(el, 'readyState', function () { return 4; });
    patchGetter(el, 'videoWidth', function () { return 1280; });
    patchGetter(el, 'videoHeight', function () { return 720; });
  }

  function linkElement(el, value) {
    const ms = typeof value === 'string'
      ? urlToMs.get(value)
      : (isMediaSource(value) ? value : null);
    if (!ms) return;
    msToElement.set(ms, el);
    elementToMs.set(el, ms);
    patchElement(el);
  }

  window.URL.createObjectURL = function (obj) {
    const url = nativeCreateObjectURL.apply(this, arguments);
    if (isMediaSource(obj)) urlToMs.set(url, obj);
    return url;
  };

  const srcDesc = Object.getOwnPropertyDescriptor(elProto, 'src');
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(elProto, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get: srcDesc.get ? function () { return srcDesc.get.call(this); } : undefined,
      set(v) { srcDesc.set.call(this, v); linkElement(this, v); }
    });
  }

  const srcObjDesc = Object.getOwnPropertyDescriptor(elProto, 'srcObject');
  if (srcObjDesc && srcObjDesc.set) {
    Object.defineProperty(elProto, 'srcObject', {
      configurable: true,
      enumerable: srcObjDesc.enumerable,
      get: srcObjDesc.get ? function () { return srcObjDesc.get.call(this); } : undefined,
      set(v) { srcObjDesc.set.call(this, v); linkElement(this, v); }
    });
  }

  const pending = [];
  let draining = false;

  function drain() {
    const sb = pending.shift();
    if (!sb) { draining = false; return; }
    draining = true;
    setTimeout(() => {
      // An accepted append must always complete, even if the switch is flipped
      // mid-flight; otherwise the player waits forever for updateend.
      try {
        sb.dispatchEvent(new Event('update'));
        sb.dispatchEvent(new Event('updateend'));
      } catch (_) {}
      drain();
    }, 120);
  }

  function pretendAppend(sb) {
    droppedSegments += 1;
    if (pending.length > 256) pending.shift();
    pending.push(sb);
    if (!draining) drain();
  }

  function wrapVideoBuffer(sb, ms) {
    if (sb.__ynvVideo) return;
    try {
      Object.defineProperty(sb, '__ynvVideo', { value: true, configurable: true });
    } catch (_) { return; }

    Object.defineProperty(sb, 'appendBuffer', {
      configurable: true,
      writable: true,
      value: function (data) {
        if (!deepActive()) return nativeAppend.call(sb, data);
        try { droppedBytes += (data && data.byteLength) || 0; } catch (_) {}
        pretendAppend(sb);
      }
    });

    if (sbBufferedDesc && sbBufferedDesc.get) {
      Object.defineProperty(sb, 'buffered', {
        configurable: true,
        get() {
          if (!deepActive()) return sbBufferedDesc.get.call(sb);
          const el = msToElement.get(ms) || primaryVideo();
          return audioRangesFor(el || { currentTime: 0, duration: 0 });
        }
      });
    }
  }

  function install(ctor) {
    let owner = ctor.prototype;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, 'addSourceBuffer')) {
      owner = Object.getPrototypeOf(owner);
    }
    if (!owner) return;
    const orig = owner.addSourceBuffer;
    if (typeof orig !== 'function' || orig.__ynvPatched) return;

    const patched = function (mime) {
      const sb = orig.call(this, mime);
      try {
        if (typeof mime === 'string') {
          if (/^audio\//i.test(mime)) msToAudioSb.set(this, sb);
          else if (/^video\//i.test(mime)) wrapVideoBuffer(sb, this);
        }
        const el = msToElement.get(this) || primaryVideo();
        if (el) {
          msToElement.set(this, el);
          elementToMs.set(el, this);
          patchElement(el);
        }
      } catch (_) {}
      return sb;
    };
    patched.__ynvPatched = true;
    try { owner.addSourceBuffer = patched; } catch (_) {}
  }
  ctors.forEach(install);

  function fallback(reason) {
    let enabled = false;
    try {
      const raw = window.sessionStorage.getItem(STATE_KEY);
      if (raw) enabled = !!JSON.parse(raw).enabled;
    } catch (_) {}
    try {
      window.sessionStorage.setItem(STATE_KEY, JSON.stringify({
        enabled, deep: false, fallback: true
      }));
    } catch (_) {}
    cached = null;
    cachedAt = 0;
    try {
      window.postMessage({
        channel: CH_PAGE, type: 'FALLBACK', reason, droppedSegments, droppedBytes
      }, '*');
    } catch (_) {}
  }

  let wasActive = false;
  let activeSince = 0;
  let lastTime = -1;
  let stalledTicks = 0;
  let seekingTicks = 0;

  setInterval(() => {
    const active = deepActive();
    const now = Date.now();
    if (active && !wasActive) {
      activeSince = now; lastTime = -1; stalledTicks = 0; seekingTicks = 0;
    }
    wasActive = active;
    if (!active) { lastTime = -1; stalledTicks = 0; seekingTicks = 0; return; }
    if (now - activeSince < 6000) return;

    const el = primaryVideo();
    if (!el) return;
    if (el.error) { fallback('media-error'); return; }
    if (el.seeking) {
      seekingTicks += 1;
      if (seekingTicks >= 4) fallback('stuck-seeking');
      return;
    }
    seekingTicks = 0;
    if (el.paused || el.ended) { stalledTicks = 0; lastTime = el.currentTime; return; }
    if (lastTime >= 0 && el.currentTime <= lastTime + 0.05) {
      stalledTicks += 1;
      if (stalledTicks >= 4) fallback('stalled-4s');
    } else {
      stalledTicks = 0;
      lastTime = el.currentTime;
    }
  }, 1000);
})();
