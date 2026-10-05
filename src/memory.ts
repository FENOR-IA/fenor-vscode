import { promises as fs } from 'fs';
import * as path from 'path';

export const MEMORY_RELATIVE_PATH = path.join('.fenor', 'memoria.md');

const MEMORY_TEMPLATE = `# Memória do time

Decisões, padrões e combinados que o @fenor deve respeitar ao planejar, testar e revisar.
Este arquivo fica no repositório: o time revisa e versiona junto com o código.

## Padrões de código
-

## Decisões de arquitetura
-

## Ambientes e URLs de serviço
-
`;

const MAX_MEMORY_CHARS = 12000;

export function memoryPath(root: string): string {
  return path.join(root, MEMORY_RELATIVE_PATH);
}

export async function readMemory(root: string | undefined): Promise<string | undefined> {
  if (!root) {
    return undefined;
  }
  try {
    const text = await fs.readFile(memoryPath(root), 'utf8');
    return text.slice(0, MAX_MEMORY_CHARS);
  } catch {
    return undefined;
  }
}

/** Cria o arquivo de memória com o modelo, se ainda não existir. */
export async function ensureMemory(root: string): Promise<string> {
  const file = memoryPath(root);
  try {
    await fs.access(file);
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, MEMORY_TEMPLATE, 'utf8');
  }
  return file;
}
