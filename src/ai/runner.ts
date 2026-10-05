import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { bucketOf } from '../azure/analysis';
import { errorMessage, FenorState } from '../state';
import { availableProviders, PROVIDER_LABEL, ProviderId, PROVIDERS, resolveProvider } from './providers';
import { buildSystemContext, buildTask, TASK_LABEL, TaskKind } from './tasks';

const ALL_PROJECTS = '__todos__';

/** Executa uma tarefa do Fenor com a IA configurada e grava a resposta em .fenor/respostas/. */
export async function runTask(state: FenorState, kind?: TaskKind, presetArg?: string): Promise<void> {
  const root = state.roots[0];
  if (!root) {
    vscode.window.showWarningMessage('Fenor: abra uma pasta primeiro.');
    return;
  }
  const chosenKind = kind ?? await pickKind();
  if (!chosenKind) {
    return;
  }
  const arg = presetArg ?? await askArgument(state, chosenKind);
  if (arg === undefined) {
    return;
  }
  const provider = await resolveProvider();
  if (!provider) {
    await offerProviderSetup();
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fenor · ${provider.label}`, cancellable: true },
    async (progress, token) => {
      try {
        const notices: string[] = [];
        const task = await buildTask(state, chosenKind, arg, {
          progress: (m) => progress.report({ message: m }),
          notice: (m) => notices.push(m),
        });
        if (!task) {
          vscode.window.showInformationMessage(`Fenor: ${stripMarkdown(notices.join(' ') || 'nada a fazer.')}`);
          return;
        }
        const file = await createAnswerFile(root, chosenKind, arg, provider.label);
        await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(file));
        progress.report({ message: `${TASK_LABEL[chosenKind]} — gerando resposta…` });

        const append = serialAppender(file);
        await provider.run({ system: await buildSystemContext(state), task, cwd: root, token, onText: append });
        await append(token.isCancellationRequested ? '\n\n_Cancelado._\n' : '\n');
        await append.flush();
      } catch (err) {
        vscode.window.showErrorMessage(`Fenor (${provider.label}): ${errorMessage(err)}`);
      }
    },
  );
}

async function pickKind(): Promise<TaskKind | undefined> {
  const kinds: TaskKind[] = ['situacao', 'board', 'planejar', 'testes', 'revisar', 'portfolio', 'livre'];
  const picked = await vscode.window.showQuickPick(kinds.map((k) => ({ label: TASK_LABEL[k], task: k })), { title: 'Fenor: o que fazer?' });
  return picked?.task;
}

async function askArgument(state: FenorState, kind: TaskKind): Promise<string | undefined> {
  switch (kind) {
    case 'situacao': {
      const items = [
        { label: '$(list-tree) Todos os projetos', value: ALL_PROJECTS },
        ...state.projects.map((p) => ({ label: p.name, description: p.relPath, value: p.relPath })),
      ];
      const picked = await vscode.window.showQuickPick(items, { title: 'Situação de qual projeto?', matchOnDescription: true });
      return picked ? (picked.value === ALL_PROJECTS ? '' : picked.value) : undefined;
    }
    case 'revisar': {
      const dirty = state.projects.filter((p) => p.git.dirtyFiles > 0);
      if (!dirty.length) {
        vscode.window.showInformationMessage('Fenor: nenhum projeto com mudanças não commitadas.');
        return undefined;
      }
      const picked = await vscode.window.showQuickPick(
        dirty.map((p) => ({ label: p.name, description: `${p.relPath} · ${p.git.dirtyFiles} arquivo(s)`, value: p.relPath })),
        { title: 'Revisar qual projeto?', matchOnDescription: true },
      );
      return picked?.value;
    }
    case 'planejar':
    case 'testes': {
      const open = state.board.items.filter((w) => bucketOf(w.state) !== 'done');
      if (open.length) {
        const picked = await vscode.window.showQuickPick(
          open.map((w) => ({ label: `${w.id} · ${w.title}`, description: `${w.type} · ${w.state}`, value: String(w.id) })),
          { title: `${TASK_LABEL[kind]}: qual work item?`, matchOnDescription: true },
        );
        return picked?.value;
      }
      return vscode.window.showInputBox({ title: TASK_LABEL[kind], prompt: 'Número do work item no Azure DevOps', validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'Só números') });
    }
    case 'livre':
      return vscode.window.showInputBox({ title: 'Pergunta para a IA', prompt: 'A IA recebe a lista de projetos e a memória do time como contexto', ignoreFocusOut: true });
    default:
      return '';
  }
}

async function createAnswerFile(root: string, kind: TaskKind, arg: string, providerLabel: string): Promise<string> {
  const dir = path.join(root, '.fenor', 'respostas');
  await fs.mkdir(dir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = arg.trim() ? `-${arg.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '')}` : '';
  const file = path.join(dir, `${stamp}-${kind}${slug}.md`);
  const title = `${TASK_LABEL[kind]}${arg.trim() && kind !== 'livre' ? ` — ${arg.trim()}` : ''}`;
  const question = kind === 'livre' ? `\n> ${arg.trim().replace(/\n/g, '\n> ')}\n` : '';
  await fs.writeFile(file, `# ${title}\n\n_${providerLabel} · ${now.toLocaleString('pt-BR')}_\n${question}\n`, 'utf8');
  return file;
}

