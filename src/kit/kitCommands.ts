import * as path from 'path';
import * as vscode from 'vscode';
import { bucketOf } from '../azure/analysis';
import { rootInstructionFile, writeRootInstructions } from '../copilot/instructions';
import { errorMessage, FenorState, ProjectWithGit } from '../state';
import { track } from '../usage/tracker';
import { applyKit, existingGithubFiles, KitStep, planKit, previewReport, summarize } from './apply';
import { buildKitFiles, copilotInstructions, kitManifest } from './build';
import { detectCommands } from './commands';
import { eccKitFiles, eccSelection } from './ecc';
import { MODE_ORDER, MODES, ModeId } from './modes';

let eccRoot: string | undefined;

/** Pasta do ECC embutido na extensão (definida na ativação). */
export function setEccRoot(dir: string): void {
  eccRoot = dir;
}

type ProjectArg = ProjectWithGit | { project?: ProjectWithGit } | undefined;

function fromArg(arg: ProjectArg): ProjectWithGit | undefined {
  if (!arg) {
    return undefined;
  }
  return 'project' in arg ? arg.project : (arg as ProjectWithGit);
}

interface ProjectPlan {
  project: ProjectWithGit;
  steps: KitStep[];
  teamFiles: string[];
}

async function planFor(p: ProjectWithGit, today: string): Promise<ProjectPlan> {
  const base = buildKitFiles(p, await detectCommands(p), today);
  const files = eccRoot ? [...base, ...await eccKitFiles(eccRoot, eccSelection(p))] : base;
  return { project: p, steps: await planKit(p.path, files, kitManifest(p, today)), teamFiles: await existingGithubFiles(p.path) };
}

