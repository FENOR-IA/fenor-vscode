import { promises as fs } from 'fs';
import * as path from 'path';
import { KitFile, mergeBlock } from './build';

/**
 * - criar / atualizar / igual: arquivos do Fenor
 * - manter: memória que já existe (nunca sobrescrita)
 * - conflito: já existe um arquivo do time no mesmo caminho — o Fenor não toca
 */
export type KitAction = 'criar' | 'atualizar' | 'igual' | 'manter' | 'conflito';

export interface KitStep {
  file: KitFile;
  action: KitAction;
  next?: string;
}

export const MANIFEST = '.fenor/kit.json';

export interface KitManifest {
  versao: string;
  aplicadoEm: string;
  [extra: string]: unknown;
}

/**
 * O que aconteceria ao aplicar o kit — sem escrever nada.
 * Arquivo gerado só é atualizado se constar no manifesto da aplicação anterior (foi o Fenor que criou).
 */
export async function planKit(projectPath: string, files: readonly KitFile[], manifest: KitManifest): Promise<KitStep[]> {
  const owned = new Set(await ownedFiles(projectPath));
  const steps = await Promise.all(files.map(async (file): Promise<KitStep> => {
    const current = await readOptional(path.join(projectPath, file.relPath));
    if (file.kind === 'seed') {
      return current === undefined ? { file, action: 'criar', next: file.content } : { file, action: 'manter' };
    }
    const next = file.kind === 'block' ? mergeBlock(current, file.content) : file.content;
    if (current === undefined) {
      return { file, action: 'criar', next };
    }
    if (current === next) {
      return { file, action: 'igual' };
    }
    if (file.kind === 'generated' && !owned.has(file.relPath)) {
      return { file, action: 'conflito' };
    }
    return { file, action: 'atualizar', next };
  }));
  const generated = steps.filter((s) => s.file.kind === 'generated' && s.action !== 'conflito').map((s) => s.file.relPath);
  const manifestFile: KitFile = {
    relPath: MANIFEST,
    kind: 'generated',
    content: `${JSON.stringify({ ...manifest, arquivos: generated.sort() }, null, 2)}\n`,
  };
  const current = await readOptional(path.join(projectPath, MANIFEST));
  const manifestStep: KitStep = current === undefined
    ? { file: manifestFile, action: 'criar', next: manifestFile.content }
    : current === manifestFile.content ? { file: manifestFile, action: 'igual' } : { file: manifestFile, action: 'atualizar', next: manifestFile.content };
  return [...steps, manifestStep];
}

async function ownedFiles(projectPath: string): Promise<string[]> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(projectPath, MANIFEST), 'utf8')) as { arquivos?: unknown };
    return Array.isArray(data.arquivos) ? data.arquivos.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

export async function applyKit(projectPath: string, steps: readonly KitStep[]): Promise<number> {
  const writes = steps.filter((s) => (s.action === 'criar' || s.action === 'atualizar') && s.next !== undefined);
  for (const step of writes) {
    const target = path.join(projectPath, step.file.relPath);
    assertInside(projectPath, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, step.next as string, 'utf8');
  }
  return writes.length;
}

export interface KitStatus {
  applied: boolean;
  version?: string;
  appliedAt?: string;
}

export async function kitStatus(projectPath: string): Promise<KitStatus> {
  const raw = await readOptional(path.join(projectPath, MANIFEST));
  if (!raw) {
    return { applied: false };
  }
  try {
    const data = JSON.parse(raw) as { versao?: string; aplicadoEm?: string };
    return { applied: true, version: data.versao, appliedAt: data.aplicadoEm };
  } catch {
    return { applied: false };
  }
}

export function summarize(steps: readonly KitStep[]): Record<KitAction, number> {
  return steps.reduce((acc, s) => ({ ...acc, [s.action]: acc[s.action] + 1 }), { criar: 0, atualizar: 0, igual: 0, manter: 0, conflito: 0 } as Record<KitAction, number>);
}

/** Arquivos que o time já tem em .github/ (para mostrar na pré-visualização). */
export async function existingGithubFiles(projectPath: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), r);
      } else {
        out.push(r);
      }
    }
  };
  await walk(path.join(projectPath, '.github'), '.github');
  return out.sort();
}

const ACTION_LABEL: Record<KitAction, string> = {
  criar: 'novo',
  atualizar: 'atualizado',
  igual: 'sem mudança',
  manter: 'mantido (memória existente)',
  conflito: '⚠ CONFLITO — já existe arquivo do time; não será tocado',
};

/** Pré-visualização em Markdown: o que acontece com cada arquivo e o que o time já tem. */
export function previewReport(
  projects: ReadonlyArray<{ name: string; relPath: string; steps: readonly KitStep[]; teamFiles: readonly string[] }>,
  howToConfirm = 'Revise e confirme na janela do VS Code.',
): string {
  const lines = ['# Pré-visualização do kit Fenor', '', `Nada foi gravado ainda. ${howToConfirm}`, ''];
  for (const p of projects) {
    const s = summarize(p.steps);
    const ours = new Set(p.steps.map((st) => st.file.relPath));
    const teamOnly = p.teamFiles.filter((f) => !ours.has(f));
    lines.push(`## ${p.name} (\`${p.relPath}\`)`, '');
    lines.push(`${s.criar} novo(s) · ${s.atualizar} atualizado(s) · ${s.manter} mantido(s) · ${s.igual} sem mudança · **${s.conflito} conflito(s)**`, '');
    const important = p.steps.filter((st) => st.action !== 'igual');
    if (important.length) {
      lines.push('| Arquivo | O que acontece |', '|---|---|', ...important.map((st) => `| \`${st.file.relPath}\` | ${ACTION_LABEL[st.action]} |`), '');
    }
    if (p.steps.some((st) => st.file.relPath === '.github/copilot-instructions.md' && st.action === 'atualizar')) {
      lines.push('> O `copilot-instructions.md` do time é preservado: o Fenor só acrescenta (ou atualiza) um bloco marcado no final.', '');
    }
    if (teamOnly.length) {
      lines.push('**Arquivos do time em `.github/` que continuam valendo (o Fenor não mexe):**', '', ...teamOnly.map((f) => `- \`${f}\``), '');
      lines.push('> O Copilot soma as instruções do time e as do Fenor. Em caso de conflito, o bloco do Fenor manda seguir as do time.', '');
    }
  }
  return lines.join('\n');
}

function assertInside(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Caminho fora do projeto: ${target}`);
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}
