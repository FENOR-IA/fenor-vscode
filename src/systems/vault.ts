import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mergeBlock } from '../kit/build';
import { ProjectCommands } from '../kit/commands';
import { ACTIVITY_LABEL, idleLabel, ProjectFull, situationOf } from '../portfolio/situation';
import { Component, ROLE_LABEL, SystemDef } from './model';

/**
 * Vault estilo Obsidian de um sistema — repositório próprio, separado dos projetos.
 * Notas geradas ficam num bloco marcado; o que o time escrever fora dele é preservado.
 */

export interface VaultComponent {
  component: Component;
  project?: ProjectFull;
  commands?: ProjectCommands;
}

export interface VaultFile {
  relPath: string;
  /** note: cabeçalho YAML + bloco do Fenor (texto do time abaixo é preservado); seed: criado uma vez. */
  kind: 'note' | 'seed';
  content: string;
  frontmatter?: string;
}

export function buildVaultFiles(system: SystemDef, comps: readonly VaultComponent[], now: Date): VaultFile[] {
  const date = now.toISOString().slice(0, 10);
  const noteName = (c: VaultComponent) => noteTitle(c);
  return [
    { relPath: 'README.md', kind: 'seed', content: `# Vault — ${system.name}\n\nBase de conhecimento do sistema **${system.name}**. Abra esta pasta como vault no Obsidian.\n\nGerado e mantido pelo Fenor: as seções entre os marcadores \`fenor:inicio\`/\`fenor:fim\` são atualizadas automaticamente; escreva livremente fora delas.\n\nComece por [[${system.name}]].\n` },
    { relPath: `${system.name}.md`, kind: 'note', ...systemNote(system, comps, noteName, date) },
    ...comps.map((c): VaultFile => ({ relPath: `Componentes/${noteName(c)}.md`, kind: 'note', ...componentNote(system, c, comps, noteName, now) })),
    { relPath: 'Decisões/README.md', kind: 'seed', content: '# Decisões\n\nUma nota por decisão: `AAAA-MM-DD assunto.md` com contexto, decisão, alternativas e consequências.\n' },
    { relPath: 'Integrações/README.md', kind: 'seed', content: '# Integrações\n\nUma nota por integração (API externa, fila, banco compartilhado), com quem chama quem e o contrato.\n' },
    { relPath: 'Glossário.md', kind: 'seed', content: `# Glossário — ${system.name}\n\nTermos do negócio e o significado deles neste sistema.\n` },
    { relPath: '.gitignore', kind: 'seed', content: '.obsidian/workspace*.json\n.obsidian/cache\n.trash/\n' },
  ];
}

