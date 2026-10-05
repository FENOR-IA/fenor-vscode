import { KitStatus } from '../kit/apply';
import { DocsInfo } from './docs';
import { GitInfo } from './git';
import { Project } from './scanner';

export type Activity = 'ativo' | 'morno' | 'parado' | 'sem-dados';

export interface Situation {
  activity: Activity;
  lastActivity?: string;
  daysIdle?: number;
  progress?: number;
  flags: string[];
}

export interface ProjectFull extends Project {
  git: GitInfo;
  docs: DocsInfo;
  kit?: KitStatus;
}

const ACTIVE_DAYS = 14;
const WARM_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const STACKS_WITH_TESTS = new Set(['java', 'react', 'node', 'php', 'python']);

export const ACTIVITY_LABEL: Record<Activity, string> = {
  ativo: 'Ativo',
  morno: 'Morno',
  parado: 'Parado',
  'sem-dados': 'Sem dados',
};

/** Situação do projeto a partir de git + documentação — sem IA. */
export function situationOf(p: ProjectFull, now: Date): Situation {
  const lastCommit = p.git.commits[0]?.date;
  const lastActivity = [lastCommit, p.docs.lastUpdate].filter((d): d is string => Boolean(d)).sort().pop();
  const daysIdle = lastActivity ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastActivity)) / DAY_MS)) : undefined;
  const activity: Activity = daysIdle === undefined ? 'sem-dados'
    : daysIdle <= ACTIVE_DAYS ? 'ativo'
    : daysIdle <= WARM_DAYS ? 'morno'
    : 'parado';
  const total = p.docs.checklistOpen + p.docs.checklistDone;

  const flags: string[] = [];
  if (!p.git.branch) {
    flags.push('sem git');
  }
  if (p.git.dirtyFiles) {
    flags.push(`${p.git.dirtyFiles} arquivo(s) sem commit`);
  }
  if (STACKS_WITH_TESTS.has(p.stack) && p.testCount === 0) {
    flags.push('sem testes');
  }
  if (!p.docs.files.length) {
    flags.push('sem documentação');
  }
  return {
    activity,
    lastActivity,
    daysIdle,
    progress: total ? Math.round((p.docs.checklistDone / total) * 100) : undefined,
    flags,
  };
}

export function idleLabel(s: Situation): string {
  if (s.daysIdle === undefined) {
    return '—';
  }
  return s.daysIdle === 0 ? 'hoje' : s.daysIdle === 1 ? 'ontem' : `há ${s.daysIdle} dias`;
}
