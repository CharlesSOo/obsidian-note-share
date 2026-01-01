import { Marked } from 'marked';
import { StoredNote, ThemeSettings, DualThemeSettings } from './types';

const marked = new Marked({
  gfm: true,
  breaks: true,
});

// Pre-compiled regex patterns for better performance
const CALLOUT_REGEX = /^> \[!(\w+)\]([+-]?)[ ]*(.*)?$\n((?:^>.*$\n?)*)/gm;
const HIGHLIGHT_REGEX = /==([^=]+)==/g;
const TAG_REGEX = /(?<!\S)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
const CHECKBOX_CHECKED_REGEX = /^(\s*)- \[x\]/gm;
const CHECKBOX_UNCHECKED_REGEX = /^(\s*)- \[ \]/gm;
const INTERNAL_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Default themes
const DEFAULT_DARK: ThemeSettings = {
  backgroundPrimary: '#1e1e1e',
  backgroundSecondary: '#262626',
  textNormal: '#dcddde',
  textMuted: '#999',
  textAccent: '#7c3aed',
  interactiveAccent: '#7c3aed',
  codeBackground: '#2d2d2d',
  fontSize: 16,
};

const DEFAULT_LIGHT: ThemeSettings = {
  backgroundPrimary: '#ffffff',
  backgroundSecondary: '#f5f5f5',
  textNormal: '#1e1e1e',
  textMuted: '#666666',
  textAccent: '#7c3aed',
  interactiveAccent: '#7c3aed',
  codeBackground: '#f0f0f0',
  fontSize: 16,
};

export function renderNote(note: StoredNote, theme: DualThemeSettings | undefined, baseUrl: string): string {
  // Get light and dark themes with fallbacks
  const dark = theme?.dark || DEFAULT_DARK;
  const light = theme?.light || DEFAULT_LIGHT;

  // Pre-process Obsidian-specific syntax
  let content = note.content;
  content = processCallouts(content);
  content = processHighlights(content);
  content = processTags(content);
  content = processCheckboxes(content);
  content = processInternalLinks(content, baseUrl, note.linkedNotes);

  // Parse markdown and add lazy loading to images
  const html = (marked.parse(content) as string)
    .replace(/<img /g, '<img loading="lazy" ');

  // Pre-compute theme vars (used multiple times in CSS)
  const darkVars = generateThemeVars(dark, true);
  const lightVars = generateThemeVars(light, false);
  const styles = generateStylesWithVars(darkVars, lightVars);

  // Generate description from processed content (strip HTML tags and normalize whitespace)
  const description = html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(note.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <title>${escapeHtml(note.title)}</title>
  <style>${styles}</style>
</head>
<body>
  <button id="theme-toggle" aria-label="Toggle theme">
    <span class="sun">☀️</span><span class="moon">🌙</span>
  </button>
  <div class="markdown-preview-view markdown-rendered">
    <div class="markdown-preview-sizer markdown-preview-section">
      <div class="inline-title">${escapeHtml(note.title)}</div>
      ${html}
    </div>
  </div>
  <script>
    // Theme toggle - cycles: system -> opposite -> system
    const toggle = document.getElementById('theme-toggle');
    const root = document.documentElement;
    toggle.onclick = () => {
      const hasLight = root.classList.contains('force-light');
      const hasDark = root.classList.contains('force-dark');

      // Remove any existing override
      root.classList.remove('force-light', 'force-dark');

      // If no override was set, apply opposite of system preference
      if (!hasLight && !hasDark) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(prefersDark ? 'force-light' : 'force-dark');
      }
      // Otherwise, we just removed the override (back to system)
    };

    // Interactive callout folding
    document.querySelectorAll('.callout[data-callout-fold]').forEach(c => {
      const title = c.querySelector('.callout-title');
      const content = c.querySelector('.callout-content');
      if (title && content) {
        title.style.cursor = 'pointer';
        title.onclick = () => {
          content.style.display = content.style.display === 'none' ? 'block' : 'none';
        };
      }
    });
  </script>
</body>
</html>`;
}

function processCallouts(content: string): string {
  // Reset regex lastIndex for global patterns
  CALLOUT_REGEX.lastIndex = 0;

  return content.replace(CALLOUT_REGEX, (match, type, fold, title, body) => {
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
  HIGHLIGHT_REGEX.lastIndex = 0;
  return content.replace(HIGHLIGHT_REGEX, '<mark>$1</mark>');
}

function processTags(content: string): string {
  TAG_REGEX.lastIndex = 0;
  return content.replace(TAG_REGEX, '<span class="tag">#$1</span>');
}

function processCheckboxes(content: string): string {
  CHECKBOX_CHECKED_REGEX.lastIndex = 0;
  CHECKBOX_UNCHECKED_REGEX.lastIndex = 0;
  content = content.replace(CHECKBOX_CHECKED_REGEX, '$1- <input type="checkbox" checked disabled>');
  content = content.replace(CHECKBOX_UNCHECKED_REGEX, '$1- <input type="checkbox" disabled>');
  return content;
}

function processInternalLinks(
  content: string,
  baseUrl: string,
  linkedNotes: { titleSlug: string; hash: string }[]
): string {
  // Build O(1) lookup map from slugs to hashes
  const linkMap = new Map(linkedNotes.map(n => [n.titleSlug, n.hash]));

  INTERNAL_LINK_REGEX.lastIndex = 0;
  return content.replace(INTERNAL_LINK_REGEX, (match, link, display) => {
    const slug = link.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const text = display || link;
    const hash = linkMap.get(slug);

    if (hash) {
      return `<a href="${baseUrl}/${slug}/${hash}" class="internal-link">${escapeHtml(text)}</a>`;
    }
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

function generateThemeVars(t: ThemeSettings, isDark: boolean): string {
  return `
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
      --font-text-size: ${t.fontSize}px;`;
}

function generateStylesWithVars(darkVars: string, lightVars: string): string {
  return `
    :root {
      --font-text: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-monospace: 'SF Mono', 'Fira Code', 'Monaco', 'Menlo', monospace;
      --line-height: 1.6;
      /* Default to dark theme */
      ${darkVars}
    }

    @media (prefers-color-scheme: light) {
      :root {
        ${lightVars}
      }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        ${darkVars}
      }
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

    /* Theme toggle button */
    #theme-toggle {
      position: fixed;
      top: 12px;
      right: 12px;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 16px;
      z-index: 100;
      opacity: 0.7;
      transition: opacity 0.2s;
    }
    #theme-toggle:hover { opacity: 1; }
    #theme-toggle .sun { display: none; }
    #theme-toggle .moon { display: inline; }
    @media (prefers-color-scheme: light) {
      #theme-toggle .sun { display: inline; }
      #theme-toggle .moon { display: none; }
    }

    /* Manual theme override classes */
    html.force-light {
      ${lightVars}
    }
    html.force-light #theme-toggle .sun { display: inline; }
    html.force-light #theme-toggle .moon { display: none; }

    html.force-dark {
      ${darkVars}
    }
    html.force-dark #theme-toggle .sun { display: none; }
    html.force-dark #theme-toggle .moon { display: inline; }

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
