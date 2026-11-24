# YouTube No Video

A Chrome extension for using YouTube as a background music player. When you switch it on, the picture disappears and video frames stop being decoded, while the soundtrack keeps playing — saving CPU, GPU work and battery on a laptop.

It is a Manifest V3 extension, active only on `youtube.com`, `www.youtube-nocookie.com` and `m.youtube.com`. The interface is in English by default, with Simplified Chinese available from the language picker.

## Features

- **Audio only.** The video picture is hidden without changing the player's layout, so the controls, progress bar and mini-player behaviour keep working.
- **Deep power saving.** Video segments are intercepted before they reach the browser's media pipeline, so no video decoder is created and no frames are rendered. Audio segments are left untouched.
- **Automatic fallback.** If deep power saving causes a media error, a four-second stall or a stuck seek, it turns itself off and falls back to picture-hiding only. The audio never stops. You can retry it from the popup.
- **Per-tab control.** The switch applies only to the current tab. Other YouTube tabs are unaffected. The state survives reloads and in-site navigation, and is discarded when the tab closes.
- **Instant switching.** Turning it on or off takes effect immediately — no reload and no interruption to the audio.
- **On-screen hint.** While active, the player area shows "YouTube No Video." and a short line telling you how to restore the picture.
- **Automatic shut-off.** When the video really ends, the extension turns itself off: the hint disappears, the picture path is restored and the toolbar indicator clears.
- **Toolbar indicator.** An active tab shows a green `ON` badge and a green icon. Switching tab re-checks its state, so the indicator is never stale.
- **Idle guard.** The "Still there?" dialog is dismissed automatically and a light activity heartbeat is sent, so long listening sessions are not paused.
- **Easy to translate.** All text lives in one file. Adding a language needs no changes to the popup, the content script or the tests.

## Install from source

1. Clone this repository or download it as a ZIP and unpack it.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this project folder.
5. Refresh any YouTube tabs that were already open — content scripts are injected at page load.
6. Click the extension icon in the toolbar and turn on **Audio only**.

Requires Chrome 111 or newer, because the deep power saving layer runs in the `MAIN` world. There is no build step, no package manager and no npm install.

After changing any file, click the reload button for this extension on `chrome://extensions`, then refresh the YouTube tab. A change to `manifest.json` is a structural change and always needs the extension reload.

## Usage

Open the popup from the toolbar:

- **Audio only** — the main switch for this tab.
- **Deep power saving** — turn it off to keep only the picture-hiding layer (L1). If the extension detected a problem, this switch is off and a **Retry deep power saving** button appears.
- **Language** — English or Simplified Chinese. The choice is global; all open YouTube tabs update their text immediately. The playback switch stays per-tab.
- The status line tells you whether L1 + L2, L1 only, or the automatic fallback is active.

When playback finishes, the extension waits two seconds before switching off. This grace period lets a playlist or autoplay move on to the next track without dropping out of audio-only mode; a `play` event during that window cancels the shut-off. Turning the switch back on at any time restores everything instantly. After turning it off, the picture returns when the next video segment arrives, usually within a few seconds.

## How it works

Two content scripts are injected at `document_start`:

- `src/main-world/mse-hook.js` runs in the **MAIN** world, where YouTube's player lives. It wraps `MediaSource.addSourceBuffer` (and `ManagedMediaSource`) and drops every `appendBuffer` call on `video/*` buffers, including the initialization segment, so the video track is never established. `update` / `updateend` are still dispatched on a short queue so the player keeps scheduling. `buffered`, `readyState` and video dimensions are kept truthful from the audio track. A one-second monitor watches for errors and stalls and triggers the fallback.
- `src/content/controller.js` (with `strings.js` and `no-video.css`) runs in the **ISOLATED** world. It marks the video element for hiding, marks the player container for the text hint, follows new elements created by YouTube's single-page navigation, dismisses idle dialogs, and listens for `ended` to shut the extension off. It hides the picture with opacity and visibility only — the element's geometry is deliberately untouched, because YouTube measures the video box and uses visibility checks to drive the mini-player and autoplay.

The playback state is stored in the tab's `sessionStorage` under `ynv.state`. The MAIN world reads it directly, so no handshake is needed; a `postMessage` invalidates its cache whenever the state changes. The language preference is stored globally in `chrome.storage.local` under `ynv.lang`.

`src/background/service-worker.js` owns the toolbar indicator. Chrome's action API is only available in an extension context, so the worker sets the badge and icon for the sender's tab whenever the state changes. Because MV3 does not persist action state across service worker restarts, the worker also re-queries a tab when it becomes active.

## Development and tests

```
node tests/smoke.mjs
```

The suite runs 23 checks with no dependencies: JavaScript syntax, manifest and asset integrity, translation completeness, the full MSE hook path in a mocked browser, the hint overlay lifecycle, automatic shut-off, and the service worker badge logic. A missing or empty translation key makes the suite fail and names the key.

Project layout:

- `manifest.json` — MV3 config, YouTube-only matches, dual-world injection, service worker.
- `src/main-world/mse-hook.js` — L2 video-segment blocking, health monitor, fallback.
- `src/content/controller.js`, `src/content/no-video.css` — L1 hiding, hint, idle guard, auto-off.
- `src/i18n/strings.js` — the only file containing UI text.
- `src/popup/` — popup markup, logic and styles.
- `src/background/service-worker.js` — toolbar badge and icon.
- `icons/` — four sizes, plus `-on` variants for the active state.
- `tests/smoke.mjs` — the test suite.

## Adding a language

1. Open `src/i18n/strings.js`.
2. Copy the whole `en` block and change its key to a locale code such as `fr`.
3. Set `_name` to the language's name written in that language.
4. Translate every other value, keeping the key set exactly identical to `en`.

The language picker is generated from the locale keys automatically, and the text shown over the player is injected from the same pack. Nothing else needs editing. `node tests/smoke.mjs` verifies that every language has all 15 keys and that none is empty.

## Known limitations

- Deep power saving relies on YouTube's current MSE/DASH behavior. A YouTube redesign could break it; the built-in monitor then falls back to picture-hiding, and the audio keeps playing. Turning deep power saving off in the popup is a permanent L1-only mode.
- Video segments are dropped after they reach the page, so bandwidth is not saved — the saving is in decoding, rendering, CPU and GPU work.
- After switching off, the picture returns only when the next video segment is appended.
- Tab state is not shared between `youtube.com` subdomains.
- Idle dialog detection matches visible text and may need updating after a YouTube copy change.
- A buffering gap longer than two seconds between an ad and the next video may be read as the end of playback and switch the extension off.
- Only tested on Chrome; Firefox and Safari are not supported.

## Permissions and privacy

The extension requests the `storage` permission solely to remember the language preference, plus host access to the three YouTube domains listed above. It sends no analytics, loads no remote code, does not read browsing history on other sites, and stores playback state only in the tab's own `sessionStorage`.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Victor Zhang.
