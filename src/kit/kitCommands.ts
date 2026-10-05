import * as path from 'path';
import * as vscode from 'vscode';
import { findCli } from '../ai/cli';
import { PROVIDER_LABEL, ProviderId, resolveProvider } from '../ai/providers';
import { bucketOf } from '../azure/analysis';
import { errorMessage, FenorState, ProjectWithGit } from '../state';
import { applyKit, planKit, summarize } from './apply';
import { buildKitFiles } from './build';
import { rootInstructionFile, writeRootInstructions } from '../copilot/instructions';
import { detectCommands } from './commands';
import { eccKitFiles, eccSelection } from './ecc';
import { MODE_ORDER, MODES, ModeId } from './modes';

let eccRoot: string | undefined;

/** Pasta do ECC embutido na extensão (definida na ativação). */
export function setEccRoot(dir: string): void {
  eccRoot = dir;
}

async function kitFilesFor(p: ProjectWithGit, today: string) {
  const base = buildKitFiles(p, await detectCommands(p), today);
  return eccRoot ? [...base, ...await eccKitFiles(eccRoot, eccSelection(p))] : base;
}

type ProjectArg = ProjectWithGit | { project?: ProjectWithGit } | undefined;

function fromArg(arg: ProjectArg): ProjectWithGit | undefined {
  if (!arg) {
    return undefined;
  }
  return 'project' in arg ? arg.project : (arg as ProjectWithGit);
}

/** Aplica o kit Fenor (memória, modos, regras, instruções para as 3 IAs) nos projetos escolhidos. */
export async function applyKitCommand(state: FenorState, arg?: ProjectArg): Promise<void> {
  const single = fromArg(arg);
  const targets = single ? [single] : await pickProjects(state);
  if (!targets?.length) {
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const plans = await Promise.all(targets.map(async (p) => ({
    project: p,
    steps: await planKit(p.path, await kitFilesFor(p, today)),
  })));
  const totals = plans.reduce((acc, { steps }) => {
    const s = summarize(steps);
    return { criar: acc.criar + s.criar, atualizar: acc.atualizar + s.atualizar };
  }, { criar: 0, atualizar: 0 });
  if (!totals.criar && !totals.atualizar) {
    vscode.window.showInformationMessage('Fenor: o kit já está em dia nesses projetos.');
    return;
  }
  const detail = plans.map(({ project, steps }) => {
    const s = summarize(steps);
    return `${project.relPath}: ${s.criar} novo(s), ${s.atualizar} atualizado(s), ${s.manter} mantido(s)`;
  }).join('\n');
  const answer = await vscode.window.showInformationMessage(
    `Aplicar o kit Fenor em ${targets.length} projeto(s)? ${totals.criar} arquivo(s) novos e ${totals.atualizar} atualizado(s).`,
    { modal: true, detail: `${detail}\n\nA memória existente nunca é sobrescrita. Em CLAUDE.md, AGENTS.md e copilot-instructions.md o Fenor só mexe no bloco marcado. Os arquivos ficam prontos para commit.` },
    'Aplicar',
  );
  if (answer !== 'Aplicar') {
    return;
  }
  try {
    let written = 0;
    for (const { project, steps } of plans) {
      written += await applyKit(project.path, steps);
    }
    await state.refreshProjects();
    const synced = await syncCopilotInstructions(state);
    vscode.window.showInformationMessage(`Fenor: kit aplicado — ${written} arquivo(s) gravados${synced ? `; instruções do Copilot atualizadas na raiz (${synced})` : ''}. Revise e faça o commit em cada projeto.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Fenor: erro ao aplicar o kit — ${errorMessage(err)}`);
  }
}

async function pickProjects(state: FenorState): Promise<ProjectWithGit[] | undefined> {
  const items = state.projects.map((p) => ({
    label: p.name,
    description: p.relPath,
    detail: p.kit?.applied ? `kit aplicado em ${p.kit.appliedAt}` : 'sem kit',
    picked: !p.kit?.applied && p.stack !== 'outro',
    project: p,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Aplicar o kit Fenor em quais projetos?', canPickMany: true, matchOnDescription: true });
  return picked?.map((i) => i.project);
}

/** Abre um modo (planejar, executar…) no projeto, com a IA escolhida. */
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
    MODE_ORDER.map((id) => ({ label: MODES[id].title, description: MODES[id].description, id })),
    { title: `Modo de trabalho em ${project.name}` },
  ))?.id;
  if (!mode) {
    return;
  }
  const provider = await pickProvider();
  if (!provider) {
    return;
  }
  const request = mode === 'salvar-sessao' ? '' : await askRequest(state, mode);
  if (request === undefined) {
    return;
  }
  try {
    await launch(state, project, mode, provider, request);
  } catch (err) {
    vscode.window.showErrorMessage(`Fenor: ${errorMessage(err)}`);
  }
}

async function pickOne(state: FenorState): Promise<ProjectWithGit | undefined> {
  const picked = await vscode.window.showQuickPick(
    state.projects.map((p) => ({ label: p.name, description: p.relPath, detail: p.kit?.applied ? 'kit Fenor' : 'sem kit', project: p })),
    { title: 'Em qual projeto?', matchOnDescription: true },
  );
  return picked?.project;
}

async function pickProvider(): Promise<ProviderId | undefined> {
  const preferred = (await resolveProvider())?.id;
  const ids: ProviderId[] = ['copilot', 'claude', 'codex'];
  const picked = await vscode.window.showQuickPick(
    ids.map((id) => ({ label: PROVIDER_LABEL[id], description: id === preferred ? 'padrão' : '', id }))
      .sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0)),
    { title: 'Com qual IA?' },
  );
  return picked?.id;
}

