import * as path from 'path';
import { ACTIVITY_LABEL, Activity, idleLabel, ProjectFull, situationOf } from './situation';

const STACK_LABEL: Record<string, string> = {
  java: 'Java', react: 'React', node: 'Node', php: 'PHP', python: 'Python', outro: 'Outro',
};
const ACTIVITY_ORDER: Activity[] = ['ativo', 'morno', 'parado', 'sem-dados'];
const MAX_PENDING_IN_REPORT = 6;

/** Relatório de situação em Markdown. Links relativos à pasta onde o relatório é salvo. */
export function renderSituationReport(projects: readonly ProjectFull[], now: Date, reportDir: string): string {
  const rows = projects.map((p) => ({ p, s: situationOf(p, now) }))
    .sort((a, b) => ACTIVITY_ORDER.indexOf(a.s.activity) - ACTIVITY_ORDER.indexOf(b.s.activity)
      || (a.s.daysIdle ?? 9999) - (b.s.daysIdle ?? 9999));
  const count = (a: Activity) => rows.filter((r) => r.s.activity === a).length;
  const link = (p: ProjectFull, rel: string) => path.relative(reportDir, path.join(p.path, rel)).split(path.sep).join('/');

  const lines: string[] = [
    `# Situação dos projetos`,
    '',
    `Gerado pelo Fenor em ${now.toLocaleString('pt-BR')}. ${projects.length} projeto(s).`,
    '',
    `**${count('ativo')} ativos** (mexidos nos últimos 14 dias) · **${count('morno')} mornos** (até 60 dias) · **${count('parado')} parados** · ${count('sem-dados')} sem dados`,
    '',
    '| Projeto | Stack | Situação | Última atividade | Checklist | Alertas |',
    '|---|---|---|---|---|---|',
    ...rows.map(({ p, s }) => `| [${esc(p.name)}](#${anchor(p.relPath)}) | ${STACK_LABEL[p.stack]}${p.framework ? ` · ${esc(p.framework)}` : ''} | ${ACTIVITY_LABEL[s.activity]} | ${idleLabel(s)} | ${s.progress !== undefined ? `${s.progress}% (${p.docs.checklistOpen} abertos)` : '—'} | ${esc(s.flags.join(', ')) || '—'} |`),
    '',
  ];

  for (const { p, s } of rows) {
    lines.push(`## ${p.relPath}`, '');
    lines.push(`${STACK_LABEL[p.stack]}${p.framework ? ` · ${p.framework}` : ''}${p.runtime ? ` · ${p.runtime}` : ''}${p.git.branch ? ` · branch \`${p.git.branch}\`` : ''}`, '');
    const description = p.description ?? p.docs.summary;
    if (description) {
      lines.push(`> ${esc(description)}`, '');
    }
    lines.push(`- **Situação:** ${ACTIVITY_LABEL[s.activity]} — última atividade ${idleLabel(s)}${s.flags.length ? ` · ${s.flags.join(' · ')}` : ''}`);
    const last = p.git.commits[0];
    if (last) {
      lines.push(`- **Último commit:** ${esc(last.subject)} (${last.author}, ${last.date.slice(0, 10)})`);
    }
    if (s.progress !== undefined) {
      lines.push(`- **Checklists nos .md:** ${p.docs.checklistDone} feitos, ${p.docs.checklistOpen} abertos (${s.progress}%)`);
    }
    if (p.docs.pending.length) {
      lines.push('- **Pendências encontradas nos documentos:**');
      p.docs.pending.slice(0, MAX_PENDING_IN_REPORT).forEach((item) => lines.push(`  - ${esc(item.text)} — [${item.file}](${encodeURI(link(p, item.file))})`));
      if (p.docs.pending.length > MAX_PENDING_IN_REPORT) {
        lines.push(`  - … e mais ${p.docs.pending.length - MAX_PENDING_IN_REPORT}`);
      }
    }
    if (p.docs.files.length) {
      const main = p.docs.files.slice(0, 5).map((f) => `[${f.relPath}](${encodeURI(link(p, f.relPath))})`);
      lines.push(`- **Documentos (${p.docs.files.length}):** ${main.join(', ')}${p.docs.files.length > 5 ? ', …' : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function esc(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function anchor(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-');
}
