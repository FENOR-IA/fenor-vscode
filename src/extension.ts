import * as path from 'path';
import * as vscode from 'vscode';
import { chooseProvider, createProviderStatus, runTask } from './ai/runner';
import { TaskKind } from './ai/tasks';
import { registerChatParticipant } from './chat/participant';
import { parseAzureInput } from './azure/client';
import { DashboardPanel } from './dashboard/panel';
import { registerCopilotTools } from './copilot/tools';
import { applyKitCommand, openModeCommand, setEccRoot, syncCopilotInstructions } from './kit/kitCommands';
import { ensureMemory } from './memory';
import { SystemsPanel } from './systems/panel';
import { loadSystems } from './systems/store';
import { generateVaultCommand } from './systems/systemsCommands';
import { SystemsTree } from './systems/tree';
import { writeSituationReport } from './reportCommand';
import { errorMessage, FenorState, PAT_SECRET_KEY } from './state';
import { BoardTree, PortfolioTree } from './views/trees';

const BUILD_FILES_GLOB = '**/{pom.xml,build.gradle,build.gradle.kts,package.json,composer.json}';
const RESCAN_DEBOUNCE_MS = 3000;
const AI_TASKS: TaskKind[] = ['situacao', 'board', 'planejar', 'testes', 'revisar', 'portfolio'];

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Fenor');
  const state = new FenorState(context.secrets, output);
  setEccRoot(path.join(context.extensionPath, 'ecc'));
  context.subscriptions.push(output, state);

  const systemsTree = new SystemsTree(state);
  const reloadSystems = async () => {
    if (state.roots[0]) {
      systemsTree.update(await loadSystems(state.roots[0]));
    }
  };
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fenor.systems', systemsTree),
    vscode.commands.registerCommand('fenor.systems.configure', () => SystemsPanel.show(state, () => void reloadSystems())),
    vscode.commands.registerCommand('fenor.vault.generate', (arg) => generateVaultCommand(state, arg)),
    vscode.window.registerTreeDataProvider('fenor.portfolio', new PortfolioTree(state)),
    vscode.window.registerTreeDataProvider('fenor.board', new BoardTree(state)),
    vscode.commands.registerCommand('fenor.dashboard.open', () => DashboardPanel.show(state)),
    vscode.commands.registerCommand('fenor.portfolio.refresh', () => state.refreshProjects()),
    vscode.commands.registerCommand('fenor.board.refresh', () => state.refreshBoard()),
    vscode.commands.registerCommand('fenor.azure.connect', () => connectAzure(context, state)),
    vscode.commands.registerCommand('fenor.azure.disconnect', async () => {
      await context.secrets.delete(PAT_SECRET_KEY);
      await state.refreshBoard();
      vscode.window.showInformationMessage('Fenor: token do Azure DevOps apagado.');
    }),
    vscode.commands.registerCommand('fenor.ai.ask', () => runTask(state)),
    vscode.commands.registerCommand('fenor.kit.apply', (arg) => applyKitCommand(state, arg)),
    vscode.commands.registerCommand('fenor.mode.open', (arg) => openModeCommand(state, arg)),
    vscode.commands.registerCommand('fenor.copilot.sync', async () => {
      const n = await syncCopilotInstructions(state);
      vscode.window.showInformationMessage(`Fenor: instruções do Copilot ${n ? `atualizadas (${n})` : 'já em dia'}.`);
    }),
    vscode.commands.registerCommand('fenor.ai.choose', () => chooseProvider()),
    ...AI_TASKS.map((kind) => vscode.commands.registerCommand(`fenor.ai.${kind}`, (arg?: string) => runTask(state, kind, typeof arg === 'string' ? arg : undefined))),
    vscode.commands.registerCommand('fenor.report.situation', () => writeSituationReport(state)),
    vscode.commands.registerCommand('fenor.memory.open', async () => {
      const root = state.roots[0];
      if (!root) {
        vscode.window.showWarningMessage('Fenor: abra uma pasta primeiro.');
        return;
      }
      await vscode.window.showTextDocument(vscode.Uri.file(await ensureMemory(root)));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('fenor.azure')) {
        state.refreshBoard();
      }
      if (e.affectsConfiguration('fenor.scan')) {
        state.refreshProjects();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => state.refreshProjects()),
  );

  watchBuildFiles(context, state);
  createProviderStatus(context);
  registerCopilotTools(context, state);

  if (typeof vscode.chat?.createChatParticipant === 'function') {
    registerChatParticipant(context, state);
  } else {
    output.appendLine('[chat] API de chat indisponível nesta versão do VS Code; @fenor desativado.');
  }

  state.refreshProjects();
  state.refreshBoard();
  void reloadSystems();
}

export function deactivate(): void {
  // Nada a liberar além das subscriptions.
}

function watchBuildFiles(context: vscode.ExtensionContext, state: FenorState): void {
  const watcher = vscode.workspace.createFileSystemWatcher(BUILD_FILES_GLOB);
  let timer: NodeJS.Timeout | undefined;
  const schedule = (uri: vscode.Uri) => {
    if (/[\\/](node_modules|vendor|target)[\\/]/.test(uri.fsPath)) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => state.refreshProjects(), RESCAN_DEBOUNCE_MS);
  };
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(schedule),
    watcher.onDidDelete(schedule),
    { dispose: () => clearTimeout(timer) },
  );
}

async function connectAzure(context: vscode.ExtensionContext, state: FenorState): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('fenor.azure');
  const orgInput = await vscode.window.showInputBox({
    title: 'Fenor: Azure DevOps (1/3)',
    prompt: 'Organização ou URL do projeto (ex.: https://dev.azure.com/minha-org/MeuProjeto)',
    value: cfg.get<string>('organization', ''),
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'Informe a organização'),
  });
  if (!orgInput) {
    return;
  }
  const parsed = parseAzureInput(orgInput);
  const project = await vscode.window.showInputBox({
    title: 'Fenor: Azure DevOps (2/3)',
    prompt: 'Nome do projeto no Azure DevOps',
    value: parsed.project ?? cfg.get<string>('project', ''),
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'Informe o projeto'),
  });
  if (!project) {
    return;
  }
  const pat = await vscode.window.showInputBox({
    title: 'Fenor: Azure DevOps (3/3)',
    prompt: 'Token pessoal (PAT) com permissão de leitura em Work Items. Fica no cofre do VS Code, nunca em arquivo.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'Informe o token'),
  });
  if (!pat) {
    return;
  }

  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  try {
    await context.secrets.store(PAT_SECRET_KEY, pat.trim());
    await cfg.update('organization', parsed.organization, target);
    await cfg.update('project', project.trim(), target);
    await state.refreshBoard();
    if (state.board.status === 'ok') {
      vscode.window.showInformationMessage(`Fenor: conectado. ${state.board.items.length} item(ns) carregados.`);
    } else {
      vscode.window.showErrorMessage(`Fenor: não consegui ler o board — ${state.board.error ?? 'verifique os dados'}`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Fenor: erro ao conectar — ${errorMessage(err)}`);
  }
}
