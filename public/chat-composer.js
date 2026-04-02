(function () {
  let inputEl = null;
  let previewEl = null;
  let previewBodyEl = null;
  let statusEl = null;
  let drawerEl = null;
  let drawerBackdropEl = null;
  let mode = 'edit';
  let debounceTimer = null;
  let syncingScroll = false;

  function isMobileViewport() {
    return window.matchMedia('(max-width: 960px)').matches;
  }

  function syncPreviewFromInputScroll() {
    if (!inputEl || !previewBodyEl || syncingScroll) return;
    if (isMobileViewport()) return;
    const inputScrollable = inputEl.scrollHeight - inputEl.clientHeight;
    const previewScrollable = previewBodyEl.scrollHeight - previewBodyEl.clientHeight;
    if (inputScrollable <= 0 || previewScrollable <= 0) return;
    syncingScroll = true;
    const ratio = inputEl.scrollTop / inputScrollable;
    previewBodyEl.scrollTop = ratio * previewScrollable;
    syncingScroll = false;
  }

  function syncInputFromPreviewScroll() {
    if (!inputEl || !previewBodyEl || syncingScroll) return;
    if (isMobileViewport()) return;
    const inputScrollable = inputEl.scrollHeight - inputEl.clientHeight;
    const previewScrollable = previewBodyEl.scrollHeight - previewBodyEl.clientHeight;
    if (inputScrollable <= 0 || previewScrollable <= 0) return;
    syncingScroll = true;
    const ratio = previewBodyEl.scrollTop / previewScrollable;
    inputEl.scrollTop = ratio * inputScrollable;
    syncingScroll = false;
  }

  function syncComposerScroll() {
    if (!inputEl || !previewEl) return;
    if (isMobileViewport()) return;
    const inputScrollable = inputEl.scrollHeight - inputEl.clientHeight;
    const previewScrollable = previewEl.scrollHeight - previewEl.clientHeight;
    if (inputScrollable <= 0 || previewScrollable <= 0) return;
    const ratio = inputEl.scrollTop / inputScrollable;
    previewEl.scrollTop = ratio * previewScrollable;
  }

  function updatePanels() {
    document.querySelectorAll('.composer-mobile-tabs__tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.tab === mode);
    });
    document.querySelectorAll('[data-composer-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.composerPanel === mode);
    });
  }

  function openMobileComposerDrawer() {
    if (!inputEl) return;
    if (!isMobileViewport()) {
      inputEl.focus();
      return;
    }
    mode = 'edit';
    updatePanels();
    if (typeof window.closeMobileControlHub === 'function') {
      window.closeMobileControlHub();
    }
    if (drawerBackdropEl) {
      drawerBackdropEl.style.display = 'flex';
      drawerBackdropEl.classList.add('is-open');
    }
    if (drawerEl) drawerEl.classList.add('is-mobile-drawer-open');
    document.body.classList.add('composer-drawer-open');
    document.querySelectorAll('.mobile-composer-trigger, .mobile-composer-triggerbar').forEach((trigger) => {
      trigger.classList.add('is-hidden');
    });
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    window.requestAnimationFrame(() => {
      if (!inputEl) return;
      inputEl.focus({ preventScroll: true });
      const cursor = inputEl.value.length;
      inputEl.setSelectionRange(cursor, cursor);
    });
  }

  function closeMobileComposerDrawer(event) {
    if (event && drawerBackdropEl && event.target !== drawerBackdropEl) return;
    if (drawerBackdropEl) {
      drawerBackdropEl.classList.remove('is-open');
      drawerBackdropEl.style.display = 'none';
    }
    if (drawerEl) drawerEl.classList.remove('is-mobile-drawer-open');
    document.body.classList.remove('composer-drawer-open');
    document.querySelectorAll('.mobile-composer-trigger, .mobile-composer-triggerbar').forEach((trigger) => {
      trigger.classList.remove('is-hidden');
    });
  }

  function syncViewportState() {
    if (!isMobileViewport()) {
      closeMobileComposerDrawer();
    }
  }

  function renderEmpty() {
    if (!previewBodyEl) return;
    previewBodyEl.innerHTML = '<div class="composer-preview__empty">Markdown 预览会显示在这里</div>';
  }

  function updatePreviewStatus() {
    if (!inputEl || !statusEl) return;
    const raw = inputEl.value;
    const lineCount = raw ? raw.split('\n').length : 0;
    const charCount = raw.length;
    statusEl.textContent = `${lineCount} 行 · ${charCount} 字符`;
  }

  function refreshPreview() {
    if (!previewBodyEl || !inputEl) return;
    const value = inputEl.value.trim();
    updatePreviewStatus();
    if (!value) {
      renderEmpty();
      return;
    }
    previewBodyEl.innerHTML = window.ChatMarkdown.renderMarkdownHtml(inputEl.value, {
      role: 'user',
      forPreview: true,
      enableMentions: true
    });
  }

  function scheduleRefresh() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      refreshPreview();
      syncPreviewFromInputScroll();
    }, 100);
  }

  function wrapSelection(prefix, suffix = prefix, placeholder = '') {
    if (!inputEl) return;
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? inputEl.value.length;
    const selected = inputEl.value.slice(start, end) || placeholder;
    inputEl.setRangeText(`${prefix}${selected}${suffix}`, start, end, 'end');
    const cursorStart = start + prefix.length;
    const cursorEnd = cursorStart + selected.length;
    inputEl.focus();
    inputEl.setSelectionRange(cursorStart, cursorEnd);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function prefixCurrentLine(prefix) {
    if (!inputEl) return;
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const lineStart = inputEl.value.lastIndexOf('\n', start - 1) + 1;
    inputEl.setRangeText(prefix, lineStart, lineStart, 'end');
    const cursor = start + prefix.length;
    inputEl.focus();
    inputEl.setSelectionRange(cursor, cursor);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function replaceCurrentLinePrefix(prefixPattern, nextPrefix) {
    if (!inputEl) return;
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const lineStart = inputEl.value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIndex = inputEl.value.indexOf('\n', start);
    const lineEnd = lineEndIndex === -1 ? inputEl.value.length : lineEndIndex;
    const lineText = inputEl.value.slice(lineStart, lineEnd);
    const updated = lineText.replace(prefixPattern, '');
    inputEl.setRangeText(`${nextPrefix}${updated}`, lineStart, lineEnd, 'end');
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertByAction(action) {
    switch (action) {
      case 'bold':
        wrapSelection('**', '**', '粗体');
        break;
      case 'italic':
        wrapSelection('*', '*', '斜体');
        break;
      case 'inline-code':
        wrapSelection('`', '`', 'code');
        break;
      case 'code-block':
        wrapSelection('```\n', '\n```', 'code');
        break;
      case 'link':
        wrapSelection('[', '](https://)', '链接文本');
        break;
      case 'list':
        prefixCurrentLine('- ');
        break;
      case 'ordered-list':
        replaceCurrentLinePrefix(/^([-*]\s+|>\s+|\d+\.\s+)/, '1. ');
        break;
      case 'blockquote':
        prefixCurrentLine('> ');
        break;
      default:
        break;
    }
  }

  function bindToolbar() {
    document.querySelectorAll('[data-md-action]').forEach((button) => {
      button.addEventListener('click', () => insertByAction(button.dataset.mdAction));
    });
  }

  function bindTabs() {
    document.querySelectorAll('.composer-mobile-tabs__tab').forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.tab || 'edit';
        updatePanels();
        if (mode === 'preview') refreshPreview();
      });
    });
  }

  function initComposer(options) {
    inputEl = options.input;
    previewEl = options.preview;
    previewBodyEl = document.getElementById('composerPreviewBody') || previewEl;
    statusEl = document.getElementById('composerPreviewStatus');
    drawerEl = document.getElementById('mobileComposerDrawer');
    drawerBackdropEl = document.getElementById('mobileComposerDrawerBackdrop');
    if (!inputEl || !previewEl) return;
    bindToolbar();
    bindTabs();
    inputEl.addEventListener('input', scheduleRefresh);
    inputEl.addEventListener('scroll', syncComposerScroll);
    inputEl.addEventListener('scroll', syncPreviewFromInputScroll);
    previewBodyEl.addEventListener('scroll', syncInputFromPreviewScroll);
    window.addEventListener('resize', syncViewportState);
    renderEmpty();
    updatePreviewStatus();
    updatePanels();
  }

  window.ChatComposer = {
    initComposer,
    refreshPreview,
    openMobileComposerDrawer,
    closeMobileComposerDrawer
  };
  window.openMobileComposerDrawer = openMobileComposerDrawer;
  window.closeMobileComposerDrawer = closeMobileComposerDrawer;
})();
