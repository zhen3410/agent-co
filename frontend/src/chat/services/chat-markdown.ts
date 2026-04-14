const BLOCKED_PROTOCOLS = /^(javascript|data):/i;

export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  const placeholders: string[] = [];
  let formatted = escaped.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `<code>${code}</code>`;
    const index = placeholders.push(placeholder) - 1;
    return `\u0000INLINE_${index}\u0000`;
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

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdown(text: string): string {
  const normalizedText = String(text || '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
  const lines = normalizedText.split('\n');
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${applyInlineMarkdown(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${quoteLines.map((entry) => `<p>${applyInlineMarkdown(entry)}</p>`).join('')}</blockquote>`);
      continue;
    }

    if (trimmed.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1].trim())) {
      const headerCells = splitTableRow(trimmed);
      const bodyRows: string[] = [];
      index += 2;

      while (index < lines.length) {
        const current = lines[index].trim();
        if (!current || !current.includes('|')) {
          break;
        }

        const cells = splitTableRow(current);
        bodyRows.push(`<tr>${cells.map((cell) => `<td>${applyInlineMarkdown(cell)}</td>`).join('')}</tr>`);
        index += 1;
      }

      html.push(
        `<table><thead><tr>${headerCells.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>`
      );
      continue;
    }

    const listMatch = trimmed.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const tag = ordered ? 'ol' : 'ul';
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = current.match(ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(`<li>${applyInlineMarkdown(match[1])}</li>`);
        index += 1;
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    html.push(`<p>${applyInlineMarkdown(trimmed).replace(/\n/g, '<br>')}</p>`);
    index += 1;
  }

  return html.join('');
}

export function renderMarkdownHtml(text: string): string {
  const rendered = parseMarkdown(text);
  return rendered || '<p></p>';
}
