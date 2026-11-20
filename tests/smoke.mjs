import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (name) => { results.push(name); console.log(`  PASS  ${name}`); };

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

const allFiles = walk(ROOT).filter((p) => !p.includes(`${path.sep}.workbuddy${path.sep}`));
const jsFiles = allFiles.filter((p) => p.endsWith('.js') || p.endsWith('.mjs'));

console.log('\n[1] Syntax check');
for (const f of jsFiles) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
ok(`${jsFiles.length} JS files parse cleanly`);

console.log('\n[2] Manifest + assets');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.content_scripts.length, 2);
assert.ok(manifest.content_scripts.some((cs) => cs.world === 'MAIN' && cs.run_at === 'document_start'));
assert.ok(manifest.content_scripts.some((cs) => (cs.world === 'ISOLATED' || !cs.world) && cs.run_at === 'document_start'));
for (const cs of manifest.content_scripts) {
  assert.ok(cs.matches.every((m) => /youtube/.test(m)), 'must be scoped to youtube only');
}
const refs = [];
for (const cs of manifest.content_scripts) refs.push(...(cs.js || []), ...(cs.css || []));
refs.push(manifest.action.default_popup, ...Object.values(manifest.icons));
for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, r)), `missing asset: ${r}`);
const css = fs.readFileSync(path.join(ROOT, 'src/content/no-video.css'), 'utf8');
assert.match(css, /video\[data-ynv="1"\]/);
assert.match(css, /visibility:\s*hidden\s*!important/);
assert.match(css, /opacity:\s*0\s*!important/);
assert.doesNotMatch(css, /position:\s*fixed/, 'geometry must stay untouched');
assert.match(css, /\[data-ynv-host="1"\]::before/);
assert.match(css, /\[data-ynv-host="1"\]::after/);
assert.match(css, /content:\s*attr\(data-ynv-title\)/);
assert.match(css, /content:\s*attr\(data-ynv-sub\)/);
assert.doesNotMatch(css, /content:\s*"/, 'hint text must come from the locale pack');
assert.ok((manifest.permissions || []).includes('storage'), 'language preference needs chrome.storage');
const isolatedCs = manifest.content_scripts.find((cs) => cs.world === 'ISOLATED');
assert.ok(isolatedCs.js.includes('src/i18n/strings.js'));
assert.ok(
  isolatedCs.js.indexOf('src/i18n/strings.js') < isolatedCs.js.indexOf('src/content/controller.js'),
  'strings.js must execute before controller.js'
);
const popupHtml = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');
assert.match(popupHtml, /<html lang="en">/);
assert.match(popupHtml, /src="\.\.\/i18n\/strings\.js"/);
assert.match(popupHtml, /<select id="lang">/);
const popupJs = fs.readFileSync(path.join(ROOT, 'src/popup/popup.js'), 'utf8');
assert.match(popupJs, /DEFAULT_LANG\s*=\s*'en'/);
assert.match(popupJs, /Object\.entries\(LOCALES\)/, 'picker must be generated from locale keys');
ok('manifest V3, dual-world, youtube-only, i18n wiring, all assets present');

console.log('\n[2b] Translation completeness');
const LOCALES = vm.runInNewContext(
  fs.readFileSync(path.join(ROOT, 'src/i18n/strings.js'), 'utf8') + '\n;globalThis.YNV_LOCALES;'
);
assert.ok(LOCALES && LOCALES.en, 'en must exist and is the default');
assert.ok(LOCALES['zh-CN'], 'zh-CN must be available');
const baseKeys = Object.keys(LOCALES.en).filter((k) => k !== '_name').sort();
for (const [code, pack] of Object.entries(LOCALES)) {
  assert.ok(pack._name, `${code} needs _name`);
  const keys = Object.keys(pack).filter((k) => k !== '_name').sort();
  assert.deepEqual(keys, baseKeys, `${code} must translate exactly the en key set`);
  for (const k of keys) {
    assert.equal(typeof pack[k], 'string', `${code}.${k} must be a string`);
    assert.ok(pack[k].length > 0, `${code}.${k} must not be empty`);
  }
}
assert.equal(LOCALES.en.hintTitle, 'YouTube No Video.');
assert.equal(LOCALES.en.hintSub, "To play the video, go to the extension on your browser's toolbar.");
ok(`${Object.keys(LOCALES).length} locales, ${baseKeys.length} keys each, en is default`);

console.log('\n[3] MSE hook logic (mocked browser)');

class MockEvent { constructor(type) { this.type = type; } }

class MockTarget {
  constructor() { this._listeners = {}; this._events = []; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  dispatchEvent(ev) {
    this._events.push(ev.type);
    for (const fn of this._listeners[ev.type] || []) fn(ev);
    return true;
  }
}

class MockSourceBuffer extends MockTarget {
  constructor(mime) {
    super();
    this.mime = mime;
    this.nativeAppends = [];
    this._buffered = { length: 1, start: () => 0, end: () => 42 };
  }
  appendBuffer(data) { this.nativeAppends.push(data); }
}
Object.defineProperty(MockSourceBuffer.prototype, 'buffered', {
  configurable: true, get() { return this._buffered; }
});

class MockMediaSource {
  constructor() { this.sourceBuffers = []; }
  addSourceBuffer(mime) {
    const sb = new MockSourceBuffer(mime);
    this.sourceBuffers.push(sb);
    return sb;
  }
}

class MockMediaElement {
  constructor() {
    this._src = '';
    this.currentTime = 10;
    this.duration = 300;
    this.paused = false;
    this.ended = false;
    this.seeking = false;
    this.error = null;
    this._buffered = { length: 1, start: () => 0, end: () => 99 };
    this._readyState = 1;
    this._videoWidth = 0;
    this._videoHeight = 0;
  }
}
const elProto = MockMediaElement.prototype;
Object.defineProperty(elProto, 'src', {
  configurable: true, get() { return this._src; }, set(v) { this._src = v; }
});
Object.defineProperty(elProto, 'srcObject', {
  configurable: true, get() { return this._srcObject; }, set(v) { this._srcObject = v; }
});
for (const [name, field] of [
  ['buffered', '_buffered'], ['readyState', '_readyState'],
  ['videoWidth', '_videoWidth'], ['videoHeight', '_videoHeight']
]) {
  Object.defineProperty(elProto, name, { configurable: true, get() { return this[field]; } });
}

const store = new Map();
const sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const setState = (s) => store.set('ynv.state', JSON.stringify(s));
const getState = () => JSON.parse(store.get('ynv.state'));

let fakeNow = 1700000000000;
class FakeDate extends Date {
  static now() { return fakeNow; }
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
}

let blobSeq = 0;
const posted = [];
const msgListeners = [];
const intervals = [];
const videoEl = new MockMediaElement();

const win = {
  sessionStorage,
  MediaSource: MockMediaSource,
  ManagedMediaSource: undefined,
  SourceBuffer: MockSourceBuffer,
  HTMLMediaElement: MockMediaElement,
  URL: { createObjectURL: () => `blob:mock/${++blobSeq}` },
  document: { querySelector: (sel) => (sel === 'video' ? videoEl : null) },
  addEventListener: (type, fn) => { if (type === 'message') msgListeners.push(fn); },
  postMessage: (data) => posted.push(data)
};

const context = vm.createContext({
  window: win,
  Event: MockEvent,
  URL: win.URL,
  sessionStorage,
  document: win.document,
  console,
  Date: FakeDate,
  setTimeout,
  clearTimeout,
  setInterval: (fn) => { intervals.push(fn); return intervals.length; },
  clearInterval: () => {}
});

vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'src/main-world/mse-hook.js'), 'utf8'),
  context,
  { filename: 'mse-hook.js' }
);
const notify = () => {
  fakeNow += 200;
  for (const fn of msgListeners) fn({ source: win, data: { channel: 'ynv:content', type: 'STATE_CHANGED' } });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ms = new MockMediaSource();
const blobUrl = win.URL.createObjectURL(ms);
videoEl.src = blobUrl;
const audioSb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
const videoSb = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
assert.equal(videoSb.mime.startsWith('video/'), true);
ok('hook installs on MediaSource.addSourceBuffer without throwing');

setState({ enabled: false, deep: true, fallback: false });
notify();
videoSb.appendBuffer(new ArrayBuffer(100));
assert.equal(videoSb.nativeAppends.length, 1);
ok('extension off -> video segments pass through natively');

setState({ enabled: true, deep: true, fallback: false });
notify();
videoSb.appendBuffer(new ArrayBuffer(200));
assert.equal(videoSb.nativeAppends.length, 1, 'video segment must be dropped');
audioSb.appendBuffer(new ArrayBuffer(50));
assert.equal(audioSb.nativeAppends.length, 1, 'audio segment must still be appended');
await sleep(220);
assert.ok(videoSb._events.includes('updateend'), 'must emit updateend so the player keeps scheduling');
ok('L1+L2 on -> video dropped, audio intact, updateend paced');

assert.equal(videoEl.buffered, audioSb._buffered);
assert.equal(videoSb.buffered, audioSb._buffered);
assert.equal(videoEl.readyState, 4);
assert.equal(videoEl.videoWidth, 1280);
ok('buffer health / readyState / dimensions are kept truthful to audio track');

videoSb._events.length = 0;
videoSb.appendBuffer(new ArrayBuffer(210));
setState({ enabled: true, deep: false, fallback: false });
notify();
await sleep(220);
assert.ok(videoSb._events.includes('updateend'), 'queued append must complete across a state flip');
ok('state flipped mid-append -> updateend still delivered, player never hangs');

videoSb.appendBuffer(new ArrayBuffer(300));
assert.equal(videoSb.nativeAppends.length, 2, 'native append resumes when L2 is off');
assert.equal(videoEl.buffered, videoEl._buffered, 'native getter restored');
ok('L2 off (L1 only) -> hot restore, no reload needed');

setState({ enabled: true, deep: true, fallback: false });
notify();
const tick = intervals[0];
assert.equal(typeof tick, 'function');
tick();
fakeNow += 7000;
for (let i = 0; i < 5; i++) { fakeNow += 1000; tick(); }
assert.equal(getState().fallback, true);
assert.equal(getState().deep, false);
assert.ok(posted.some((m) => m.type === 'FALLBACK' && m.reason === 'stalled-4s'));
videoSb.appendBuffer(new ArrayBuffer(400));
assert.equal(videoSb.nativeAppends.length, 3, 'auto-fallback must restore native append immediately');
ok('stall detection -> auto fallback to L1 only, playback path restored');

setState({ enabled: true, deep: true, fallback: false });
notify();
videoEl.seeking = true;
tick();
fakeNow += 7000;
for (let i = 0; i < 5; i++) { fakeNow += 1000; tick(); }
assert.equal(getState().fallback, true);
assert.ok(posted.some((m) => m.type === 'FALLBACK' && m.reason === 'stuck-seeking'));
videoEl.seeking = false;
ok('stuck seeking -> auto fallback instead of hanging forever');

console.log('\n[4] Overlay lifecycle (mocked DOM)');

class MockEl {
  constructor(tag, parent = null) {
    this.tagName = tag.toUpperCase();
    this.parentElement = parent;
    this.attrs = {};
    this._classes = new Set();
    this._inPlayer = true;
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c)
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  closest() { return this._inPlayer ? this : null; }
  querySelectorAll() { return []; }
}

class MockMutationObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}

