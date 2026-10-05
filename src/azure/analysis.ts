import { WorkItem } from './client';

export type AlertKind = 'sem-criterio' | 'sem-responsavel' | 'parado' | 'grande';

export interface Alert {
  kind: AlertKind;
  workItemId: number;
  message: string;
}

export interface MemberLoad {
  member: string;
  open: number;
  remainingWork: number;
  points: number;
}

export type StateBucket = 'todo' | 'doing' | 'done';

const STORY_TYPES = new Set(['User Story', 'Product Backlog Item', 'Feature', 'História', 'Requirement']);
const DONE_STATES = new Set(['done', 'closed', 'resolved', 'removed', 'concluído', 'concluido', 'fechado', 'resolvido']);
const TODO_STATES = new Set(['new', 'to do', 'proposed', 'approved', 'novo', 'a fazer', 'design']);
const BIG_STORY_POINTS = 8;
const BIG_REMAINING_HOURS = 16;
const DAY_MS = 24 * 60 * 60 * 1000;

export function bucketOf(state: string): StateBucket {
  const s = state.trim().toLowerCase();
  if (DONE_STATES.has(s)) {
    return 'done';
  }
  return TODO_STATES.has(s) ? 'todo' : 'doing';
}

/** Alertas determinísticos do sprint — não dependem de IA. */
export function analyzeSprint(items: readonly WorkItem[], now: Date, staleDays: number): Alert[] {
  return items
    .filter((item) => bucketOf(item.state) !== 'done')
    .flatMap((item) => alertsFor(item, now, staleDays));
}

function alertsFor(item: WorkItem, now: Date, staleDays: number): Alert[] {
  const alerts: Alert[] = [];
  if (STORY_TYPES.has(item.type) && !item.acceptanceCriteria) {
    alerts.push({ kind: 'sem-criterio', workItemId: item.id, message: 'História sem critério de aceite' });
  }
  if (!item.assignedTo) {
    alerts.push({ kind: 'sem-responsavel', workItemId: item.id, message: 'Sem responsável' });
  }
  const changed = Date.parse(item.changedDate);
  if (Number.isFinite(changed)) {
    const days = Math.floor((now.getTime() - changed) / DAY_MS);
    if (days >= staleDays) {
      alerts.push({ kind: 'parado', workItemId: item.id, message: `Sem movimento há ${days} dias` });
    }
  }
  if ((item.storyPoints ?? 0) > BIG_STORY_POINTS || (item.remainingWork ?? 0) > BIG_REMAINING_HOURS) {
    alerts.push({ kind: 'grande', workItemId: item.id, message: 'Grande demais — avaliar quebrar' });
  }
  return alerts;
}

/** Carga por pessoa nos itens ainda abertos. */
export function loadByMember(items: readonly WorkItem[]): MemberLoad[] {
  const map = new Map<string, MemberLoad>();
  for (const item of items) {
    if (bucketOf(item.state) === 'done') {
      continue;
    }
    const member = item.assignedTo ?? '(sem responsável)';
    const prev = map.get(member) ?? { member, open: 0, remainingWork: 0, points: 0 };
    map.set(member, {
      member,
      open: prev.open + 1,
      remainingWork: prev.remainingWork + (item.remainingWork ?? 0),
      points: prev.points + (item.storyPoints ?? 0),
    });
  }
  return [...map.values()].sort((a, b) => b.open - a.open);
}

export function countByBucket(items: readonly WorkItem[]): Record<StateBucket, number> {
  return items.reduce(
    (acc, item) => ({ ...acc, [bucketOf(item.state)]: acc[bucketOf(item.state)] + 1 }),
    { todo: 0, doing: 0, done: 0 } as Record<StateBucket, number>,
  );
}
