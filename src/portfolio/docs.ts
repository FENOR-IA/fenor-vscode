import { promises as fs } from 'fs';
import * as path from 'path';

export interface DocFile {
  relPath: string;
  modified: string;
}

export interface PendingItem {
  text: string;
  file: string;
}

export interface DocsInfo {
  files: DocFile[];
  summary?: string;
  checklistOpen: number;
  checklistDone: number;
  pending: PendingItem[];
  lastUpdate?: string;
}

const IGNORED_DIRS = new Set(['node_modules', 'vendor', 'target', 'build', 'dist', 'out', '.git', '.idea', '.vscode', 'coverage', 'var', 'storage']);
// Pastas de histórico: muitas e velhas, poluem a leitura de pendências.
const HISTORY_DIRS = new Set(['sessions', 'log', 'logs', 'archive', 'arquivo', 'historico']);
const MAX_DEPTH = 3;
const MAX_FILES = 80;
const MAX_FILE_BYTES = 200_000;
const MAX_PENDING = 10;
const PRIORITY_DOCS = ['README.md', 'CLAUDE.md', 'AGENTS.md', 'memory/plan.md', 'memory/spec.md', 'memory/INDEX.md', 'DECISIONS.md'];
const PENDING_HEADING = /^#{1,6}\s+.*(pend[eê]n|todo|a fazer|pr[oó]xim|next|backlog|falta|aberto)/i;
const BOILERPLATE = /provides guidance to claude|this file provides|^>|^<!--|^\|/i;

export async function collectDocs(projectPath: string): Promise<DocsInfo> {
  const files = await findMarkdown(projectPath);
  const ordered = [...files].sort((a, b) => rank(a.relPath) - rank(b.relPath) || b.modified.localeCompare(a.modified));
  const contents = await Promise.all(ordered.map(async (f) => ({ file: f, text: await readLimited(path.join(projectPath, f.relPath)) })));

  let open = 0;
  let done = 0;
  const pending: PendingItem[] = [];
  for (const { file, text } of contents) {
    const parsed = parseMarkdown(text);
    open += parsed.open.length;
    done += parsed.done;
    pending.push(...[...parsed.open, ...parsed.underPendingHeading].map((t) => ({ text: t, file: file.relPath })));
  }

  const summaryDoc = contents.find((c) => /^(README|CLAUDE|AGENTS)\.md$/i.test(c.file.relPath) && firstParagraph(c.text));
  return {
    files: ordered,
    summary: summaryDoc ? firstParagraph(summaryDoc.text) : undefined,
    checklistOpen: open,
    checklistDone: done,
    pending: dedupe(pending).slice(0, MAX_PENDING),
    lastUpdate: files.map((f) => f.modified).sort().pop(),
  };
}

export interface ParsedMarkdown {
  open: string[];
  done: number;
  underPendingHeading: string[];
}

/** Checklists (- [ ] / - [x]) e itens de lista sob títulos de pendência. */
export function parseMarkdown(text: string): ParsedMarkdown {
  const open: string[] = [];
  const underPendingHeading: string[] = [];
  let done = 0;
  let inPendingSection = false;
  let inCode = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      inPendingSection = PENDING_HEADING.test(line);
      continue;
    }
    const check = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (check) {
      if (check[1] === ' ') {
        open.push(cleanItem(check[2]));
      } else {
        done++;
      }
      continue;
    }
    const bullet = /^\s{0,3}(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (inPendingSection && bullet) {
      underPendingHeading.push(cleanItem(bullet[1]));
    }
  }
  return { open: open.filter(Boolean), done, underPendingHeading: underPendingHeading.filter(Boolean) };
}

/** Primeiro parágrafo de texto corrido (ignora títulos, tabelas, citações e o cabeçalho padrão do CLAUDE.md). */
export function firstParagraph(text: string): string | undefined {
  const paragraphs = text.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/);
  for (const p of paragraphs) {
    const lines = p.split('\n').map((l) => l.trim()).filter((l) => l && !/^#/.test(l) && !/^[-*]\s|^\d+\./.test(l));
    const joined = lines.join(' ').trim();
    if (joined.length >= 30 && !BOILERPLATE.test(joined)) {
      return truncate(joined.replace(/\*\*|`/g, ''), 280);
    }
  }
  return undefined;
}

async function findMarkdown(root: string): Promise<DocFile[]> {
  const found: DocFile[] = [];
  const queue: Array<[string, number]> = [[root, 0]];
  while (queue.length && found.length < MAX_FILES) {
    const [dir, depth] = queue.shift() as [string, number];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !IGNORED_DIRS.has(e.name) && !HISTORY_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.')) {
          queue.push([full, depth + 1]);
        }
      } else if (/\.md$/i.test(e.name) && found.length < MAX_FILES) {
        const stat = await fs.stat(full).catch(() => undefined);
        if (stat) {
          found.push({ relPath: path.relative(root, full).split(path.sep).join('/'), modified: stat.mtime.toISOString() });
        }
      }
    }
  }
  return found;
}

function rank(relPath: string): number {
  const i = PRIORITY_DOCS.findIndex((d) => d.toLowerCase() === relPath.toLowerCase());
  return i === -1 ? PRIORITY_DOCS.length + relPath.split('/').length : i;
}

async function readLimited(file: string): Promise<string> {
  try {
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(MAX_FILE_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_BYTES, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

function cleanItem(text: string): string {
  return truncate(text.replace(/\*\*|`|~~/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim(), 160);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function dedupe(items: PendingItem[]): PendingItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.text.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
