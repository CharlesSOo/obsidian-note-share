import { Marked } from 'marked';
import { StoredNote, ThemeSettings } from './types';

const marked = new Marked({
  gfm: true,
  breaks: true,
});

// Default theme (dark) if none provided
const DEFAULT_THEME: ThemeSettings = {
  backgroundPrimary: '#1e1e1e',
  backgroundSecondary: '#262626',
  textNormal: '#dcddde',
  textMuted: '#999',
  textAccent: '#7c3aed',
  interactiveAccent: '#7c3aed',
  codeBackground: '#2d2d2d',
  fontSize: 16,
};

export function renderNote(note: StoredNote, theme: ThemeSettings | null, baseUrl: string): string {
  const t = theme || DEFAULT_THEME;

  // Pre-process Obsidian-specific syntax
  let content = note.content;
  content = processCallouts(content);
  content = processHighlights(content);
  content = processTags(content);
  content = processCheckboxes(content);
  content = processInternalLinks(content, baseUrl, note.linkedNotes);

  const html = marked.parse(content) as string;
  const styles = generateStyles(t);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(note.title)}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="markdown-preview-view markdown-rendered">
    <div class="markdown-preview-sizer markdown-preview-section">
      <div class="inline-title">${escapeHtml(note.title)}</div>
      ${html}
    </div>
  </div>
</body>
</html>`;
}

function processCallouts(content: string): string {
  const calloutRegex = /^> \[!(\w+)\]([+-]?)[ ]*(.*)?$\n((?:^>.*$\n?)*)/gm;

  return content.replace(calloutRegex, (match, type, fold, title, body) => {
    const calloutType = type.toLowerCase();
    const calloutTitle = title?.trim() || type.charAt(0).toUpperCase() + type.slice(1);
    const calloutBody = body
      .split('\n')
      .map((line: string) => line.replace(/^> ?/, ''))
      .join('\n')
      .trim();

    const foldable = fold === '+' || fold === '-';
    const collapsed = fold === '-';

    return `<div class="callout" data-callout="${calloutType}"${foldable ? ` data-callout-fold="${fold}"` : ''}>
<div class="callout-title">
<div class="callout-icon">${getCalloutIcon(calloutType)}</div>
<div class="callout-title-inner">${escapeHtml(calloutTitle)}</div>
</div>
<div class="callout-content"${collapsed ? ' style="display:none"' : ''}>

${calloutBody}

