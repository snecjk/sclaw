#!/usr/bin/env node
/**
 * md-to-html converter
 * Usage: node convert.mjs <input.md> [--theme <id>] [--output <path>] [--title <text>] [--toc] [--dark]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = resolve(__dirname, '..', 'themes');

// --- Parse CLI args ---
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
md-to-html — Convert Markdown to styled HTML

Usage:
  node convert.mjs <input.md> [options]

Options:
  --theme <id>     Theme: github | notion | magazine | terminal | minimal (default: github)
  --output <path>  Output file path (default: <input>.html)
  --title <text>   Page title (default: filename)
  --toc            Generate table of contents
  --dark           Force dark mode
  --list-themes    Show available themes

Examples:
  node convert.mjs README.md
  node convert.mjs notes.md --theme notion --toc
  node convert.mjs article.md --theme magazine --title "Monthly Report"
  node convert.mjs changelog.md --theme terminal --dark
`);
  process.exit(0);
}

if (args.includes('--list-themes')) {
  console.log('Available themes:\n');
  console.log('  github    — Clean GitHub-flavored rendering');
  console.log('  notion    — Notion-like minimal elegant typography');
  console.log('  magazine  — Editorial magazine layout with serif fonts');
  console.log('  terminal  — Dark hacker/terminal aesthetic');
  console.log('  minimal   — Ultra-clean Swiss-style minimalism');
  process.exit(0);
}

function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

const inputPath = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') === false) || args[0];
const theme = getArg('--theme') || 'github';
const outputPath = getArg('--output') || inputPath.replace(extname(inputPath), '.html');
const title = getArg('--title') || basename(inputPath, extname(inputPath));
const toc = args.includes('--toc');
const dark = args.includes('--dark');

// --- Validate input ---
if (!existsSync(inputPath)) {
  console.error(`Error: File not found: ${inputPath}`);
  process.exit(1);
}

const themeFile = resolve(THEMES_DIR, `${theme}.css`);
if (!existsSync(themeFile)) {
  console.error(`Error: Theme not found: ${theme}`);
  console.error(`Available: github, notion, magazine, terminal, minimal`);
  process.exit(1);
}

// --- Dynamic import marked + highlight.js ---
let marked, hljs;
try {
  marked = await import('marked');
  if (marked.marked) marked = marked.marked;
} catch {
  console.error('Error: "marked" package not found. Install with: npm i marked');
  process.exit(1);
}

try {
  hljs = (await import('highlight.js')).default;
} catch {
  console.error('Error: "highlight.js" package not found. Install with: npm i highlight.js');
  process.exit(1);
}

// --- Configure marked ---
marked.setOptions({
  gfm: true,
  breaks: false,
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang }).value; } catch {}
    }
    return hljs.highlightAuto(code).value;
  },
});

// --- Read inputs ---
const mdContent = readFileSync(inputPath, 'utf-8');
const themeCSS = readFileSync(themeFile, 'utf-8');

// --- Generate HTML body ---
let htmlBody = marked.parse(mdContent);

// --- TOC generation ---
let tocHTML = '';
if (toc) {
  const headings = [];
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/g;
  let match;
  let idx = 0;
  while ((match = headingRegex.exec(htmlBody)) !== null) {
    const level = parseInt(match[1]);
    const text = match[2].replace(/<[^>]+>/g, '');
    const id = `heading-${idx++}`;
    headings.push({ level, text, id });
    htmlBody = htmlBody.replace(match[0], match[0].replace(`<h${level}`, `<h${level} id="${id}"`));
  }

  if (headings.length > 0) {
    const minLevel = Math.min(...headings.map(h => h.level));
    tocHTML = '<nav class="toc"><p class="toc-title">Table of Contents</p><ul>';
    for (const h of headings) {
      const indent = h.level - minLevel;
      tocHTML += `<li style="margin-left:${indent * 1.2}em"><a href="#${h.id}">${h.text}</a></li>`;
    }
    tocHTML += '</ul></nav><hr>';
  }
}

// --- Highlight.js inline CSS (github-dark style, compact) ---
const hljsCSS = `
.hljs{color:var(--fg);background:transparent}
.hljs-comment,.hljs-quote{color:var(--fg-secondary);font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-type{color:#c678dd}
.hljs-string,.hljs-template-variable,.hljs-addition{color:#98c379}
.hljs-number,.hljs-literal{color:#d19a66}
.hljs-title,.hljs-section{color:#e5c07b}
.hljs-name,.hljs-selector-id,.hljs-selector-class{color:#e06c75}
.hljs-attribute,.hljs-variable,.hljs-template-tag{color:#d19a66}
.hljs-regexp,.hljs-link{color:#56b6c2}
.hljs-symbol,.hljs-bullet{color:#c678dd}
.hljs-meta{color:#61aeee}
.hljs-deletion{color:#e06c75}
`;

// --- TOC CSS ---
const tocCSS = `
.toc{margin-bottom:24px;padding:16px 20px;background:var(--code-bg);border-radius:6px;font-size:0.9em}
.toc-title{font-weight:700;margin-bottom:8px;font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em;color:var(--fg-secondary)}
.toc ul{list-style:none;padding-left:0;margin:0}
.toc li{padding:2px 0}
.toc a{color:var(--link);text-decoration:none}
.toc a:hover{text-decoration:underline}
`;

// --- Assemble final HTML ---
const html = `<!DOCTYPE html>
<html lang="en"${dark ? ' class="dark"' : ''}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${themeCSS}
${hljsCSS}
${tocCSS}
  </style>
</head>
<body>
${tocHTML}
${htmlBody}
</body>
</html>`;

writeFileSync(outputPath, html, 'utf-8');
console.log(`OK ${outputPath} (${theme} theme, ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
