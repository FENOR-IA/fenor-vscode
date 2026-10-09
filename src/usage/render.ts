import { escapeHtml } from '../dashboard/render';
import { ProjectActivity, hasActivity } from './activity';
import { Breakdown, UsageSummary } from './log';
import { fmt, USAGE_DISCLAIMER } from './report';

export interface UsageView {
  periodDays: number;
  from: Date;
  to: Date;
  usage: UsageSummary;
  activity: ProjectActivity[];
}

const PERIODS = [7, 30, 90];

/** Corpo do painel de uso (função pura). Larguras vão em data-pct: o CSP bloqueia style inline. */
export function renderUsageBody(v: UsageView): string {
  const active = v.activity.filter(hasActivity);
  const commits = active.reduce((s, a) => s + a.commits.length, 0);
  const sessoes = active.reduce((s, a) => s + a.sessoes.length, 0);
  const verifTotal = v.usage.verificacoes.ok + v.usage.verificacoes.falha;
  const totalTokens = v.usage.tokensEntrada + v.usage.tokensSaida;
  return `
  <header class="top">
    <div><p class="eyebrow">Fenor</p><h1>Uso e atividade</h1>
      <p class="sub">${escapeHtml(v.from.toLocaleDateString('pt-BR'))} a ${escapeHtml(v.to.toLocaleDateString('pt-BR'))}</p></div>
    <div class="actions">
      <div class="seg" role="group" aria-label="Período">${PERIODS.map((d) => `<button data-action="period" data-days="${d}" class="${d === v.periodDays ? 'on' : ''}" aria-pressed="${d === v.periodDays}">${d} dias</button>`).join('')}</div>
      <button class="primary" data-action="report">Gerar relatório</button>
      <button data-action="csv">Exportar CSV</button>
    </div>
  </header>

  <section class="kpis">
    ${kpi('Tokens (estimados)', fmt(totalTokens), `${fmt(v.usage.tokensEntrada)} entrada · ${fmt(v.usage.tokensSaida)} saída`)}
    ${kpi('Pedidos ao @fenor', fmt(v.usage.pedidosChat), `${fmt(v.usage.chamadasFerramentas)} chamadas de ferramentas`)}
    ${kpi('Verificações', verifTotal ? `${Math.round((v.usage.verificacoes.ok / verifTotal) * 100)}%` : '—', verifTotal ? `${v.usage.verificacoes.ok} aprovadas · ${v.usage.verificacoes.falha} reprovadas` : 'nenhuma no período', v.usage.verificacoes.falha ? 'warn' : '')}
    ${kpi('Meus commits', fmt(commits), `${sessoes} sessão(ões) salva(s) · ${active.length} projeto(s)`)}
  </section>

  <section class="panel">
    <h2>Tokens por dia</h2>
    ${dailyChart(v.usage.porDia)}
  </section>

  <section class="grid3">
    ${breakdownPanel('Por projeto', v.usage.porProjeto)}
    ${breakdownPanel('Por comando', v.usage.porComando)}
    ${breakdownPanel('Por modelo', v.usage.porModelo)}
  </section>

  <section class="panel">
    <h2>O que eu fiz</h2>
    ${active.length ? active.map(activityBlock).join('') : '<p class="empty">Nenhum commit seu nem sessão salva no período.</p>'}
  </section>

  <p class="note">${escapeHtml(USAGE_DISCLAIMER)} <a href="#" data-action="billing">Ver premium requests do Copilot no GitHub</a>.</p>`;
}

function kpi(label: string, value: string, hint: string, tone = ''): string {
  return `<div class="kpi ${tone}"><span class="kpi-value">${escapeHtml(value)}</span><span class="kpi-label">${escapeHtml(label)}</span><span class="kpi-hint">${escapeHtml(hint)}</span></div>`;
}

function dailyChart(days: UsageSummary['porDia']): string {
  const max = Math.max(1, ...days.map((d) => d.tokens));
  if (days.every((d) => d.tokens === 0)) {
    return '<p class="empty">Sem consumo de tokens pelo Fenor no período.</p>';
  }
  const labelEvery = days.length > 31 ? 14 : days.length > 10 ? 5 : 1;
  return `<div class="chart" role="img" aria-label="Tokens por dia">
    ${days.map((d, i) => `<div class="col" title="${escapeHtml(`${d.dia.split('-').reverse().join('/')}: ${fmt(d.tokens)} tokens, ${d.eventos} evento(s)`)}">
      <span class="bar" data-pct="${Math.round((d.tokens / max) * 100)}"></span>
      <span class="tick">${i % labelEvery === 0 ? escapeHtml(d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7)) : ''}</span>
    </div>`).join('')}
  </div>
  <p class="axis">máximo no dia: ${fmt(max)} tokens</p>`;
}

function breakdownPanel(title: string, rows: Breakdown[]): string {
  if (!rows.length) {
    return `<div class="panel"><h2>${escapeHtml(title)}</h2><p class="empty">Sem dados.</p></div>`;
  }
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return `<div class="panel"><h2>${escapeHtml(title)}</h2><table>
    <thead><tr><th>${escapeHtml(title.replace('Por ', ''))}</th><th class="num">Eventos</th><th class="num">Tokens</th></tr></thead>
    <tbody>${rows.slice(0, 10).map((r) => `<tr>
      <td>${escapeHtml(r.chave)}<span class="hbar"><span data-pct="${Math.round((r.tokens / max) * 100)}"></span></span></td>
      <td class="num">${r.eventos}</td><td class="num">${fmt(r.tokens)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function activityBlock(a: ProjectActivity): string {
  return `<div class="act"><h3>${escapeHtml(a.projeto)} <small>${a.commits.length} commit(s)${a.sessoes.length ? ` · ${a.sessoes.length} sessão(ões)` : ''}${a.workItems.length ? ` · ${a.workItems.map((id) => `AB#${id}`).join(', ')}` : ''}</small></h3>
    <ul>${a.commits.slice(0, 12).map((c) => `<li><code>${escapeHtml(c.hash)}</code> ${escapeHtml(c.data.slice(0, 10))} — ${escapeHtml(c.assunto)}</li>`).join('')}
    ${a.sessoes.map((s) => `<li>Sessão salva: ${escapeHtml(s)}</li>`).join('')}</ul></div>`;
}