/** Acrescenta texto ao arquivo em ordem, agrupando escritas para não martelar o disco. */
function serialAppender(file: string): ((text: string) => Promise<void>) & { flush(): Promise<void> } {
  let chain = Promise.resolve();
  let pending = '';
  let timer: NodeJS.Timeout | undefined;
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const text = pending;
    pending = '';
    chain = chain.then(() => (text ? fs.appendFile(file, text, 'utf8') : undefined));
    return chain;
  };
  const append = (text: string): Promise<void> => {
    pending += text;
    if (!timer) {
      timer = setTimeout(() => void flush(), 250);
    }
    return Promise.resolve();
  };
  return Object.assign(append, { flush });
}

async function offerProviderSetup(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    'Fenor: nenhuma IA encontrada. Instale o GitHub Copilot Chat, o Claude Code (`claude`) ou o Codex (`codex`).',
    'Escolher IA',
  );
  if (choice) {
    await chooseProvider();
  }
}

/** Escolhe a IA e salva em fenor.ai.provider (global). */
export async function chooseProvider(): Promise<void> {
  const available = new Set(await availableProviders());
  const current = vscode.workspace.getConfiguration('fenor.ai').get<string>('provider', 'auto');
  const base: Array<{ label: string; description: string; value: ProviderId | 'auto' }> = [
    { label: 'Automático', description: 'primeira disponível: Copilot → Claude Code → Codex', value: 'auto' },
    ...(['copilot', 'claude', 'codex'] as ProviderId[]).map((id) => ({
      label: PROVIDER_LABEL[id],
      description: available.has(id) ? 'disponível' : 'não encontrado neste computador',
      value: id,
    })),
  ];
  const options = base.map((o) => ({ ...o, label: o.value === current ? `$(check) ${o.label}` : o.label }));
  const picked = await vscode.window.showQuickPick(options, { title: 'Fenor: qual IA usar?' });
  if (picked) {
    await vscode.workspace.getConfiguration('fenor.ai').update('provider', picked.value, vscode.ConfigurationTarget.Global);
  }
}

/** Mostra a IA ativa na barra de status; clique troca. */
export function createProviderStatus(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'fenor.ai.choose';
  const update = async () => {
    const configured = vscode.workspace.getConfiguration('fenor.ai').get<string>('provider', 'auto') as ProviderId | 'auto';
    const resolved = await resolveProvider();
    const label = resolved ? resolved.label : 'sem IA';
    item.text = `$(sparkle) Fenor: ${label}${configured === 'auto' ? ' (auto)' : ''}`;
    item.tooltip = 'Clique para escolher a IA do Fenor (Copilot, Claude Code ou Codex)';
    item.show();
  };
  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('fenor.ai') && void update()),
    vscode.extensions.onDidChange(() => void update()),
  );
  void update();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*|`/g, '');
}