/** Aplica o kit Fenor (instruções, regras, modos, especialistas, memória) nos projetos escolhidos. */
export async function applyKitCommand(state: FenorState, arg?: ProjectArg): Promise<void> {
  const single = fromArg(arg);
  const targets = single ? [single] : await pickProjects(state);
  if (!targets?.length) {
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const plans = await Promise.all(targets.map((p) => planFor(p, today)));
  const totals = plans.map((p) => summarize(p.steps)).reduce((acc, s) => ({
    criar: acc.criar + s.criar, atualizar: acc.atualizar + s.atualizar, conflito: acc.conflito + s.conflito,
  }), { criar: 0, atualizar: 0, conflito: 0 });
  if (!totals.criar && !totals.atualizar) {
    vscode.window.showInformationMessage('Fenor: o kit já está em dia nesses projetos.');
    return;
  }

  for (;;) {
    const answer = await vscode.window.showInformationMessage(
      `Aplicar o kit Fenor em ${targets.length} projeto(s)? ${totals.criar} arquivo(s) novos, ${totals.atualizar} atualizado(s)${totals.conflito ? `, ${totals.conflito} conflito(s) que serão ignorados` : ''}.`,
      {
        modal: true,
        detail: 'Nada do time é sobrescrito: instruções existentes são preservadas (o Fenor só acrescenta um bloco marcado), arquivos do time com o mesmo nome ficam como conflito e não são tocados, e a memória existente é mantida. Tudo fica no git para você revisar antes do commit.',
      },
      'Aplicar', 'Ver detalhes',
    );
    if (answer === 'Ver detalhes') {
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: previewReport(plans.map((p) => ({ name: p.project.name, relPath: p.project.relPath, steps: p.steps, teamFiles: p.teamFiles }))),
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      continue;
    }
    if (answer !== 'Aplicar') {
      return;
    }
    break;
  }

  try {
    let written = 0;
    for (const { project, steps } of plans) {
      const n = await applyKit(project.path, steps);
      written += n;
      track({ tipo: 'kit', projeto: project.relPath, ok: true, detalhe: `${n} arquivo(s)` });
    }
    await state.refreshProjects();
    const synced = await syncCopilotInstructions(state);
    vscode.window.showInformationMessage(
      `Fenor: kit aplicado — ${written} arquivo(s) gravados${totals.conflito ? `, ${totals.conflito} conflito(s) ignorados` : ''}${synced ? `; instruções na raiz do workspace atualizadas (${synced})` : ''}. Revise o diff e faça o commit.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Fenor: erro ao aplicar o kit — ${errorMessage(err)}`);
  }
}

async function pickProjects(state: FenorState): Promise<ProjectWithGit[] | undefined> {
  const items = state.projects.map((p) => ({
    label: p.name,
    description: p.relPath,
    detail: p.kit?.applied ? `kit aplicado em ${p.kit.appliedAt}` : 'sem kit',
    picked: !p.kit?.applied,
    project: p,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Aplicar o kit Fenor em quais projetos?', canPickMany: true, matchOnDescription: true });
  return picked?.map((i) => i.project);
}

/** Abre um modo (/fenor-planejar, /fenor-executar…) no chat do Copilot para o projeto. */
export async function openModeCommand(state: FenorState, arg?: ProjectArg, presetMode?: ModeId): Promise<void> {
  const project = fromArg(arg) ?? await pickOne(state);
  if (!project) {
    return;
  }
  if (!project.kit?.applied) {
    const go = await vscode.window.showWarningMessage(`O projeto ${project.name} ainda não tem o kit Fenor. Aplicar agora?`, 'Aplicar kit');
    if (go) {
      await applyKitCommand(state, project);
    }
    return;
  }
  const mode = presetMode ?? (await vscode.window.showQuickPick(
    MODE_ORDER.map((id) => ({ label: `/fenor-${id}`, description: MODES[id].description, id })),
    { title: `Modo de trabalho em ${project.name}` },
  ))?.id;
  if (!mode) {
    return;
  }
  const request = mode === 'salvar-sessao' ? '' : await askRequest(state, mode);
  if (request === undefined) {
    return;
  }
  const m = MODES[mode];
  const isWorkspaceRoot = state.roots.some((r) => path.resolve(r) === path.resolve(project.path));
  // Aberto na raiz do projeto, o Copilot já conhece /fenor-<modo>; com a pasta-mãe aberta, anexamos o arquivo do modo.
  const query = isWorkspaceRoot
    ? `/fenor-${mode} ${request}`.trim()
    : [
      `Siga as instruções de #file:${path.join(project.relPath, '.github', 'prompts', `fenor-${mode}.prompt.md`).split(path.sep).join('/')}.`,
      `Trabalhe dentro de \`${project.relPath}/\` (os caminhos do modo são relativos a essa pasta; nas ferramentas do Fenor use projeto: "${project.relPath}").`,
      request ? `Pedido: ${request}` : '',
    ].filter(Boolean).join(' ');
  track({ tipo: 'modo', comando: `fenor-${mode}`, projeto: project.relPath });
  await vscode.commands.executeCommand('workbench.action.chat.open', { query, mode: m.readOnly ? 'ask' : 'agent' });
}

async function pickOne(state: FenorState): Promise<ProjectWithGit | undefined> {
  const picked = await vscode.window.showQuickPick(
    state.projects.map((p) => ({ label: p.name, description: p.relPath, detail: p.kit?.applied ? 'kit Fenor' : 'sem kit', project: p })),
    { title: 'Em qual projeto?', matchOnDescription: true },
  );
  return picked?.project;
}

async function askRequest(state: FenorState, mode: ModeId): Promise<string | undefined> {
  const open = state.board.items.filter((w) => bucketOf(w.state) !== 'done');
  if (open.length && mode !== 'revisar') {
    const picked = await vscode.window.showQuickPick(
      [{ label: '$(edit) Descrever o pedido…', value: '' }, ...open.map((w) => ({ label: `AB#${w.id} · ${w.title}`, description: w.type, value: `AB#${w.id} — ${w.title}` }))],
      { title: 'Qual o pedido?', matchOnDescription: true },
    );
    if (!picked) {
      return undefined;
    }
    if (picked.value) {
      return picked.value;
    }
  }
  return vscode.window.showInputBox({
    title: `/fenor-${mode}`,
    prompt: 'Descreva o pedido (pode deixar em branco para seguir o plano atual)',
    ignoreFocusOut: true,
  });
}

/**
 * O Copilot só lê instruções da raiz do workspace. Com a pasta-mãe de vários repositórios aberta,
 * gera na raiz uma instrução por projeto, aplicada pelo caminho (applyTo).
 */
export async function syncCopilotInstructions(state: FenorState): Promise<number> {
  const root = state.roots[0];
  if (!root) {
    return 0;
  }
  const files = await Promise.all(state.projects
    .filter((p) => p.kit?.applied && path.resolve(p.path) !== path.resolve(root))
    .map(async (p) => rootInstructionFile(p.relPath, p.name, copilotInstructions(p, await detectCommands(p)))));
  return writeRootInstructions(root, files);
}
