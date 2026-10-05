import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Integração com CLIs de agentes (Claude Code, Codex) — sem dependência do vscode, para teste. */

export type CliId = 'claude' | 'codex';

const KNOWN_LOCATIONS: Record<CliId, string[]> = {
  claude: ['~/.local/bin/claude', '~/.claude/local/claude', '/usr/local/bin/claude', '/opt/homebrew/bin/claude'],
  codex: ['~/.local/bin/codex', '/usr/local/bin/codex', '/opt/homebrew/bin/codex', '~/.npm-global/bin/codex'],
};

// Só leitura: o agente pode consultar o código, mas não editar nem rodar comandos.
const CLAUDE_READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

export function claudeArgs(systemPrompt: string): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--append-system-prompt', systemPrompt,
    '--allowedTools', ...CLAUDE_READ_ONLY_TOOLS,
  ];
}

export function codexArgs(cwd: string): string[] {
  // Sandbox padrão do `codex exec` é só leitura; "-" lê o prompt do stdin.
  return ['exec', '--skip-git-repo-check', '--ephemeral', '-C', cwd, '-'];
}

export interface ClaudeEvent {
  text?: string;
  error?: string;
}

/** Interpreta uma linha do `claude -p --output-format stream-json`. */
export function parseClaudeLine(line: string): ClaudeEvent {
  let event: { type?: string; message?: { content?: Array<{ type: string; text?: string }> }; is_error?: boolean; result?: string; subtype?: string };
  try {
    event = JSON.parse(line);
  } catch {
    return {};
  }
  if (event.type === 'assistant') {
    const text = (event.message?.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('');
    return text ? { text } : {};
  }
  if (event.type === 'result' && event.is_error) {
    return { error: event.result || `Claude Code terminou com erro (${event.subtype ?? 'desconhecido'})` };
  }
  return {};
}

export function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Caminho executável do CLI: configuração do usuário, PATH ou locais de instalação conhecidos. */
export async function findCli(id: CliId, configured?: string): Promise<string | undefined> {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exe = process.platform === 'win32' ? [`${id}.cmd`, `${id}.exe`, id] : [id];
  const candidates = [
    ...(configured ? [expandHome(configured)] : []),
    ...pathDirs.flatMap((d) => exe.map((e) => path.join(d, e))),
    ...KNOWN_LOCATIONS[id].map(expandHome),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, process.platform === 'win32' ? undefined : fs.constants.X_OK);
      return candidate;
    } catch {
      // tenta o próximo
    }
  }
  return undefined;
}

export interface RunOptions {
  cwd: string;
  stdin: string;
  onStdoutLine?: (line: string) => void;
  onStdout?: (chunk: string) => void;
  signal?: AbortSignal;
  timeoutMs: number;
}

/** Executa o CLI com o prompt no stdin; resolve com o stderr para diagnóstico. */
export function runCli(command: string, args: string[], opts: RunOptions): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, NO_COLOR: '1' }, shell: process.platform === 'win32' });
    let stderr = '';
    let buffer = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
    const abort = () => child.kill('SIGTERM');
    opts.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      opts.onStdout?.(chunk);
      if (opts.onStdoutLine) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.filter((l) => l.trim()).forEach((l) => opts.onStdoutLine?.(l));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      if (buffer.trim()) {
        opts.onStdoutLine?.(buffer);
      }
      resolve({ code: code ?? -1, stderr });
    });
    child.stdin.end(opts.stdin);
  });
}
