/**
 * remark-gfm for chat / UI markdown.
 *
 * Root cause of “26-29 / 21-23 中间变成删除线”:
 * Models often emit a tilde range `26~29` (U+007E). GFM’s default `singleTilde`
 * treats each `~` as a strikethrough delimiter, so two ranges in one paragraph
 * become `<del>…</del>`. ASCII hyphen `26-29` is never strikethrough.
 *
 * Fix: `singleTilde: false` — only `~~like this~~` is strikethrough.
 * Does NOT rewrite `-` to `～` / `~`, and does NOT change intentional `-`.
 */
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';

const remarkGfmOptions: { singleTilde: boolean } = { singleTilde: false };

/** Drop-in for ReactMarkdown `remarkPlugins={chatRemarkPlugins}`. */
export const chatRemarkPlugins: PluggableList = [[remarkGfm, remarkGfmOptions]];
