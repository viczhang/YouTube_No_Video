(() => {
  'use strict';

  const ON_COLOR = '#1EA97A';
  const SIZES = [16, 32, 48, 128];
  const icons = (suffix) => Object.fromEntries(
    SIZES.map((n) => [String(n), `icons/icon${n}${suffix}.png`])
  );
  const ICON_ON = icons('-on');
  const ICON_OFF = icons('');

  function paint(tabId, enabled) {
    if (typeof tabId !== 'number') return;
    try {
      chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: ON_COLOR });
      chrome.action.setIcon({ tabId, path: enabled ? ICON_ON : ICON_OFF });
    } catch (_) {}
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.type === 'YNV_STATE' && msg.state) {
      paint(sender.tab && sender.tab.id, !!msg.state.enabled);
    }
  });

  // MV3 action state is not persisted across service-worker restarts: re-read
  // the tab's state whenever it becomes active so the indicator cannot go stale.
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'YNV_GET_STATE' });
      paint(tabId, !!(res && res.state && res.state.enabled));
    } catch (_) {
      paint(tabId, false);
    }
  });
})();
