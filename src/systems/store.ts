import { promises as fs } from 'fs';
import * as path from 'path';
import { emptySystems, normalizeSystems, SystemsFile } from './model';

export const SYSTEMS_FILE = path.join('.fenor', 'sistemas.json');

export async function loadSystems(root: string): Promise<SystemsFile> {
  try {
    return normalizeSystems(JSON.parse(await fs.readFile(path.join(root, SYSTEMS_FILE), 'utf8')));
  } catch {
    return emptySystems();
  }
}

export async function saveSystems(root: string, data: SystemsFile): Promise<SystemsFile> {
  const clean = normalizeSystems(data);
  const file = path.join(root, SYSTEMS_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  return clean;
}
