import { promises as fs } from 'fs';
import * as path from 'path';
import { KitFile, mergeBlock } from './build';

export type KitAction = 'criar' | 'atualizar' | 'igual' | 'manter';

export interface KitStep {
  file: KitFile;
  action: KitAction;
  next?: string;
}

/** O que aconteceria ao aplicar o kit — sem escrever nada. */
export async function planKit(projectPath: string, files: readonly KitFile[]): Promise<KitStep[]> {
  return Promise.all(files.map(async (file): Promise<KitStep> => {
    const current = await readOptional(path.join(projectPath, file.relPath));
    if (file.kind === 'seed') {
      return current === undefined ? { file, action: 'criar', next: file.content } : { file, action: 'manter' };
    }
    const next = file.kind === 'block' ? mergeBlock(current, file.content) : file.content;
    if (current === undefined) {
      return { file, action: 'criar', next };
    }
    return current === next ? { file, action: 'igual' } : { file, action: 'atualizar', next };
  }));
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
  const raw = await readOptional(path.join(projectPath, '.fenor', 'kit.json'));
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
  return steps.reduce((acc, s) => ({ ...acc, [s.action]: acc[s.action] + 1 }), { criar: 0, atualizar: 0, igual: 0, manter: 0 } as Record<KitAction, number>);
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
