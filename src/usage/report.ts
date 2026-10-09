import { ProjectActivity, hasActivity } from './activity';
import { UsageSummary } from './log';

export const USAGE_DISCLAIMER = 'Tokens medidos só no que passa pelo Fenor (@fenor e ferramentas #fenor_*), estimados pelo tokenizador do modelo. '
  + 'O uso direto do Copilot (chat e modo agente sem o Fenor) não é exposto às extensões pelo VS Code — veja as premium requests na cobrança do GitHub.';

export function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

/** Relatório de uso e atividade em Markdown. */
export function renderUsageReport(period: { from: Date; to: Date }, usage: UsageSummary, activity: readonly ProjectActivity[]): string {
  const active = activity.filter(hasActivity);
  const commits = active.reduce((s, a) => s + a.commits.length, 0);
  const sessoes = active.reduce((s, a) => s + a.sessoes.length, 0);
  const workItems = [...new Set(active.flatMap((a) => a.workItems))];
  const verifTotal = usage.verificacoes.ok + usage.verificacoes.falha;
  const lines = [
    `# Relatório de uso — Fenor`,
    '',
    `Período: **${period.from.toLocaleDateString('pt-BR')} a ${period.to.toLocaleDateString('pt-BR')}**`,
    '',
    '## Resumo',
    '',
    '| Indicador | Valor |',
    '|---|---|',
    `| Pedidos ao @fenor | ${fmt(usage.pedidosChat)} |`,
    `| Tokens estimados (entrada / saída) | ${fmt(usage.tokensEntrada)} / ${fmt(usage.tokensSaida)} |`,
    `| Chamadas de ferramentas do Fenor | ${fmt(usage.chamadasFerramentas)} |`,
    `| Verificações (aprovadas / reprovadas) | ${usage.verificacoes.ok} / ${usage.verificacoes.falha}${verifTotal ? ` (${Math.round((usage.verificacoes.ok / verifTotal) * 100)}% aprovadas)` : ''} |`,
    `| Meus commits | ${commits} |`,
    `| Sessões salvas | ${sessoes} |`,
    `| Work items citados | ${workItems.length ? workItems.map((id) => `AB#${id}`).join(', ') : '—'} |`,
    '',
    `> ${USAGE_DISCLAIMER}`,
    '',
    '## Onde o consumo foi',
    '',
    ...table('Projeto', usage.porProjeto),
    ...table('Comando', usage.porComando),
    ...table('Modelo', usage.porModelo),
    '## O que eu fiz',
    '',
  ];
  if (!active.length) {
    lines.push('Nenhum commit ou sessão salva no período.', '');
  }
  for (const a of active) {
    lines.push(`### ${a.projeto}`, '');
    a.commits.forEach((c) => lines.push(`- \`${c.hash}\` ${c.data.slice(0, 10)} — ${c.assunto}`));
    a.sessoes.forEach((s) => lines.push(`- Sessão salva: ${s}`));
    lines.push('');
  }
  return lines.join('\n');
}

function table(label: string, rows: UsageSummary['porProjeto']): string[] {
  if (!rows.length) {
    return [];
  }
  return [`| ${label} | Eventos | Tokens |`, '|---|---|---|', ...rows.map((r) => `| ${r.chave} | ${r.eventos} | ${fmt(r.tokens)} |`), ''];
}
