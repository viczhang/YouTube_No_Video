/*
 * Translations for YouTube No Video.
 *
 * To add a language:
 *   1. Copy the `en` block below and change the key to a locale code (e.g. `fr`).
 *   2. Set _name to the language name written in that language.
 *   3. Translate every other value. Keep the key set identical to `en`.
 *
 * Nothing else needs editing: the popup picker lists these keys automatically,
 * and tests/smoke.mjs fails the build if any translation is missing a key.
 */
globalThis.YNV_LOCALES = {
  en: {
    _name: 'English',
    scope: 'Applies to the current tab only',
    langLabel: 'Language',
    toggleTitle: 'Audio only',
    toggleDesc: 'Stop rendering the video, keep the sound playing',
    deepTitle: 'Deep power saving',
    deepDesc: 'Also block video decoding and downloads (L2)',
    noteActive: 'L1 + L2 active: video rendering and decoding are stopped.',
    noteL1: 'L1 active: the picture is hidden, but video still decodes in the background.',
    noteFallback: 'Deep power saving hit an issue and was turned off automatically. Audio keeps playing.',
    retry: 'Retry deep power saving',
    errTab: 'Open this extension on a YouTube tab.',
    errPreview: 'Preview mode: use this inside the Chrome extension.',
    footer: 'Changes apply instantly — no reload, no interruption to the audio.',
    hintTitle: 'YouTube No Video.',
    hintSub: "To play the video, go to the extension on your browser's toolbar."
  },
  'zh-CN': {
    _name: '简体中文',
    scope: '仅对当前标签页生效',
    langLabel: '界面语言',
    toggleTitle: '仅音频播放',
    toggleDesc: '停止画面渲染，声音继续播放',
    deepTitle: '深度省电',
    deepDesc: '同时阻断视频解码与下载 (L2)',
    noteActive: 'L1 + L2 运行中：画面与视频解码均已停止。',
    noteL1: 'L1 运行中：画面已隐藏，视频仍在后台解码。',
    noteFallback: '深度省电出现异常，已自动关闭。音频保持正常。',
    retry: '重试深度省电',
    errTab: '请在一个 YouTube 标签页中打开本扩展。',
    errPreview: '预览模式：请在 Chrome 扩展中使用。',
    footer: '切换即时生效，无需刷新，音乐不中断',
    hintTitle: 'YouTube No Video.',
    hintSub: '要播放视频，请点击浏览器工具栏中的扩展程序。'
  }
};
