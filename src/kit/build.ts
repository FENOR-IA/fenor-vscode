import { TOOLS_SECTION } from '../copilot/instructions';
import { Project } from '../portfolio/scanner';
import { ProjectCommands } from './commands';
import { eccInstructions, eccSelection } from './ecc';
import { Mode, MODE_ORDER, MODES } from './modes';
import { RULE_APPLY_TO, RULES, rulesFor } from './rules';

export const KIT_VERSION = '2';

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

/** Kit no formato nativo do GitHub Copilot: tudo em .github/, mais a memória em memory/. */
export function kitManifest(project: KitProject, today: string): { versao: string; aplicadoEm: string; stack: string; regras: string[]; ecc: ReturnType<typeof eccSelection> } {
  return { versao: KIT_VERSION, aplicadoEm: today, stack: project.stack, regras: rulesFor(project), ecc: eccSelection(project) };
}

export function buildKitFiles(project: KitProject, commands: ProjectCommands, today: string): KitFile[] {
  const ruleIds = rulesFor(project);
  const modes = MODE_ORDER.map((id) => MODES[id]);
  return [
    { relPath: '.github/copilot-instructions.md', kind: 'block', content: copilotInstructions(project, commands, modes) },
    ...ruleIds.map((id): KitFile => ({
      relPath: `.github/instructions/fenor-${id}.instructions.md`,
      kind: 'generated',
      content: `---\napplyTo: '${RULE_APPLY_TO[id]}'\n---\n\n${RULES[id]}`,
    })),
    ...modes.map((m): KitFile => ({ relPath: `.github/prompts/fenor-${m.id}.prompt.md`, kind: 'generated', content: promptFile(m) })),
    ...memorySeeds(project, today),
  ];
}

export function copilotInstructions(project: KitProject, commands: ProjectCommands, modes: Mode[] = MODE_ORDER.map((id) => MODES[id])): string {
  const stack = [project.framework, project.runtime].filter(Boolean).join(' · ') || project.stack;
  const verify = [
    commands.test && `- Testes: \`${commands.test}\``,
    commands.build && `- Build: \`${commands.build}\``,
    commands.lint && `- Lint: \`${commands.lint}\``,
  ].filter(Boolean);
  return `## Método Fenor — ${project.name}

${project.description ? `${project.description}\n\n` : ''}**Stack:** ${stack}

Se este repositório já tiver instruções do time (fora deste bloco ou em outros arquivos de \`.github/instructions/\`), **elas têm prioridade** sobre as do Fenor em caso de conflito.

### Antes de agir
1. Chame **#fenor_contexto** (ou leia \`memory/INDEX.md\`, \`memory/progress/next.md\` e \`memory/kb/gotchas.md\`). As armadilhas registradas ali são erros que já aconteceram aqui: não repita.
2. As regras do projeto ficam em \`.github/instructions/\` e são aplicadas automaticamente aos arquivos certos.
3. Trabalhe num dos modos abaixo. Planejar e Revisar **não editam código**.

### Comandos de verificação
${verify.length ? verify.join('\n') : '- (nenhum detectado — informe o usuário e combine como verificar)'}
${commands.run ? `\nPara rodar localmente: \`${commands.run}\`${commands.port ? ` (porta ${commands.port})` : ''}\n` : ''}
Nunca diga que terminou com teste, build ou lint falhando.

### Modos (digite no chat)
${modes.map((m) => `- \`/fenor-${m.id}\` — ${m.title}: ${m.description}`).join('\n')}

${TOOLS_SECTION}
${eccInstructions(eccSelection(project))}
### Regras de ouro
- Defeito só se corrige com teste vermelho antes.
- Não invente API, tabela ou campo — confira no código.
- Mudança pequena, com propósito único; nada fora do escopo pedido.
- Decisões em \`memory/decisions/\`; aprendizados em \`memory/kb/gotchas.md\`.
- Commit só quando o usuário pedir, mensagem convencional citando \`AB#NNN\` quando houver.
`;
}

function promptFile(m: Mode): string {
  return `---
mode: ${m.readOnly ? 'ask' : 'agent'}
description: '${m.description.replace(/'/g, "''")}'
---

${m.body}

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
- memory/plan.md → plano atual (/fenor-planejar)
- memory/spec.md → especificação técnica
- memory/progress/next.md → próximo passo
- memory/progress/done.md → o que já foi feito
- memory/progress/blockers.md → o que está travado
- memory/context/produto.md → o que é o produto e para quem
- memory/context/negocio.md → modelo de negócio e regras
- memory/kb/domain.md → regras de negócio
- memory/kb/gotchas.md → erros e armadilhas descobertas
- memory/kb/integrations.md → APIs e serviços integrados
- memory/decisions/ → decisões (AAAA-MM-DD-assunto.md)
- memory/sessions/ → contexto salvo de cada sessão

Criado pelo Fenor em ${today}.
`),
    seed('memory/plan.md', '# Plano\n\nAinda não definido. Use /fenor-planejar.\n'),
    seed('memory/spec.md', '# Especificação técnica\n\nAinda não definida.\n'),
    seed('memory/progress/next.md', '# Próximo passo\n\n'),
    seed('memory/progress/done.md', '# Feito\n\n'),
    seed('memory/progress/blockers.md', '# Bloqueios\n\n'),
    seed('memory/context/produto.md', `# Produto\n\n${project.description ?? ''}\n`),
    seed('memory/context/negocio.md', '# Negócio\n\n'),
    seed('memory/kb/domain.md', '# Regras de negócio\n\n'),
    seed('memory/kb/gotchas.md', '# Armadilhas e erros encontrados\n\nFormato: **sintoma** — causa — como evitar.\n\n'),
    seed('memory/kb/integrations.md', '# Integrações\n\n'),
    seed('memory/decisions/.gitkeep', ''),
    seed('memory/sessions/.gitkeep', ''),
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
