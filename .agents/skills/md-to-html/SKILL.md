---
name: md-to-html
description: 'Convert Markdown content or files to beautifully styled, self-contained HTML with multiple switchable themes. Trigger on "md to html", "markdown to html", "convert markdown", "render markdown as html", "MD转HTML", "Markdown转网页", or any request to turn markdown/text content into a styled HTML page. Supports GitHub, Notion, Magazine, Terminal, and Minimal themes. Outputs a single standalone .html file with embedded CSS — no external dependencies.'
metadata:
  tags: markdown, html, converter, themes, md-to-html, rendering, typography
---

# md-to-html — Markdown to Styled HTML

Convert any Markdown content into a self-contained, beautifully styled HTML file.

## When to use

- User asks to convert Markdown (.md) to HTML
- User provides Markdown text and wants it rendered as a web page
- User wants to preview Markdown as styled HTML
- Keywords: "md to html", "markdown转html", "render markdown", "markdown to webpage"

## Available Themes

| Theme ID    | Style                                      | Best for                          |
|-------------|--------------------------------------------|-----------------------------------|
| `github`    | Clean GitHub-flavored rendering            | README, docs, technical content   |
| `notion`    | Notion-like minimal elegant typography     | Notes, wikis, personal docs       |
| `magazine`  | Editorial magazine layout with serif fonts | Articles, blog posts, reports     |
| `terminal`  | Dark hacker/terminal aesthetic             | Tech blogs, changelogs, dev docs  |
| `minimal`   | Ultra-clean Swiss-style minimalism         | Any content, print-friendly       |

## Workflow

1. **Get the Markdown content** — read from a file path, or accept inline text from the user
2. **Pick a theme** — use the user's requested theme, or default to `github`. List available themes if asked.
3. **Run the conversion script**:
   ```bash
   node .agents/skills/md-to-html/scripts/convert.mjs <input.md> --theme <theme-id> --output <output.html>
   ```
   Or if content is provided inline, write it to a temp file first, then convert.
4. **Tell the user** the output path and how to open it.

## Options

| Flag             | Description                                | Default        |
|------------------|--------------------------------------------|----------------|
| `--theme <id>`   | Theme to use (see table above)             | `github`       |
| `--output <path>`| Output HTML file path                      | `<input>.html` |
| `--title <text>` | Page `<title>` and visible header          | from filename  |
| `--toc`          | Generate table of contents from headings   | off            |
| `--dark`         | Force dark mode (themes that support it)   | auto           |

## Examples

```bash
# Basic conversion
node .agents/skills/md-to-html/scripts/convert.mjs README.md

# Notion theme with TOC
node .agents/skills/md-to-html/scripts/convert.mjs notes.md --theme notion --toc

# Magazine theme, custom title
node .agents/skills/md-to-html/scripts/convert.mjs article.md --theme magazine --title "Monthly Report"

# Terminal dark theme
node .agents/skills/md-to-html/scripts/convert.mjs changelog.md --theme terminal --dark
```

## Inline content flow

When the user pastes Markdown text directly in chat (not a file):
1. Write the text to a temp `.md` file in the current directory
2. Run the convert script on it
3. Report the output path

## Notes

- Output is a **single self-contained HTML file** — all CSS is embedded, no external requests
- Code blocks get syntax highlighting (highlight.js embedded)
- Tables, images, blockquotes, task lists all render correctly
- The script depends on `marked` and `highlight.js` — install once: `npm i marked highlight.js`