</div>
</div>`;
  });
}

function getCalloutIcon(type: string): string {
  const icons: Record<string, string> = {
    note: '📝', info: 'ℹ️', tip: '💡', hint: '💡', important: '❗',
    warning: '⚠️', caution: '⚠️', danger: '🔴', error: '❌', bug: '🐛',
    example: '📋', quote: '💬', cite: '💬', success: '✅', check: '✅',
    done: '✅', question: '❓', help: '❓', faq: '❓', abstract: '📄',
    summary: '📄', tldr: '📄', todo: '☑️', failure: '❌', fail: '❌', missing: '❌',
  };
  return icons[type] || '📌';
}

function processHighlights(content: string): string {
  return content.replace(/==([^=]+)==/g, '<mark>$1</mark>');
}

function processTags(content: string): string {
  return content.replace(/(?<!\S)#([a-zA-Z][a-zA-Z0-9_/-]*)/g, '<span class="tag">#$1</span>');
}

function processCheckboxes(content: string): string {
  content = content.replace(/^(\s*)- \[x\]/gm, '$1- <input type="checkbox" checked disabled>');
  content = content.replace(/^(\s*)- \[ \]/gm, '$1- <input type="checkbox" disabled>');
  return content;
}

function processInternalLinks(
  content: string,
  baseUrl: string,
  linkedNotes: { titleSlug: string; hash: string }[]
): string {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, link, display) => {
    const slug = link.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const text = display || link;

    // Find the linked note's hash
    const linkedNote = linkedNotes.find(n => n.titleSlug === slug);
    if (linkedNote) {
      // baseUrl already includes vault: /g/{vault}
      return `<a href="${baseUrl}/${slug}/${linkedNote.hash}" class="internal-link">${escapeHtml(text)}</a>`;
    }
    // If not found in linkedNotes, show as unresolved
    return `<span class="internal-link unresolved">${escapeHtml(text)}</span>`;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateStyles(t: ThemeSettings): string {
  // Determine if theme is dark based on background color
  const isDark = isColorDark(t.backgroundPrimary);

  return `
    :root {
      --background-primary: ${t.backgroundPrimary};
      --background-secondary: ${t.backgroundSecondary};
      --text-normal: ${t.textNormal};
      --text-muted: ${t.textMuted};
      --text-accent: ${t.textAccent};
      --interactive-accent: ${t.interactiveAccent};
      --code-background: ${t.codeBackground};
      --background-modifier-border: ${isDark ? '#404040' : '#e3e3e3'};
      --text-highlight-bg: ${isDark ? 'rgba(255, 208, 0, 0.4)' : 'rgba(255, 208, 0, 0.5)'};
      --tag-background: ${isDark ? 'rgba(124, 58, 237, 0.2)' : 'rgba(124, 58, 237, 0.1)'};
      --tag-color: ${t.textAccent};
      --font-text: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-monospace: 'SF Mono', 'Fira Code', 'Monaco', 'Menlo', monospace;
      --font-text-size: ${t.fontSize}px;
      --line-height: 1.6;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--background-primary);
      color: var(--text-normal);
      font-family: var(--font-text);
      font-size: var(--font-text-size);
      line-height: var(--line-height);
      -webkit-font-smoothing: antialiased;
    }

    .markdown-preview-view {
      max-width: 750px;
      margin: 0 auto;
      padding: 20px 30px 60px;
    }

    .inline-title {
      font-size: 2em;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 1em;
      color: var(--text-normal);
    }

    h1, h2, h3, h4, h5, h6 {
      margin: 1.4em 0 0.5em;
      font-weight: 600;
      line-height: 1.3;
      color: var(--text-normal);
    }
    h1 { font-size: 1.802em; }
    h2 { font-size: 1.602em; }
    h3 { font-size: 1.424em; }
    h4 { font-size: 1.266em; }
    h5 { font-size: 1.125em; }
    h6 { font-size: 1em; color: var(--text-muted); }

    p { margin: 1em 0; }

    a {
      color: var(--text-accent);
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    .internal-link { color: var(--text-accent); }
    .internal-link:hover { text-decoration: underline; }

    code {
      font-family: var(--font-monospace);
      font-size: 0.9em;
      background: var(--code-background);
      padding: 0.15em 0.4em;
      border-radius: 4px;
    }
    pre {
      background: var(--code-background);
      padding: 1em;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code {
      background: none;
      padding: 0;
      font-size: 0.85em;
    }

    blockquote {
      margin: 1em 0;
      padding: 0.5em 0 0.5em 1em;
      border-left: 3px solid var(--interactive-accent);
      color: var(--text-muted);
    }
    blockquote p { margin: 0.5em 0; }

    ul, ol {
      margin: 1em 0;
      padding-left: 1.5em;
    }
    li { margin: 0.25em 0; }
    li > ul, li > ol { margin: 0.25em 0; }

    li:has(input[type="checkbox"]) {
      list-style: none;
      margin-left: -1.5em;
      padding-left: 0;
    }
    input[type="checkbox"] {
      margin-right: 0.5em;
      accent-color: var(--interactive-accent);
      transform: scale(1.1);
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid var(--background-modifier-border);
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: var(--background-secondary);
      font-weight: 600;
    }

    img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
    }

    hr {
      border: none;
      border-top: 1px solid var(--background-modifier-border);
      margin: 2em 0;
    }

    mark {
      background: var(--text-highlight-bg);
      padding: 0.1em 0.2em;
      border-radius: 3px;
    }

    .tag {
      background: var(--tag-background);
      color: var(--tag-color);
      padding: 0.15em 0.5em;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .callout {
      margin: 1em 0;
      padding: 0;
      border-radius: 6px;
      background: var(--background-secondary);
      border-left: 4px solid var(--interactive-accent);
    }
    .callout-title {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      font-weight: 600;
    }
    .callout-icon { font-size: 1.1em; }
    .callout-content {
      padding: 0 12px 12px;
    }
    .callout-content p:first-child { margin-top: 0; }
    .callout-content p:last-child { margin-bottom: 0; }

    .callout[data-callout="note"] { border-left-color: #448aff; }
    .callout[data-callout="info"] { border-left-color: #00b8d4; }
    .callout[data-callout="tip"], .callout[data-callout="hint"] { border-left-color: #00bfa5; }
    .callout[data-callout="warning"], .callout[data-callout="caution"] { border-left-color: #ff9100; }
    .callout[data-callout="danger"], .callout[data-callout="error"] { border-left-color: #ff5252; }
    .callout[data-callout="bug"] { border-left-color: #f50057; }
    .callout[data-callout="example"] { border-left-color: #7c4dff; }
    .callout[data-callout="quote"], .callout[data-callout="cite"] { border-left-color: var(--text-muted); }
    .callout[data-callout="success"], .callout[data-callout="check"], .callout[data-callout="done"] { border-left-color: #00c853; }
    .callout[data-callout="question"], .callout[data-callout="help"], .callout[data-callout="faq"] { border-left-color: #ffab00; }
    .callout[data-callout="abstract"], .callout[data-callout="summary"], .callout[data-callout="tldr"] { border-left-color: #00b8d4; }
    .callout[data-callout="todo"] { border-left-color: #448aff; }
    .callout[data-callout="failure"], .callout[data-callout="fail"], .callout[data-callout="missing"] { border-left-color: #ff5252; }

    @media (max-width: 600px) {
      .markdown-preview-view {
        padding: 15px 20px 40px;
      }
      .inline-title {
        font-size: 1.6em;
      }
    }
  `;
}

// Helper to detect if a color is dark
function isColorDark(color: string): boolean {
  // Parse hex color
  const hex = color.replace('#', '');
  if (hex.length !== 6) return true; // default to dark

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}
