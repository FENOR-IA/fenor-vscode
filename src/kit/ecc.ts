import { promises as fs } from 'fs';
import * as path from 'path';
import { Project } from '../portfolio/scanner';
import type { KitFile } from './build';

/**
 * ECC (https://github.com/affaan-m/ECC — MIT, Copyright (c) 2026 Affaan Mustafa) embutido na extensão.
 * O kit instala, no formato do Copilot, os agentes e skills da stack do projeto:
 * - agentes: .github/agents/<nome>.agent.md (aparecem no seletor de agentes do Copilot)
 * - skills: .github/skills/<nome>/SKILL.md (o Copilot carrega quando a tarefa pede)
 */

export interface EccSelection {
  agents: string[];
  skills: string[];
}

const COMMON: EccSelection = {
  agents: ['code-reviewer', 'security-reviewer', 'tdd-guide', 'planner', 'silent-failure-hunter', 'code-explorer'],
  skills: ['tdd-workflow', 'verification-loop', 'security-review', 'error-handling'],
};

const BY_STACK: Record<Project['stack'], EccSelection> = {
  java: {
    agents: ['java-reviewer', 'database-reviewer'],
    skills: ['springboot-tdd', 'springboot-verification', 'springboot-patterns', 'springboot-security', 'java-coding-standards', 'jpa-patterns', 'api-design', 'database-migrations'],
  },
  react: {
    agents: ['react-reviewer', 'typescript-reviewer', 'e2e-runner'],
    skills: ['react-patterns', 'react-testing', 'react-performance', 'frontend-patterns', 'e2e-testing'],
  },
};

export function eccSelection(project: Pick<Project, 'stack'>): EccSelection {
  const stack = BY_STACK[project.stack];
  return { agents: [...COMMON.agents, ...stack.agents], skills: [...COMMON.skills, ...stack.skills] };
}

const ATTRIBUTION = 'Do ECC (https://github.com/affaan-m/ECC), licença MIT, Copyright (c) 2026 Affaan Mustafa. Instalado pelo Fenor.';

/** Lê o ECC embutido e gera os arquivos do kit para a seleção. */
export async function eccKitFiles(eccRoot: string, sel: EccSelection): Promise<KitFile[]> {
  const files: KitFile[] = [];
  for (const agent of sel.agents) {
    const content = await fs.readFile(path.join(eccRoot, 'agents', `${agent}.md`), 'utf8');
    files.push({ relPath: `.github/agents/${agent}.agent.md`, kind: 'generated', content: toCopilotAgent(content, agent) });
  }
  for (const skill of sel.skills) {
    for (const rel of await listFiles(path.join(eccRoot, 'skills', skill))) {
      files.push({ relPath: `.github/skills/${skill}/${rel}`, kind: 'generated', content: await fs.readFile(path.join(eccRoot, 'skills', skill, rel), 'utf8') });
    }
  }
  files.push({ relPath: '.github/ECC-LICENSE', kind: 'generated', content: await fs.readFile(path.join(eccRoot, 'LICENSE'), 'utf8') });
  return files;
}

/**
 * Agente no formato do Claude → agente do Copilot: mesmo texto; o cabeçalho fica só com nome e descrição
 * (os nomes de ferramenta e modelo do Claude não valem no Copilot).
 */
export function toCopilotAgent(content: string, name: string): string {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  const body = match ? content.slice(match[0].length) : content;
  const description = match ? /^description:\s*(.+)$/m.exec(match[1])?.[1].trim() : undefined;
  const desc = (description ?? name).replace(/^["']|["']$/g, '').replace(/'/g, "''");
  return `---\nname: ${name}\ndescription: '${desc}'\n---\n\n<!-- ${ATTRIBUTION} -->\n\n${body.trimStart()}`;
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (e) => (e.isDirectory()
    ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`)
    : [`${prefix}${e.name}`])));
  return nested.flat().sort();
}

/** Seção das instruções do Copilot que aponta os especialistas instalados. */
export function eccInstructions(sel: EccSelection): string {
  return `### Especialistas (ECC)
Para revisar, use o agente da stack no seletor de agentes (${sel.agents.filter((a) => /reviewer/.test(a)).map((a) => `\`${a}\``).join(', ')}).
Para implementar e testar, siga as skills: ${sel.skills.map((s) => `\`${s}\``).join(', ')} (em \`.github/skills/\`).
`;
}
