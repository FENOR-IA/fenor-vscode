import { Project } from '../portfolio/scanner';
import { ProjectCommands } from './commands';
import { TOOLS_SECTION } from '../copilot/instructions';
import { eccInstructions, eccSelection } from './ecc';
import { Mode, MODE_ORDER, MODES } from './modes';
import { RULES, rulesFor } from './rules';

export const KIT_VERSION = '1';

/**
 * - generated: arquivo do Fenor, reescrito a cada aplicação
 * - block: arquivo do time; o Fenor só mexe entre os marcadores
 * - seed: criado só se não existir (memória do projeto nunca é sobrescrita)
 */
export type KitFileKind = 'generated' | 'block' | 'seed';

export interface KitFile {
  relPath: string;
  kind: KitFileKind;
  content: string;
}

export const BLOCK_START = '<!-- fenor:inicio — bloco gerado pelo Fenor; edite fora dele -->';
export const BLOCK_END = '<!-- fenor:fim -->';

type KitProject = Pick<Project, 'name' | 'stack' | 'framework' | 'runtime' | 'description'>;

export function buildKitFiles(project: KitProject, commands: ProjectCommands, today: string): KitFile[] {
  const ruleIds = rulesFor(project);
  const modes = MODE_ORDER.map((id) => MODES[id]);
  const instructions = agentsBlock(project, commands, ruleIds, modes);
  return [
    ...modes.map((m): KitFile => ({ relPath: `.fenor/modos/${m.id}.md`, kind: 'generated', content: `${m.body}\n` })),
    ...ruleIds.map((id): KitFile => ({ relPath: `.fenor/regras/${id}.md`, kind: 'generated', content: RULES[id] })),
    ...modes.map((m): KitFile => ({ relPath: `.claude/commands/fenor-${m.id}.md`, kind: 'generated', content: claudeCommand(m) })),
    ...modes.map((m): KitFile => ({ relPath: `.github/prompts/fenor-${m.id}.prompt.md`, kind: 'generated', content: copilotPrompt(m) })),
    { relPath: '.fenor/kit.json', kind: 'generated', content: `${JSON.stringify({ versao: KIT_VERSION, aplicadoEm: today, stack: project.stack, regras: ruleIds, ecc: eccSelection(project) }, null, 2)}\n` },
    { relPath: 'AGENTS.md', kind: 'block', content: instructions },
    { relPath: '.github/copilot-instructions.md', kind: 'block', content: instructions },
    { relPath: 'CLAUDE.md', kind: 'block', content: '## Método Fenor\n\nSiga as instruções do AGENTS.md (importado abaixo). Os modos estão em `/fenor-planejar`, `/fenor-executar`, `/fenor-revisar`, `/fenor-corrigir`, `/fenor-feature` e `/fenor-salvar-sessao`.\n\n@AGENTS.md\n' },
    ...memorySeeds(project, today),
  ];
}

function agentsBlock(project: KitProject, commands: ProjectCommands, ruleIds: string[], modes: Mode[]): string {
  const stack = [project.framework, project.runtime].filter(Boolean).join(' · ') || project.stack;
  const verify = [
    commands.test && `- Testes: \`${commands.test}\``,
    commands.build && `- Build: \`${commands.build}\``,
    commands.lint && `- Lint: \`${commands.lint}\``,
  ].filter(Boolean);
  return `## Método Fenor — ${project.name}

${project.description ? `${project.description}\n\n` : ''}**Stack:** ${stack}

### Antes de agir
1. Leia \`memory/INDEX.md\`, \`memory/progress/next.md\` e \`memory/kb/gotchas.md\` (erros já cometidos aqui — não repita).
2. Leia as regras que se aplicam: ${ruleIds.map((id) => `\`.fenor/regras/${id}.md\``).join(', ')}.
3. Trabalhe num dos modos abaixo. Planejar e Revisar **não editam código**.

### Comandos de verificação
${verify.length ? verify.join('\n') : '- (nenhum detectado — informe ao usuário e combine como verificar)'}
${commands.run ? `\nPara rodar localmente: \`${commands.run}\`${commands.port ? ` (porta ${commands.port})` : ''}\n` : ''}
Nunca diga que terminou com teste, build ou lint falhando.

