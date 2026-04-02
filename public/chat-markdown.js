(function () {
  const BLOCKED_PROTOCOLS = /^(javascript|data):/i;
  const ALLOWED_TAGS = new Set([
    'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3', 'HR',
    'LI', 'OL', 'P', 'PRE', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH',
    'THEAD', 'TR', 'UL', 'INPUT'
  ]);

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function applyInlineMarkdown(text) {
    const escaped = escapeHtml(text);
    const placeholders = [];
    let formatted = escaped.replace(/`([^`]+)`/g, (_, code) => {
      const id = placeholders.push(`<code>${code}</code>`) - 1;
      return `\u0000INLINE_${id}\u0000`;
    });

    formatted = formatted
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
        const safeHref = BLOCKED_PROTOCOLS.test(href) ? '#' : href;
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return formatted.replace(/\u0000INLINE_(\d+)\u0000/g, (_, index) => placeholders[Number(index)] || '');
  }

  function parseTable(lines, start) {
    const headerLine = lines[start];
    const dividerLine = lines[start + 1];
    if (!headerLine || !dividerLine) return null;
    if (!/\|/.test(headerLine) || !/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(dividerLine)) {
      return null;
    }

    const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    const header = splitRow(headerLine);
    const rows = [];
    let index = start + 2;

    while (index < lines.length && /\|/.test(lines[index]) && lines[index].trim() !== '') {
      rows.push(splitRow(lines[index]));
      index += 1;
    }

    return {
      nextIndex: index,
      html: `
        <table>
          <thead><tr>${header.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td>${applyInlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      `
    };
  }

  function parseMarkdown(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      if (/^```/.test(trimmed)) {
        const lang = trimmed.slice(3).trim();
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) {
          codeLines.push(lines[index]);
          index += 1;
        }
        index += 1;
        html.push(`<pre><code${lang ? ` data-language="${escapeHtml(lang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      const table = parseTable(lines, index);
      if (table) {
        html.push(table.html);
        index = table.nextIndex;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        html.push('<hr>');
        index += 1;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        html.push(`<h${headingMatch[1].length}>${applyInlineMarkdown(headingMatch[2])}</h${headingMatch[1].length}>`);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
          index += 1;
        }
        html.push(`<blockquote>${quoteLines.map((entry) => `<p>${applyInlineMarkdown(entry)}</p>`).join('')}</blockquote>`);
        continue;
      }

      const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (orderedMatch || unorderedMatch) {
        const isOrdered = !!orderedMatch;
        const tag = isOrdered ? 'ol' : 'ul';
        const items = [];

        while (index < lines.length) {
          const current = lines[index].trim();
          const ordered = current.match(/^(\d+)\.\s+(.+)$/);
          const unordered = current.match(/^[-*]\s+(.+)$/);
          if (isOrdered ? !ordered : !unordered) break;
          const content = (ordered || unordered)[2] || (ordered || unordered)[1];
          const task = content.match(/^\[( |x|X)\]\s+(.+)$/);
          if (task) {
            const checked = task[1].toLowerCase() === 'x';
            items.push(`<li class="task-list-item"><label><input type="checkbox" disabled ${checked ? 'checked' : ''}><span>${applyInlineMarkdown(task[2])}</span></label></li>`);
          } else {
            items.push(`<li>${applyInlineMarkdown(content)}</li>`);
          }
          index += 1;
        }

        html.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }

      const paragraphLines = [];
      while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index].trim()) && !/^>\s?/.test(lines[index].trim()) && !/^```/.test(lines[index].trim()) && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[index].trim()) && !/^(\d+)\.\s+/.test(lines[index].trim()) && !/^[-*]\s+/.test(lines[index].trim())) {
        if (parseTable(lines, index)) break;
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      html.push(`<p>${applyInlineMarkdown(paragraphLines.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }

    return html.join('');
  }

  function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const nodes = template.content.querySelectorAll('*');

    for (const node of nodes) {
      if (!ALLOWED_TAGS.has(node.tagName)) {
        node.replaceWith(document.createTextNode(node.textContent || ''));
        continue;
      }

      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        const isSafeLinkAttr = node.tagName === 'A' && (name === 'href' || name === 'target' || name === 'rel');
        const isSafeInputAttr = node.tagName === 'INPUT' && (name === 'type' || name === 'disabled' || name === 'checked');
        const isSafeCodeAttr = node.tagName === 'CODE' && name === 'data-language';
        const isSafeClass = name === 'class';
        if (!(isSafeLinkAttr || isSafeInputAttr || isSafeCodeAttr || isSafeClass)) {
          node.removeAttribute(attr.name);
        }
        if (node.tagName === 'A' && name === 'href' && BLOCKED_PROTOCOLS.test(value)) {
          node.setAttribute('href', '#');
        }
      }
    }

    return template.innerHTML;
  }

  function enhanceCodeBlocks(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const codeBlocks = template.content.querySelectorAll('pre');

    codeBlocks.forEach((pre) => {
      const code = pre.querySelector('code');
      if (code) {
        code.innerHTML = highlightCodeSyntax(code.textContent || '');
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block';

      const actions = document.createElement('div');
      actions.className = 'code-block__actions';

      const language = code ? (code.getAttribute('data-language') || '').trim() : '';
      if (language) {
        const badge = document.createElement('span');
        badge.className = 'code-block__lang';
        badge.textContent = language;
        actions.appendChild(badge);
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code-btn';
      button.textContent = '复制代码';
      button.setAttribute('data-copy-code', code ? code.textContent || '' : pre.textContent || '');

      actions.appendChild(button);
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(actions);
      wrapper.appendChild(pre);
    });

    return template.innerHTML;
  }

  function highlightCodeSyntax(codeText) {
    const escaped = escapeHtml(codeText || '');
    return escaped
      .replace(/(\/\/.*$)/gm, '<span class="token token--comment">$1</span>')
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="token token--string">$1</span>')
      .replace(/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|async|await|try|catch|throw)\b/g, '<span class="token token--keyword">$1</span>');
  }

  function buildMentionFragment(text) {
    const fragment = document.createDocumentFragment();
    const regex = /(@@?[^\s@，。！？、,:：；;]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text))) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const span = document.createElement('span');
      const token = match[0];
      span.className = token.startsWith('@@') ? 'mention mention--invoke' : 'mention';
      span.textContent = token;
      fragment.appendChild(span);
      lastIndex = match.index + token.length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    return fragment;
  }

  function enhanceMentions(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentTag = node.parentElement && node.parentElement.tagName;
        if (!node.nodeValue || !/@@?/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (parentTag && ['CODE', 'PRE', 'A', 'SCRIPT', 'STYLE'].includes(parentTag)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      node.replaceWith(buildMentionFragment(node.nodeValue));
    });

    return template.innerHTML;
  }

  function renderMarkdownHtml(text, options = {}) {
    try {
      const parsed = parseMarkdown(text);
      const sanitized = sanitizeHtml(parsed);
      const withCodeBlocks = enhanceCodeBlocks(sanitized);
      return options.enableMentions === false ? withCodeBlocks : enhanceMentions(withCodeBlocks);
    } catch (error) {
      return `<p>${escapeHtml(String(text || '')).replace(/\n/g, '<br>')}</p>`;
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target && event.target.closest ? event.target.closest('.copy-code-btn') : null;
    if (!button) return;
    const text = button.getAttribute('data-copy-code') || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      button.classList.add('is-copied');
      button.textContent = '已复制';
      window.setTimeout(() => {
        button.classList.remove('is-copied');
        button.textContent = '复制代码';
      }, 1200);
    } catch (error) {
      button.textContent = '复制失败';
      window.setTimeout(() => {
        button.textContent = '复制代码';
      }, 1200);
    }
  });

  window.ChatMarkdown = {
    escapeHtml,
    renderMarkdownHtml
  };
})();
