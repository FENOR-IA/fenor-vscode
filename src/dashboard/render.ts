import { Alert, analyzeSprint, bucketOf, countByBucket, loadByMember, StateBucket } from '../azure/analysis';
import { WorkItem } from '../azure/client';
import { ACTIVITY_LABEL, idleLabel, ProjectFull, situationOf } from '../portfolio/situation';

export interface DashboardData {
  projects: ProjectFull[];
  board: { status: string; sprintName?: string; items: WorkItem[]; error?: string };
  staleDays: number;
  now: Date;
}

const BUCKETS: Array<[StateBucket, string]> = [['todo', 'A fazer'], ['doing', 'Em andamento'], ['done', 'Concluído']];
const STACK_LABEL: Record<string, string> = { java: 'Java', react: 'React' };
const MAX_COMMITS = 25;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Corpo do painel (sem <html>/<head>) — função pura para facilitar teste. */
export function renderDashboardBody(data: DashboardData): string {
  const items = data.board.items;
  const alerts = analyzeSprint(items, data.now, data.staleDays);
  const counts = countByBucket(items);
  const totalTests = data.projects.reduce((sum, p) => sum + p.testCount, 0);
  const progress = items.length ? Math.round((counts.done / items.length) * 100) : 0;
  const active = data.projects.filter((p) => situationOf(p, data.now).activity === 'ativo').length;

  return `
  <header class="top">
    <div>
      <p class="eyebrow">Fenor</p>
      <h1>${escapeHtml(data.board.sprintName ?? 'Painel do workspace')}</h1>
    </div>
    <div class="actions">
      <button class="primary" data-action="ai-situacao">Situação com IA</button>
      <button data-action="report">Relatório de situação</button>
      <button data-action="usage">Uso</button>
      <button data-action="refresh">Atualizar</button>
      ${data.board.status === 'desconectado' ? '<button class="primary" data-action="connect">Conectar Azure DevOps</button>' : ''}
    </div>
  </header>

  <section class="kpis">
    ${kpi('Projetos', data.projects.length, stackSummary(data.projects))}
    ${kpi('Ativos', active, `${data.projects.length - active} morno(s) ou parado(s)`)}
    ${kpi('Arquivos de teste', totalTests, `${data.projects.filter((p) => p.testCount === 0).length} projeto(s) sem teste`)}
    ${kpi('Sprint concluído', items.length ? `${progress}%` : '—', items.length ? `${counts.done} de ${items.length} itens` : boardHint(data.board))}
    ${kpi('Alertas', alerts.length, alerts.length ? 'itens pedindo atenção' : 'nada pendente', alerts.length ? 'warn' : '')}
  </section>

  <section class="grid">
    <div class="panel wide">
      <h2>Sprint</h2>
      ${items.length ? kanban(items, alerts) : `<p class="empty">${escapeHtml(boardHint(data.board))}</p>`}
    </div>
    <div class="stack">
      <div class="panel">
        <h2>Alertas</h2>
        ${alertList(alerts, items)}
      </div>
      <div class="panel">
        <h2>Carga do time</h2>
        ${teamLoad(items)}
      </div>
    </div>
  </section>

  <section class="grid">
    <div class="panel wide">
      <h2>Projetos</h2>
      ${projectTable(data.projects, data.now)}
    </div>
    <div class="panel">
      <h2>Commits recentes</h2>
      ${commitList(data.projects, items)}
    </div>
  </section>`;
}

function kpi(label: string, value: unknown, hint: string, tone = ''): string {
  return `<div class="kpi ${tone}"><span class="kpi-value">${escapeHtml(value)}</span><span class="kpi-label">${escapeHtml(label)}</span><span class="kpi-hint">${escapeHtml(hint)}</span></div>`;
}

function boardHint(board: DashboardData['board']): string {
  if (board.status === 'desconectado') {
    return 'Azure DevOps não conectado.';
  }
  if (board.status === 'erro') {
    return board.error ?? 'Erro ao carregar o board.';
  }
  return board.status === 'carregando' ? 'Carregando…' : 'Nenhum item no sprint.';
}

function stackSummary(projects: DashboardData['projects']): string {
  const counts = projects.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.stack]: (acc[p.stack] ?? 0) + 1 }), {});
  return Object.entries(counts).map(([s, n]) => `${n} ${STACK_LABEL[s] ?? s}`).join(' · ') || 'nenhum encontrado';
}

function kanban(items: WorkItem[], alerts: Alert[]): string {
  const flagged = new Set(alerts.map((a) => a.workItemId));
  return `<div class="kanban">${BUCKETS.map(([bucket, label]) => {
    const col = items.filter((w) => bucketOf(w.state) === bucket);
    return `<div class="col"><h3>${label} <span>${col.length}</span></h3>${col.map((w) => card(w, flagged.has(w.id))).join('')}</div>`;
  }).join('')}</div>`;
}