### Modos
| Modo | Claude Code | Copilot | Codex / outros |
|---|---|---|---|
${modes.map((m) => `| ${m.title} — ${m.description} | \`/fenor-${m.id}\` | \`/fenor-${m.id}\` | siga \`.fenor/modos/${m.id}.md\` |`).join('\n')}

${eccInstructions(eccSelection(project))}
${TOOLS_SECTION}
### Regras de ouro
- Defeito só se corrige com teste vermelho antes.
- Não invente API, tabela ou campo — confira no código.
- Mudança pequena, com propósito único; nada fora do escopo pedido.
- Decisões em \`memory/decisions/\`; aprendizados em \`memory/kb/gotchas.md\`.
- Commit só quando o usuário pedir, mensagem convencional citando \`AB#NNN\` quando houver.
`;
}

function claudeCommand(m: Mode): string {
  return `---
description: ${m.description}
argument-hint: [pedido ou work item]
---

${m.body}

## Pedido

$ARGUMENTS
`;
}

function copilotPrompt(m: Mode): string {
  return `---
mode: agent
description: '${m.description.replace(/'/g, "''")}'
---

${m.body}

No Copilot: chame **#fenor_contexto** antes de começar e **#fenor_verificar** antes de concluir${m.readOnly ? '' : '; ao encerrar, **#fenor_salvar_sessao**'}.

## Pedido

\${input:pedido:Descreva o pedido ou informe o work item (AB#NNN)}
`;
}

function memorySeeds(project: KitProject, today: string): KitFile[] {
  const seed = (relPath: string, content: string): KitFile => ({ relPath, kind: 'seed', content });
  return [
    seed('memory/INDEX.md', `# ${project.name} — Mapa de Memória

## O que é
${project.description ?? 'Descreva o projeto aqui.'}

## Arquivos de memória
- memory/plan.md → plano atual (modo Planejar)
- memory/spec.md → especificação técnica
- memory/progress/next.md → próximo passo
- memory/progress/done.md → o que já foi feito
- memory/progress/blockers.md → o que está travado
- memory/context/produto.md → o que é o produto e para quem
- memory/context/usuario.md → perfil do usuário final
- memory/context/negocio.md → modelo de negócio e regras
- memory/kb/domain.md → regras de negócio
- memory/kb/gotchas.md → erros e armadilhas descobertas
- memory/kb/integrations.md → APIs e serviços integrados
- memory/decisions/ → decisões (AAAA-MM-DD-assunto.md)
- memory/sessions/ → contexto salvo de cada sessão
- memory/log/ → diário
- memory/agents/ → relatórios de revisão

Criado pelo Fenor em ${today}.
`),
    seed('memory/plan.md', '# Plano\n\nAinda não definido. Use o modo Planejar.\n'),
    seed('memory/spec.md', '# Especificação técnica\n\nAinda não definida.\n'),
    seed('memory/progress/next.md', '# Próximo passo\n\n'),
    seed('memory/progress/done.md', '# Feito\n\n'),
    seed('memory/progress/blockers.md', '# Bloqueios\n\n'),
    seed('memory/context/produto.md', `# Produto\n\n${project.description ?? ''}\n`),
    seed('memory/context/usuario.md', '# Usuário final\n\n'),
    seed('memory/context/negocio.md', '# Negócio\n\n'),
    seed('memory/kb/domain.md', '# Regras de negócio\n\n'),
    seed('memory/kb/gotchas.md', '# Armadilhas e erros encontrados\n\nFormato: **sintoma** — causa — como evitar.\n\n'),
    seed('memory/kb/integrations.md', '# Integrações\n\n'),
    seed('memory/decisions/.gitkeep', ''),
    seed('memory/sessions/.gitkeep', ''),
    seed('memory/log/.gitkeep', ''),
    seed('memory/agents/.gitkeep', ''),
  ];
}

/** Insere ou substitui o bloco do Fenor num arquivo do time, preservando o resto. */
export function mergeBlock(existing: string | undefined, block: string): string {
  const wrapped = `${BLOCK_START}\n${block.trimEnd()}\n${BLOCK_END}`;
  if (existing === undefined || !existing.trim()) {
    return `${wrapped}\n`;
  }
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END, start);
  if (start !== -1 && end !== -1) {
    return `${existing.slice(0, start)}${wrapped}${existing.slice(end + BLOCK_END.length)}`;
  }
  return `${existing.trimEnd()}\n\n${wrapped}\n`;
}
