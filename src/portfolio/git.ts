import { execFile } from 'child_process';

export interface Commit {
  hash: string;
  author: string;
  date: string;
  subject: string;
  workItemIds: number[];
}

export interface GitInfo {
  branch?: string;
  commits: Commit[];
  dirtyFiles: number;
}

const GIT_TIMEOUT_MS = 8000;
const FIELD_SEP = '\x1f';

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

/** Branch, últimos commits (só os que tocam a pasta do projeto) e arquivos modificados. */
export async function getGitInfo(projectPath: string, limit = 10): Promise<GitInfo> {
  const [branch, log, status] = await Promise.all([
    git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(projectPath, ['log', '-n', String(limit), `--pretty=format:%h${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`, '--', '.']),
    git(projectPath, ['status', '--porcelain', '--', '.']),
  ]);
  return {
    branch: branch.trim() || undefined,
    commits: parseLog(log),
    dirtyFiles: status.split('\n').filter((l) => l.trim()).length,
  };
}

export function parseLog(log: string): Commit[] {
  return log.split('\n').filter((l) => l.trim()).map((line) => {
    const [hash, author, date, subject = ''] = line.split(FIELD_SEP);
    return { hash, author, date, subject, workItemIds: extractWorkItemIds(subject) };
  });
}

/** Referências a work items no padrão do Azure Boards: AB#1234. */
export function extractWorkItemIds(text: string): number[] {
  const ids = [...text.matchAll(/AB#(\d+)/gi)].map((m) => Number(m[1]));
  return [...new Set(ids)];
}

/** Diff (staged + não staged) do projeto, para revisão. */
export async function getWorkingDiff(projectPath: string, maxChars = 60000): Promise<string> {
  const diff = await git(projectPath, ['diff', 'HEAD', '--', '.']);
  return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n\n[diff truncado em ${maxChars} caracteres]` : diff;
}