function card(w: WorkItem, flagged: boolean): string {
  return `<a class="card ${flagged ? 'flagged' : ''}" href="#" data-action="open" data-url="${escapeHtml(w.url)}">
    <span class="card-meta">${escapeHtml(w.type)} ${w.id}${w.storyPoints != null ? ` · ${w.storyPoints} pts` : ''}</span>
    <span class="card-title">${escapeHtml(w.title)}</span>
    <span class="card-who">${escapeHtml(w.assignedTo ?? 'sem responsável')}</span>
  </a>`;
}

function alertList(alerts: Alert[], items: WorkItem[]): string {
  if (!alerts.length) {
    return '<p class="empty">Sem alertas.</p>';
  }
  return `<ul class="list">${alerts.slice(0, 15).map((a) => {
    const item = items.find((w) => w.id === a.workItemId);
    return `<li><a href="#" data-action="open" data-url="${escapeHtml(item?.url ?? '')}">#${a.workItemId}</a> ${escapeHtml(a.message)}</li>`;
  }).join('')}</ul>`;
}

function teamLoad(items: WorkItem[]): string {
  const load = loadByMember(items);
  if (!load.length) {
    return '<p class="empty">Sem itens abertos.</p>';
  }
  const max = Math.max(...load.map((m) => m.open));
  return `<ul class="bars">${load.map((m) => `<li>
    <span class="bar-label">${escapeHtml(m.member)}</span>
    <span class="bar"><span data-pct="${Math.round((m.open / max) * 100)}"></span></span>
    <span class="bar-value">${m.open}${m.remainingWork ? ` · ${m.remainingWork}h` : ''}</span>
  </li>`).join('')}</ul>`;
}

function projectTable(projects: DashboardData['projects'], now: Date): string {
  if (!projects.length) {
    return '<p class="empty">Nenhum projeto encontrado nesta pasta.</p>';
  }
  const rows = projects.map((p, i) => ({ p, i, s: situationOf(p, now) }))
    .sort((a, b) => (a.s.daysIdle ?? 9999) - (b.s.daysIdle ?? 9999));
  return `<table><thead><tr><th>Projeto</th><th>Stack</th><th>Situação</th><th>Checklist</th><th>Testes</th><th>Último commit</th></tr></thead><tbody>
  ${rows.map(({ p, i, s }) => `<tr>
    <td><a href="#" data-action="project" data-index="${i}">${escapeHtml(p.name)}</a><small>${escapeHtml(p.description ?? p.docs.summary ?? p.relPath)}</small></td>
    <td><span class="tag ${p.stack}">${escapeHtml(STACK_LABEL[p.stack])}</span><small>${escapeHtml([p.framework, p.runtime].filter(Boolean).join(' · '))}</small></td>
    <td><span class="status ${s.activity}">${ACTIVITY_LABEL[s.activity]}</span><small>${escapeHtml(idleLabel(s))}${s.flags.length ? ` · ${escapeHtml(s.flags.join(' · '))}` : ''}</small></td>
    <td>${s.progress !== undefined ? `${s.progress}%<small>${p.docs.checklistOpen} abertos</small>` : '—'}</td>
    <td class="${!p.testCount ? 'warn-text' : ''}">${p.testCount}</td>
    <td>${p.git.commits[0] ? `${escapeHtml(p.git.commits[0].subject)}<small>${escapeHtml(p.git.commits[0].date.slice(0, 10))} · ${escapeHtml(p.git.branch ?? '')}</small>` : '—'}</td>
  </tr>`).join('')}
  </tbody></table>`;
}

function commitList(projects: DashboardData['projects'], items: WorkItem[]): string {
  const commits = projects
    .flatMap((p) => p.git.commits.map((c) => ({ ...c, project: p.name })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((c, i, arr) => arr.findIndex((o) => o.hash === c.hash) === i)
    .slice(0, MAX_COMMITS);
  if (!commits.length) {
    return '<p class="empty">Sem commits.</p>';
  }
  return `<ul class="list commits">${commits.map((c) => `<li>
    <span class="commit-subject">${escapeHtml(c.subject)}</span>
    <small>${escapeHtml(c.project)} · ${escapeHtml(c.author)} · ${escapeHtml(c.date.slice(0, 10))}${c.workItemIds.map((id) => {
      const w = items.find((i) => i.id === id);
      return w ? ` · <a href="#" data-action="open" data-url="${escapeHtml(w.url)}">AB#${id}</a>` : ` · AB#${id}`;
    }).join('')}</small>
  </li>`).join('')}</ul>`;
}
