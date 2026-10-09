import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { analyzeSprint, loadByMember } from '../azure/analysis';
import { WorkItem } from '../azure/client';
import {
  boardPrompt, memoryContext, planPrompt, portfolioPrompt, projectsContext, reviewPrompt, situationPrompt, SituationInput, SYSTEM_RULES, testPlanPrompt,
} from './prompts';
import { readMemory } from '../memory';
import { getWorkingDiff } from '../portfolio/git';
import { ACTIVITY_LABEL, idleLabel, situationOf } from '../portfolio/situation';
import { FenorState, ProjectWithGit } from '../state';

/** Tarefas do @fenor no chat do Copilot. */

export type TaskKind = 'situacao' | 'board' | 'planejar' | 'testes' | 'revisar' | 'portfolio' | 'livre';

export const TASK_LABEL: Record<TaskKind, string> = {
  situacao: 'Situação dos projetos',
  board: 'Análise do sprint',
  planejar: 'Plano de implementação',
  testes: 'Plano de testes',
  revisar: 'Revisão de código',
  portfolio: 'Resumo do portfólio',
  livre: 'Pergunta livre',
};

export interface Reporter {
  progress(message: string): void;
  /** Mensagem para o usuário (não vai para a IA). */
  notice(markdown: string): void;
}

const SITUATION_BUDGET_CHARS = 90000;

export async function buildSystemContext(state: FenorState): Promise<string> {
  const memory = await readMemory(state.roots[0]);
  return [SYSTEM_RULES, `Projetos do workspace:\n${projectsContext(state.projects)}`, memoryContext(memory)].filter(Boolean).join('\n\n');
}

/** Monta o pedido. Retorna undefined quando não há o que perguntar (o motivo vai para reporter.notice). */
export async function buildTask(state: FenorState, kind: TaskKind, arg: string, reporter: Reporter): Promise<string | undefined> {
  if (!state.projects.length && !state.scanning) {
    reporter.progress('Lendo os projetos do workspace…');
    await state.refreshProjects();
  }
  switch (kind) {
    case 'board':
      return boardTask(state, reporter);
    case 'planejar':
    case 'testes': {
      const item = await resolveWorkItem(state, arg, reporter, kind);
      return item ? (kind === 'planejar' ? planPrompt(item) : testPlanPrompt(item)) : undefined;
    }
    case 'revisar':
      return reviewTask(state, arg, reporter);
    case 'portfolio':
      return portfolioPrompt();
    case 'situacao':
      return situationTask(state, arg, reporter);
    default:
      if (!arg.trim()) {
        reporter.notice('Escreva a pergunta.');
        return undefined;
      }
      return arg;
  }
}

async function boardTask(state: FenorState, reporter: Reporter): Promise<string | undefined> {
  if (state.board.status !== 'ok') {
    reporter.progress('Carregando o sprint do Azure DevOps…');
    await state.refreshBoard();
  }
  if (state.board.status !== 'ok') {
    reporter.notice(boardUnavailable(state));
    return undefined;
  }
  const staleDays = vscode.workspace.getConfiguration('fenor').get<number>('board.staleDays', 5);
  const items = state.board.items;
  return boardPrompt(state.board.sprint?.name, items, analyzeSprint(items, new Date(), staleDays), loadByMember(items));
}

async function reviewTask(state: FenorState, arg: string, reporter: Reporter): Promise<string | undefined> {
  const project = pickProject(state.projects, arg);
  if (!project) {
    reporter.notice('Diga qual projeto revisar ou abra um arquivo dele no editor.');
    return undefined;
  }
  const diff = await getWorkingDiff(project.path);
  if (!diff.trim()) {
    reporter.notice(`Nenhuma mudança não commitada em **${project.name}**.`);
    return undefined;
  }
  reporter.progress(`Revisando ${project.name}…`);
  return reviewPrompt(project.name, diff);
}

async function situationTask(state: FenorState, arg: string, reporter: Reporter): Promise<string | undefined> {
  const chosen = arg.trim() ? pickProject(state.projects, arg) : undefined;
  if (arg.trim() && !chosen) {
    reporter.notice(`Não encontrei o projeto "${arg.trim()}". Deixe em branco para ver todos.`);
    return undefined;
  }
  reporter.progress('Lendo os documentos dos projetos…');
  const targets = chosen ? [chosen] : state.projects;
  const perProject = chosen ? 40000 : Math.max(2500, Math.floor(SITUATION_BUDGET_CHARS / Math.max(1, targets.length)));
  return situationPrompt(await Promise.all(targets.map((p) => situationInput(p, perProject))));
}

async function resolveWorkItem(state: FenorState, arg: string, reporter: Reporter, kind: TaskKind): Promise<WorkItem | undefined> {
  const id = Number(/(\d+)/.exec(arg)?.[1]);
  if (!id) {
    reporter.notice(`Informe o número do work item, ex.: \`/${kind} 1234\`.`);
    return undefined;
  }
  const cached = state.findWorkItem(id);
  if (cached) {
    return cached;
  }
  const client = await state.getClient();
  if (!client) {
    reporter.notice(boardUnavailable(state));
    return undefined;
  }
  reporter.progress(`Buscando o item ${id} no Azure DevOps…`);
  const item = await client.getWorkItem(id);
  if (!item) {
    reporter.notice(`Não encontrei o item ${id} no projeto configurado.`);
  }
  return item;
}

export function pickProject(projects: readonly ProjectWithGit[], arg: string): ProjectWithGit | undefined {
  const text = arg.trim().toLowerCase();
  if (text) {
    return projects.find((p) => p.name.toLowerCase() === text || p.relPath.toLowerCase() === text)
      ?? projects.find((p) => p.name.toLowerCase().includes(text) || p.relPath.toLowerCase().includes(text));
  }
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!active) {
    return undefined;
  }
  // Projeto mais específico que contém o arquivo aberto.
  return [...projects]
    .filter((p) => active.startsWith(p.path + path.sep))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function boardUnavailable(state: FenorState): string {
  if (state.board.status === 'erro') {
    return `Não consegui ler o Azure DevOps: ${state.board.error}`;
  }
  return 'O Azure DevOps não está conectado. Rode o comando **Fenor: Conectar Azure DevOps**.';
}

/** Fatos objetivos + os principais .md do projeto, cortados para caber no orçamento. */
async function situationInput(p: ProjectWithGit, maxChars: number): Promise<SituationInput> {
  const s = situationOf(p, new Date());
  const facts = [
    `Caminho: ${p.relPath} · Stack: ${p.stack}${p.framework ? ` (${p.framework})` : ''}`,
    `Atividade: ${ACTIVITY_LABEL[s.activity]}, última ${idleLabel(s)}${s.flags.length ? ` · ${s.flags.join(', ')}` : ''}`,
    `Commits recentes: ${p.git.commits.slice(0, 5).map((c) => `${c.date.slice(0, 10)} ${c.subject}`).join(' | ') || 'nenhum'}`,
    `Checklists: ${p.docs.checklistDone} feitos, ${p.docs.checklistOpen} abertos`,
  ].join('\n');
  const docs: Array<{ file: string; text: string }> = [];
  let budget = maxChars;
  for (const f of p.docs.files) {
    if (budget <= 500) {
      break;
    }
    const text = await fs.readFile(path.join(p.path, f.relPath), 'utf8').catch(() => '');
    const slice = text.slice(0, Math.min(budget, 12000));
    docs.push({ file: f.relPath, text: slice });
    budget -= slice.length;
  }
  return { name: p.relPath, facts, docs };
}
