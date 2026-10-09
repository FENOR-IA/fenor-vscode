import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { extractWorkItemIds } from '../portfolio/git';

/** "O que eu fiz" no período: meus commits, sessões salvas e work items citados, por projeto. */

export interface ProjectActivity {
  projeto: string;
  commits: Array<{ hash: string; data: string; assunto: string }>;
  sessoes: string[];
  workItems: number[];
}

const GIT_TIMEOUT_MS = 8000;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

export async function projectActivity(projectPath: string, projectName: string, from: Date, to: Date): Promise<ProjectActivity> {
  const email = (await git(projectPath, ['config', 'user.email'])).trim();
  const log = email
    ? await git(projectPath, ['log', `--author=${email}`, `--since=${from.toISOString()}`, `--until=${to.toISOString()}`, '--pretty=format:%h\x1f%aI\x1f%s', '--', '.'])
    : '';
  const commits = log.split('\n').filter((l) => l.trim()).map((l) => {
    const [hash, data, assunto = ''] = l.split('\x1f');
    return { hash, data, assunto };
  });
  return {
    projeto: projectName,
    commits,
    sessoes: await sessionsBetween(projectPath, from, to),
    workItems: [...new Set(commits.flatMap((c) => extractWorkItemIds(c.assunto)))],
  };
}

/** Sessões salvas (memory/sessions/AAAA-MM-DD-*.md) dentro do período, pelo nome do arquivo. */
async function sessionsBetween(projectPath: string, from: Date, to: Date): Promise<string[]> {
  const entries = await fs.readdir(path.join(projectPath, 'memory', 'sessions')).catch(() => [] as string[]);
  const start = from.toISOString().slice(0, 10);
  const end = to.toISOString().slice(0, 10);
  return entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(f) && f.slice(0, 10) >= start && f.slice(0, 10) <= end)
    .sort()
    .map((f) => f.replace(/\.md$/, ''));
}

export function hasActivity(a: ProjectActivity): boolean {
  return a.commits.length > 0 || a.sessoes.length > 0;
}
