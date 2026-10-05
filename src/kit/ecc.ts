import { promises as fs } from 'fs';
import * as path from 'path';
import { Project } from '../portfolio/scanner';
import type { KitFile } from './build';

/**
 * ECC (https://github.com/affaan-m/ECC — MIT, Copyright (c) 2026 Affaan Mustafa) embutido na extensão.
 * O kit instala em cada projeto só os agentes, skills e regras da stack dele:
 * - agentes: .claude/agents/ (Claude Code) e .github/agents/*.agent.md (Copilot)
 * - skills: .claude/skills/<nome>/ (Claude Code; Copilot e Codex leem pelo AGENTS.md)
 * - regras completas: .fenor/ecc/regras/<linguagem>/
 */

export interface EccSelection {
  agents: string[];
  skills: string[];
  rules: string[];
}

const COMMON: EccSelection = {
  agents: ['code-reviewer', 'security-reviewer', 'tdd-guide', 'planner', 'silent-failure-hunter', 'code-explorer'],
  skills: ['tdd-workflow', 'verification-loop', 'security-review', 'error-handling'],
  rules: ['common'],
};

const BY_STACK: Record<string, EccSelection> = {
  java: {
    agents: ['java-reviewer', 'database-reviewer'],
    skills: ['springboot-tdd', 'springboot-verification', 'springboot-patterns', 'springboot-security', 'java-coding-standards', 'jpa-patterns', 'api-design', 'database-migrations'],
    rules: ['java'],
  },
  react: {
    agents: ['react-reviewer', 'typescript-reviewer', 'e2e-runner'],
    skills: ['react-patterns', 'react-testing', 'react-performance', 'frontend-patterns', 'e2e-testing'],
    rules: ['react', 'typescript'],
  },
  node: { agents: ['typescript-reviewer'], skills: ['backend-patterns', 'api-design'], rules: ['typescript'] },
  php: { agents: ['php-reviewer', 'database-reviewer'], skills: ['backend-patterns', 'api-design', 'database-migrations'], rules: ['php'] },
  python: { agents: ['python-reviewer', 'database-reviewer'], skills: ['python-patterns', 'python-testing', 'api-design'], rules: ['python'] },
  outro: { agents: [], skills: [], rules: [] },
};

export function eccSelection(project: Pick<Project, 'stack' | 'framework'>): EccSelection {
  const stack = BY_STACK[project.stack] ?? BY_STACK.outro;
  const extraSkills = /Laravel/.test(project.framework ?? '') ? ['laravel-tdd', 'laravel-verification'] : [];
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    agents: uniq([...COMMON.agents, ...stack.agents]),
    skills: uniq([...COMMON.skills, ...stack.skills, ...extraSkills]),
    rules: uniq([...COMMON.rules, ...stack.rules]),
  };
}

const ATTRIBUTION = 'Do ECC (https://github.com/affaan-m/ECC), licença MIT, Copyright (c) 2026 Affaan Mustafa. Instalado pelo Fenor.';

/** Lê o ECC embutido e gera os arquivos do kit para a seleção. */
export async function eccKitFiles(eccRoot: string, sel: EccSelection): Promise<KitFile[]> {
  const files: KitFile[] = [];
  for (const agent of sel.agents) {
    const content = await fs.readFile(path.join(eccRoot, 'agents', `${agent}.md`), 'utf8');
    files.push({ relPath: `.claude/agents/${agent}.md`, kind: 'generated', content });
    files.push({ relPath: `.github/agents/${agent}.agent.md`, kind: 'generated', content: toCopilotAgent(content, agent) });
  }
  for (const skill of sel.skills) {
    for (const rel of await listFiles(path.join(eccRoot, 'skills', skill))) {
      files.push({ relPath: `.claude/skills/${skill}/${rel}`, kind: 'generated', content: await fs.readFile(path.join(eccRoot, 'skills', skill, rel), 'utf8') });
    }
  }
  for (const lang of sel.rules) {
    for (const rel of await listFiles(path.join(eccRoot, 'rules', lang))) {
      files.push({ relPath: `.fenor/ecc/regras/${lang}/${rel}`, kind: 'generated', content: await fs.readFile(path.join(eccRoot, 'rules', lang, rel), 'utf8') });
    }
  }
  files.push({ relPath: '.fenor/ecc/LICENSE', kind: 'generated', content: await fs.readFile(path.join(eccRoot, 'LICENSE'), 'utf8') });
  files.push({ relPath: '.fenor/ecc/README.md', kind: 'generated', content: `# ECC no projeto\n\n${ATTRIBUTION}\n\n- Agentes: ${sel.agents.join(', ')}\n- Skills: ${sel.skills.join(', ')}\n- Regras: ${sel.rules.join(', ')}\n` });
  return files;
}

/** Agente do Claude Code → agente do Copilot: mesmo texto, cabeçalho só com nome e descrição. */
export function toCopilotAgent(content: string, name: string): string {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  const body = match ? content.slice(match[0].length) : content;
  const description = match ? /^description:\s*(.+)$/m.exec(match[1])?.[1].trim() : undefined;
  const desc = (description ?? name).replace(/^["']|["']$/g, '').replace(/'/g, "''");
  return `---\nname: ${name}\ndescription: '${desc}'\n---\n\n${body.trimStart()}`;
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (e) => (e.isDirectory()
    ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`)
    : [`${prefix}${e.name}`])));
  return nested.flat().sort();
}

/** Seção do AGENTS.md que explica o ECC instalado (para Copilot e Codex, que não leem .claude/ sozinhos). */
export function eccInstructions(sel: EccSelection): string {
  if (!sel.agents.length) {
    return '';
  }
  return `### Especialistas e práticas (ECC)
Antes de revisar, use o agente especialista da stack; antes de implementar ou testar, siga a skill correspondente.
- Agentes revisores: ${sel.agents.map((a) => `\`.claude/agents/${a}.md\``).join(', ')}
- Skills: ${sel.skills.map((s) => `\`.claude/skills/${s}/SKILL.md\``).join(', ')}
- Regras completas: ${sel.rules.map((r) => `\`.fenor/ecc/regras/${r}/\``).join(', ')}
No Claude Code os agentes e skills são carregados automaticamente; no Copilot os agentes aparecem no seletor de agentes.
`;
}