async function askRequest(state: FenorState, mode: ModeId): Promise<string | undefined> {
  const open = state.board.items.filter((w) => bucketOf(w.state) !== 'done');
  if (open.length && (mode === 'planejar' || mode === 'feature' || mode === 'corrigir' || mode === 'executar')) {
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
    title: MODES[mode].title,
    prompt: 'Descreva o pedido (pode deixar em branco para seguir o plano atual)',
    ignoreFocusOut: true,
  });
}

async function launch(state: FenorState, project: ProjectWithGit, mode: ModeId, provider: ProviderId, request: string): Promise<void> {
  const m = MODES[mode];
  const name = `Fenor · ${project.name} · ${m.title} (${PROVIDER_LABEL[provider]})`;
  if (provider === 'copilot') {
    const root = state.roots.find((r) => project.path === r || project.path.startsWith(r + path.sep)) ?? project.path;
    const rel = path.relative(root, project.path) || '.';
    const modeFile = path.join(rel, '.fenor', 'modos', `${mode}.md`).split(path.sep).join('/');
    const query = [
      `Siga as instruções de #file:${modeFile}.`,
      rel !== '.' ? `Trabalhe dentro da pasta \`${rel}/\`: os caminhos citados no modo são relativos a ela, e o AGENTS.md dela vale aqui.` : '',
      request ? `Pedido: ${request}` : '',
    ].filter(Boolean).join(' ');
    await vscode.commands.executeCommand('workbench.action.chat.open', { query, mode: m.readOnly ? 'ask' : 'agent' });
    return;
  }
  const cli = await findCli(provider, vscode.workspace.getConfiguration('fenor.ai').get<string>(`${provider}Path`, '') || undefined);
  if (!cli) {
    throw new Error(`${PROVIDER_LABEL[provider]} não encontrado neste computador.`);
  }
  const prompt = provider === 'claude'
    ? `/fenor-${mode} ${request}`.trim()
    : `Siga as instruções de .fenor/modos/${mode}.md e o AGENTS.md.${request ? ` Pedido: ${request}` : ''}`;
  const args = provider === 'claude'
    ? (m.readOnly ? ['--disallowedTools', 'Bash(git commit*)', 'Bash(git push*)', 'Bash(rm *)'] : [])
    : (m.readOnly ? ['--sandbox', 'read-only'] : []);
  const terminal = vscode.window.createTerminal({ name, cwd: project.path });
  terminal.show();
  terminal.sendText([cli, ...args, prompt].map(shellQuote).join(' '));
}

export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) {
    return value;
  }
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\'')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Gera na raiz do workspace as instruções do Copilot de cada projeto com kit (applyTo pelo caminho),
 * para o Copilot seguir o método mesmo com a pasta-mãe de vários repositórios aberta.
 */
export async function syncCopilotInstructions(state: FenorState): Promise<number> {
  const root = state.roots[0];
  if (!root) {
    return 0;
  }
  const today = new Date().toISOString().slice(0, 10);
  const files = await Promise.all(state.projects
    .filter((p) => p.kit?.applied && p.relPath !== '.')
    .map(async (p) => {
      const agents = buildKitFiles(p, await detectCommands(p), today).find((f) => f.relPath === 'AGENTS.md');
      return rootInstructionFile(p.relPath, p.name, agents?.content ?? '');
    }));
  return writeRootInstructions(root, files);
}
