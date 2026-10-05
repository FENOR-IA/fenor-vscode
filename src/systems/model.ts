import * as path from 'path';
import { Project } from '../portfolio/scanner';

/** Sistemas: agrupam vários projetos (backs, fronts…) e têm um vault próprio. */

export const ROLES = ['front', 'back', 'api', 'fullstack', 'worker', 'mobile', 'lib', 'infra', 'docs', 'outro'] as const;
export type Role = typeof ROLES[number];

export const ROLE_LABEL: Record<Role, string> = {
  front: 'Front-end',
  back: 'Back-end',
  api: 'API',
  fullstack: 'Fullstack',
  worker: 'Worker / jobs',
  mobile: 'Mobile',
  lib: 'Biblioteca',
  infra: 'Infra',
  docs: 'Documentação',
  outro: 'Outro',
};

export interface Component {
  /** Caminho relativo à raiz do workspace. */
  project: string;
  role: Role;
  note?: string;
}

export interface SystemDef {
  id: string;
  name: string;
  description?: string;
  /** Pasta do vault (repositório próprio). Relativa à raiz do workspace ou absoluta. */
  vault?: string;
  components: Component[];
}

export interface SystemsFile {
  versao: 1;
  sistemas: SystemDef[];
}

export function emptySystems(): SystemsFile {
  return { versao: 1, sistemas: [] };
}

/** Normaliza JSON vindo de arquivo ou do painel (dados não confiáveis). */
export function normalizeSystems(raw: unknown): SystemsFile {
  const list = (raw as { sistemas?: unknown })?.sistemas;
  if (!Array.isArray(list)) {
    return emptySystems();
  }
  const seenIds = new Set<string>();
  const sistemas = list.flatMap((s): SystemDef[] => {
    const name = str((s as SystemDef)?.name);
    if (!name) {
      return [];
    }
    let id = slug(str((s as SystemDef).id) ?? name) || 'sistema';
    while (seenIds.has(id)) {
      id = `${id}-2`;
    }
    seenIds.add(id);
    const comps = Array.isArray((s as SystemDef).components) ? (s as SystemDef).components : [];
    const seenProjects = new Set<string>();
    const components = comps.flatMap((c): Component[] => {
      const project = str(c?.project)?.replace(/\\/g, '/').replace(/\/+$/, '');
      if (!project || project.split('/').includes('..') || seenProjects.has(project)) {
        return [];
      }
      seenProjects.add(project);
      const role = (ROLES as readonly string[]).includes(c.role) ? c.role : 'outro';
      return [{ project, role, ...(str(c.note) ? { note: str(c.note) } : {}) }];
    });
    return [{
      id,
      name,
      ...(str((s as SystemDef).description) ? { description: str((s as SystemDef).description) } : {}),
      ...(str((s as SystemDef).vault) ? { vault: str((s as SystemDef).vault) } : {}),
      components,
    }];
  });
  return { versao: 1, sistemas };
}

export function slug(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Papel provável a partir da stack e do nome. */
export function guessRole(p: Pick<Project, 'name' | 'relPath' | 'stack' | 'framework'>): Role {
  const name = `${p.name} ${p.relPath}`.toLowerCase();
  if (/\b(docs?|vault|wiki)\b|-docs\b/.test(name)) {
    return 'docs';
  }
  if (/(worker|job|batch|consumer|cron)/.test(name)) {
    return 'worker';
  }
  if (/(^|[-_/ ])(mobile|android|ios)([-_/ ]|$)/.test(name)) {
    return 'mobile';
  }
  if (p.stack === 'react' || /(^|[-_/])(front|web|ui|site|portal)([-_/]|$)/.test(name)) {
    return 'front';
  }
  if (/(^|[-_/])(api|gateway)([-_/]|$)/.test(name)) {
    return 'api';
  }
  if (/App Fenor|Laravel|Symfony/.test(p.framework ?? '') && !/(^|[-_/])(back|api)([-_/]|$)/.test(name)) {
    return 'fullstack';
  }
  if (p.stack === 'java' || p.stack === 'python' || p.stack === 'node' || p.stack === 'php' || /(^|[-_/])(back|server|service|svc)([-_/]|$)/.test(name)) {
    return 'back';
  }
  return 'outro';
}

/**
 * Sugere sistemas: projetos aninhados sob a mesma pasta de primeiro nível formam um sistema;
 * projetos irmãos que compartilham o prefixo do nome (pindurai, pindurai-app) também.
 */
export function suggestSystems(projects: ReadonlyArray<Pick<Project, 'name' | 'relPath' | 'stack' | 'framework'>>, existing: SystemsFile): SystemsFile {
  const taken = new Set(existing.sistemas.flatMap((s) => s.components.map((c) => c.project)));
  const free = projects.filter((p) => !taken.has(p.relPath));
  const groups = new Map<string, typeof free>();
  for (const p of free) {
    const key = groupKey(p.relPath);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const sistemas = [...existing.sistemas];
  const ids = new Set(sistemas.map((s) => s.id));
  for (const [key, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let id = slug(key) || 'sistema';
    while (ids.has(id)) {
      id = `${id}-2`;
    }
    ids.add(id);
    sistemas.push({
      id,
      name: titleCase(key),
      vault: `${id}-vault`,
      components: members.map((p) => ({ project: p.relPath, role: guessRole(p) })),
    });
  }
  return { versao: 1, sistemas };
}

// Prefixos comuns demais para indicar o mesmo sistema (crm-parceira e crm-remate são clientes diferentes).
const GENERIC_PREFIXES = new Set(['crm', 'app', 'api', 'web', 'site', 'sistema', 'sistemas', 'servico', 'servicos', 'portal', 'admin', 'projeto', 'novo', 'teste']);

function groupKey(relPath: string): string {
  const first = relPath.split(/[\\/]/)[0];
  const prefix = first.split(/[-_.]/)[0];
  return prefix && !GENERIC_PREFIXES.has(prefix.toLowerCase()) ? prefix : first;
}

function titleCase(text: string): string {
  return text.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveVaultPath(root: string, system: SystemDef): string {
  const vault = system.vault ?? `${system.id}-vault`;
  return path.isAbsolute(vault) ? vault : path.join(root, vault);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
