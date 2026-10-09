import * as path from 'path';
import { kitStatus } from '../kit/apply';
import { collectDocs } from '../portfolio/docs';
import { getGitInfo } from '../portfolio/git';
import { scanRoot } from '../portfolio/scanner';
import { ProjectFull } from '../portfolio/situation';

/** Projetos da pasta, sem depender do VS Code (usado pelo servidor MCP e pelo comando `fenor`). */
export async function loadProjects(root: string, maxDepth = 4): Promise<ProjectFull[]> {
  const found = await scanRoot(root, maxDepth);
  const out: ProjectFull[] = [];
  for (const p of found) {
    const [git, docs, kit] = await Promise.all([getGitInfo(p.path), collectDocs(p.path), kitStatus(p.path)]);
    out.push({ ...p, git, docs, kit });
  }
  return out;
}

/** Projeto pelo nome, caminho relativo ou absoluto; se houver um só, ele. */
export function resolveProject(projects: readonly ProjectFull[], wanted: string | undefined, root: string): ProjectFull {
  const key = wanted?.trim().replace(/[\\/]+$/, '');
  if (key) {
    const abs = path.isAbsolute(key) ? path.resolve(key) : path.resolve(root, key);
    const found = projects.find((p) => path.resolve(p.path) === abs)
      ?? projects.find((p) => p.name.toLowerCase() === key.toLowerCase() || p.relPath.toLowerCase() === key.toLowerCase())
      ?? projects.find((p) => p.relPath.toLowerCase().endsWith(`/${key.toLowerCase()}`));
    if (found) {
      return found;
    }
    throw new Error(`Projeto "${wanted}" não encontrado. Projetos: ${projects.map((p) => p.relPath).join(', ') || 'nenhum'}`);
  }
  if (projects.length === 1) {
    return projects[0];
  }
  throw new Error(`Informe o projeto. Projetos: ${projects.map((p) => p.relPath).join(', ') || 'nenhum Java ou React encontrado'}`);
}
