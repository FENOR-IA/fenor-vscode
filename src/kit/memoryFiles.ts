import { promises as fs } from 'fs';
import * as path from 'path';

/** Leitura e escrita da memória do projeto — usadas pelas ferramentas do Copilot. */

const CONTEXT_FILES = [
  'memory/INDEX.md',
  'memory/progress/next.md',
  'memory/progress/blockers.md',
  'memory/plan.md',
  'memory/kb/gotchas.md',
  'memory/kb/domain.md',
  'memory/kb/integrations.md',
];
const MAX_PER_FILE = 8000;
const MAX_TOTAL = 40000;

export async function buildProjectContext(projectPath: string, projectName: string): Promise<string> {
  const parts: string[] = [`# Contexto do projeto ${projectName} (memória Fenor)`];
  let total = 0;
  const latest = await latestSession(projectPath);
  const files = [...(latest ? [latest] : []), ...CONTEXT_FILES];
  for (const rel of files) {
    const text = await fs.readFile(path.join(projectPath, rel), 'utf8').catch(() => undefined);
    if (!text?.trim() || isEmptyTemplate(text)) {
      continue;
    }
    const slice = text.length > MAX_PER_FILE ? `${text.slice(0, MAX_PER_FILE)}\n[… cortado]` : text;
    if (total + slice.length > MAX_TOTAL) {
      parts.push(`\n(${rel} omitido por tamanho — leia o arquivo se precisar)`);
      continue;
    }
    total += slice.length;
    parts.push(`\n---\n## ${rel}\n\n${slice.trim()}`);
  }
  if (parts.length === 1) {
    parts.push('\nA memória deste projeto ainda está vazia. Aplique o kit Fenor ou comece pelo modo Planejar.');
  }
  return parts.join('\n');
}

async function latestSession(projectPath: string): Promise<string | undefined> {
  const dir = path.join(projectPath, 'memory', 'sessions');
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const sessions = entries.filter((e) => e.endsWith('.md')).sort();
  return sessions.length ? `memory/sessions/${sessions[sessions.length - 1]}` : undefined;
}

function isEmptyTemplate(text: string): boolean {
  return text.replace(/^#.*$/gm, '').replace(/Formato:.*$/gm, '').trim().length === 0;
}

export interface SessionInput {
  assunto: string;
  feito: string[];
  pendente?: string[];
  proximo: string;
  decisoes?: string[];
  aprendizados?: string[];
}

/** Grava memory/sessions/AAAA-MM-DD-assunto.md, atualiza next.md e acrescenta aprendizados em gotchas.md. */
export async function saveSession(projectPath: string, input: SessionInput, now: Date): Promise<string[]> {
  const date = now.toISOString().slice(0, 10);
  const slug = input.assunto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'sessao';
  const list = (items?: string[]) => (items?.length ? items.map((i) => `- ${i}`).join('\n') : '- (nada)');
  const sessionRel = `memory/sessions/${date}-${slug}.md`;
  const written: string[] = [];

  await writeFile(projectPath, sessionRel, `# Sessão ${date} — ${input.assunto}

## Feito
${list(input.feito)}

## Decisões
${list(input.decisoes)}

## Pendente
${list(input.pendente)}

## Próximo passo
${input.proximo}

## Aprendizados
${list(input.aprendizados)}
`, false);
  written.push(sessionRel);

  await writeFile(projectPath, 'memory/progress/next.md', `# Próximo passo\n\n${input.proximo}\n\n_Atualizado em ${date}._\n`, true);
  written.push('memory/progress/next.md');

  if (input.feito.length) {
    await appendFile(projectPath, 'memory/progress/done.md', '# Feito\n\n', `\n## ${date} — ${input.assunto}\n${list(input.feito)}\n`);
    written.push('memory/progress/done.md');
  }
  if (input.aprendizados?.length) {
    await appendFile(projectPath, 'memory/kb/gotchas.md', '# Armadilhas e erros encontrados\n\n', `\n${input.aprendizados.map((a) => `- ${a} _(${date})_`).join('\n')}\n`);
    written.push('memory/kb/gotchas.md');
  }
  return written;
}

async function writeFile(root: string, rel: string, content: string, overwrite: boolean): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (!overwrite) {
    const exists = await fs.access(target).then(() => true, () => false);
    if (exists) {
      await fs.appendFile(target, `\n---\n\n${content}`, 'utf8');
      return;
    }
  }
  await fs.writeFile(target, content, 'utf8');
}

async function appendFile(root: string, rel: string, header: string, content: string): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const exists = await fs.access(target).then(() => true, () => false);
  await fs.appendFile(target, exists ? content : `${header}${content}`, 'utf8');
}
