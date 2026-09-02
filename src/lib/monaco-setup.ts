/**
 * Configure Monaco to use the local package (no CDN) and Vite workers.
 * monaco-editor@0.56 exports map `monaco-editor/<path>` → `esm/vs/<path>`,
 * so workers must be imported without the `esm/vs/` prefix.
 *
 * Note: since 0.55, TypeScript APIs live on `monaco.typescript`
 * (not `monaco.languages.typescript`).
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

let configured = false;

type MonacoTypescriptApi = NonNullable<(typeof monaco)['typescript']>;

function resolveTypescriptApi(monacoApi: typeof monaco): MonacoTypescriptApi | null {
  const topLevel = monacoApi.typescript;
  if (topLevel?.typescriptDefaults && topLevel.ScriptTarget) return topLevel;

  // Older monaco (<0.55) kept the API under languages.typescript.
  const legacy = (monacoApi.languages as { typescript?: MonacoTypescriptApi } | undefined)?.typescript;
  if (legacy?.typescriptDefaults && legacy.ScriptTarget) return legacy;

  return null;
}

function applyTypescriptDefaults(monacoApi: typeof monaco): void {
  const ts = resolveTypescriptApi(monacoApi);
  if (!ts) {
    console.warn('[monaco-setup] TypeScript language API unavailable; skipping compiler defaults');
    return;
  }

  // 0.56 ScriptTarget enum stops at ES2020 (no ES2022 member).
  const target = ts.ScriptTarget.ES2020 ?? ts.ScriptTarget.ESNext ?? ts.ScriptTarget.Latest;

  const compilerOptions = {
    target,
    allowNonTsExtensions: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    strict: true,
    skipLibCheck: true,
  };

  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
  ts.javascriptDefaults.setCompilerOptions(compilerOptions);

  // Keep JSX/syntax diagnostics; ignore missing module types (user-app deps not fully indexed).
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [
      2307, // Cannot find module '...'
      2686, // Cannot find name 'React' (edge cases with classic JSX)
    ],
  });
  ts.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
}

export function ensureMonacoConfigured(): void {
  if (configured) return;

  (globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker: (_id: string, label: string) => Worker };
  }).MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      if (label === 'json') return new jsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };

  loader.config({ monaco });
  applyTypescriptDefaults(monaco);
  configured = true;
}

export function languageFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.scss') || lower.endsWith('.less')) return 'scss';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
  if (lower.endsWith('.svg')) return 'xml';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  return 'plaintext';
}