const hostEl = new MockEl('div');
const videoElement = new MockEl('video', hostEl);
const mockDoc = {
  documentElement: hostEl,
  querySelectorAll(sel) {
    if (sel === 'video') return [videoElement];
    if (sel === 'video[data-ynv]') return videoElement.hasAttribute('data-ynv') ? [videoElement] : [];
    if (sel === '[data-ynv-host]') return hostEl.hasAttribute('data-ynv-host') ? [hostEl] : [];
    return [];
  },
  addEventListener() {},
  dispatchEvent() { return true; }
};

let computedPosition = 'absolute';
const mockWin = {
  sessionStorage: { getItem: () => null, setItem: () => {} },
  postMessage: () => {},
  getComputedStyle: () => ({ position: computedPosition }),
  setInterval: () => 1,
  clearInterval: () => {},
  addEventListener: () => {}
};

let controllerListener = null;
let storageListener = null;
let savedLang = null;
const mockChrome = {
  runtime: {
    onMessage: { addListener: (fn) => { controllerListener = fn; } },
    sendMessage: (_msg, cb) => { if (cb) cb(); },
    lastError: undefined
  },
  storage: {
    local: {
      get: (_key, cb) => { if (cb) cb({ 'ynv.lang': savedLang }); },
      set: (obj) => { savedLang = obj['ynv.lang']; }
    },
    onChanged: { addListener: (fn) => { storageListener = fn; } }
  }
};