function noteTitle(c: VaultComponent): string {
  return (c.project?.name ?? path.basename(c.component.project)).replace(/[\\/:*?"<>|#^[\]]/g, '-');
}

function systemNote(system: SystemDef, comps: readonly VaultComponent[], noteName: (c: VaultComponent) => string, date: string): { frontmatter: string; content: string } {
  const byRole = [...comps].sort((a, b) => a.component.role.localeCompare(b.component.role));
  const frontmatter = `tipo: sistema\nsistema: ${yaml(system.name)}\natualizado: ${date}\ntags: [sistema]`;
  return { frontmatter, content: `# ${system.name}

${system.description ?? '_Descreva o sistema: para quem é, o que resolve, principais fluxos._'}

## Componentes

| Componente | Papel | Stack | Situação |
|---|---|---|---|
${byRole.map((c) => {
    const s = c.project ? situationOf(c.project, new Date(date)) : undefined;
    return `| [[${noteName(c)}]] | ${ROLE_LABEL[c.component.role]} | ${c.project ? [c.project.framework, c.project.runtime].filter(Boolean).join(' · ') || c.project.stack : 'não encontrado'} | ${s ? `${ACTIVITY_LABEL[s.activity]} (${idleLabel(s)})` : '—'} |`;
  }).join('\n')}

## Mapa

\`\`\`mermaid
flowchart LR
${byRole.map((c, i) => `  c${i}["${noteName(c).replace(/"/g, "'")}<br/><small>${ROLE_LABEL[c.component.role]}</small>"]`).join('\n')}
${linksFor(byRole).map(([a, b]) => `  c${a} --> c${b}`).join('\n')}
\`\`\`

_Setas sugeridas pelo papel (front → back/API). Ajuste as integrações reais em [[Integrações/README|Integrações]]._

## Ver também
- [[Glossário]]
- [[Decisões/README|Decisões]]
` };
}

/** Ligações prováveis: fronts e mobiles chamam backs, APIs e fullstacks; workers usam backs. */
function linksFor(comps: readonly VaultComponent[]): Array<[number, number]> {
  const idx = (roles: string[]) => comps.map((c, i) => (roles.includes(c.component.role) ? i : -1)).filter((i) => i >= 0);
  const callers = idx(['front', 'mobile']);
  const servers = idx(['back', 'api', 'fullstack']);
  const workers = idx(['worker']);
  return [
    ...callers.flatMap((a) => servers.map((b): [number, number] => [a, b])),
    ...workers.flatMap((a) => servers.map((b): [number, number] => [a, b])),
  ];
}

function componentNote(
  system: SystemDef,
  c: VaultComponent,
  all: readonly VaultComponent[],
  noteName: (c: VaultComponent) => string,
  now: Date,
): { frontmatter: string; content: string } {
  const p = c.project;
  const others = all.filter((o) => o !== c).map((o) => `[[${noteName(o)}]] (${ROLE_LABEL[o.component.role]})`);
  if (!p) {
    return {
      frontmatter: `tipo: componente\nsistema: ${yaml(system.name)}\npapel: ${c.component.role}\ncaminho: ${yaml(c.component.project)}`,
      content: `# ${noteName(c)}\n\n⚠ Projeto não encontrado em \`${c.component.project}\`.\n`,
    };
  }
  const s = situationOf(p, now);
  const cmd = c.commands ?? {};
  const frontmatter = [
    'tipo: componente',
    `sistema: ${yaml(system.name)}`,
    `papel: ${c.component.role}`,
    `stack: ${p.stack}`,
    `framework: ${yaml(p.framework ?? '')}`,
    `caminho: ${yaml(c.component.project)}`,
    `situacao: ${s.activity}`,
    `kit_fenor: ${p.kit?.applied ? 'sim' : 'nao'}`,
    `tags: [componente, ${c.component.role}, ${p.stack}]`,
  ].join('\n');
  return { frontmatter, content: `# ${noteName(c)}

Parte de [[${system.name}]] · **${ROLE_LABEL[c.component.role]}** · ${[p.framework, p.runtime].filter(Boolean).join(' · ') || p.stack}

${c.component.note ? `${c.component.note}\n\n` : ''}${p.description ?? p.docs.summary ?? '_Sem descrição nos documentos do projeto._'}

## Situação
- ${ACTIVITY_LABEL[s.activity]} — última atividade ${idleLabel(s)}${s.flags.length ? ` · ${s.flags.join(' · ')}` : ''}
- Branch: \`${p.git.branch ?? 'sem git'}\`${p.git.commits[0] ? ` · último commit: ${p.git.commits[0].subject} (${p.git.commits[0].date.slice(0, 10)})` : ''}
${s.progress !== undefined ? `- Checklists: ${p.docs.checklistDone} feitos, ${p.docs.checklistOpen} abertos (${s.progress}%)\n` : ''}- Kit Fenor: ${p.kit?.applied ? `aplicado em ${p.kit.appliedAt}` : 'não aplicado'}

## Como rodar e verificar
${[cmd.run && `- Rodar: \`${cmd.run}\`${cmd.port ? ` (porta ${cmd.port})` : ''}`, cmd.test && `- Testes: \`${cmd.test}\``, cmd.build && `- Build: \`${cmd.build}\``, cmd.lint && `- Lint: \`${cmd.lint}\``].filter(Boolean).join('\n') || '- (comandos não detectados)'}

## Pendências
${p.docs.pending.length ? p.docs.pending.map((i) => `- [ ] ${i.text} — \`${i.file}\``).join('\n') : '- Nenhuma encontrada nos documentos.'}

## Relaciona-se com
${others.length ? others.map((o) => `- ${o}`).join('\n') : '- (único componente)'}

## Documentos do projeto
${p.docs.files.slice(0, 15).map((f) => `- \`${c.component.project}/${f.relPath}\``).join('\n') || '- Nenhum.'}
` };
}

/** Cabeçalho YAML sempre no topo (o Obsidian só lê ali), bloco do Fenor logo abaixo, texto do time preservado. */
export function renderNote(current: string | undefined, f: VaultFile): string {
  const body = (current ?? '').replace(/^---\n[\s\S]*?\n---\n*/, '');
  const merged = mergeBlock(body || undefined, f.content);
  return f.frontmatter ? `---\n${f.frontmatter}\n---\n\n${merged}` : merged;
}

function yaml(value: string): string {
  return /^[\w .\-/À-ú]*$/.test(value) && !/^\s|\s$/.test(value) ? value : JSON.stringify(value);
}

export interface VaultResult {
  path: string;
  written: number;
  createdRepo: boolean;
}

/** Grava o vault (cria a pasta e o repositório git se ainda não existirem). */
export async function writeVault(vaultPath: string, system: SystemDef, files: readonly VaultFile[]): Promise<VaultResult> {
  await fs.mkdir(vaultPath, { recursive: true });
  let written = 0;
  for (const f of files) {
    const target = path.join(vaultPath, f.relPath);
    const rel = path.relative(vaultPath, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Caminho fora do vault: ${f.relPath}`);
    }
    const current = await fs.readFile(target, 'utf8').catch(() => undefined);
    const next = f.kind === 'seed' ? (current === undefined ? f.content : undefined) : renderNote(current, f);
    if (next !== undefined && next !== current) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, next, 'utf8');
      written++;
    }
  }
  const manifest = `${JSON.stringify({ versao: 1, sistema: system }, null, 2)}\n`;
  await fs.writeFile(path.join(vaultPath, 'sistema.json'), manifest, 'utf8');
  const createdRepo = await ensureGitRepo(vaultPath);
  return { path: vaultPath, written, createdRepo };
}

function ensureGitRepo(dir: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'rev-parse', '--show-toplevel'], (err, stdout) => {
      if (!err && path.resolve(stdout.trim()) === path.resolve(dir)) {
        resolve(false);
        return;
      }
      execFile('git', ['-C', dir, 'init', '-q'], (initErr) => resolve(!initErr));
    });
  });
}