const controllerCtx = vm.createContext({
  window: mockWin,
  document: mockDoc,
  chrome: mockChrome,
  YNV_LOCALES: LOCALES,
  MutationObserver: MockMutationObserver,
  Date,
  console
});
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'src/content/controller.js'), 'utf8'),
  controllerCtx,
  { filename: 'controller.js' }
);
const callController = (msg) => new Promise((resolve) => controllerListener(msg, {}, resolve));

assert.equal(typeof controllerListener, 'function');
assert.equal(videoElement.hasAttribute('data-ynv'), false);
ok('controller loads with overlay idle when extension is off');

await callController({ type: 'YNV_SET_STATE', enabled: true });
assert.equal(videoElement.hasAttribute('data-ynv'), true);
assert.equal(hostEl.hasAttribute('data-ynv-host'), true);
assert.equal(hostEl._classes.has('ynv-relative'), false);
ok('enabled -> video hidden and player host marked for the hint');

assert.equal(hostEl.attrs['data-ynv-title'], LOCALES.en.hintTitle);
assert.equal(hostEl.attrs['data-ynv-sub'], LOCALES.en.hintSub);
ok('default hint text is English and comes from the locale pack');

await callController({ type: 'YNV_SET_STATE', enabled: false });
assert.equal(videoElement.hasAttribute('data-ynv'), false);
assert.equal(hostEl.hasAttribute('data-ynv-host'), false);
ok('disabled -> hint removed, no ghost overlay');

computedPosition = 'static';
await callController({ type: 'YNV_SET_STATE', enabled: true });
assert.equal(hostEl._classes.has('ynv-relative'), true);
ok('statically positioned host gets a positioning fallback');

videoElement._inPlayer = false;
await callController({ type: 'YNV_SET_STATE', enabled: false });
await callController({ type: 'YNV_SET_STATE', enabled: true });
assert.equal(videoElement.hasAttribute('data-ynv'), true);
assert.equal(hostEl.hasAttribute('data-ynv-host'), false);
ok('hover-preview videos never spawn a second hint');

videoElement._inPlayer = true;
await callController({ type: 'YNV_SET_STATE', enabled: false });
await callController({ type: 'YNV_SET_STATE', enabled: true });
assert.equal(hostEl.attrs['data-ynv-sub'], LOCALES.en.hintSub);
assert.equal(typeof storageListener, 'function');
storageListener({ 'ynv.lang': { newValue: 'zh-CN' } }, 'local');
assert.equal(hostEl.attrs['data-ynv-title'], LOCALES['zh-CN'].hintTitle);
assert.equal(hostEl.attrs['data-ynv-sub'], LOCALES['zh-CN'].hintSub);
ok('switching to Chinese updates the player hint live, no reload needed');

console.log(`\nAll ${results.length} checks passed.\n`);
