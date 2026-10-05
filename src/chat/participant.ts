import * as path from 'path';
import * as vscode from 'vscode';
import { PROVIDERS } from '../ai/providers';
import { buildSystemContext, buildTask, TaskKind } from '../ai/tasks';
import { errorMessage, FenorState } from '../state';

const COMMANDS = new Set<TaskKind>(['situacao', 'board', 'planejar', 'testes', 'revisar', 'portfolio']);

/** @fenor no chat do Copilot — usa as mesmas tarefas dos comandos, com o modelo escolhido no chat. */
export function registerChatParticipant(context: vscode.ExtensionContext, state: FenorState): void {
  const participant = vscode.chat.createChatParticipant('fenor.chat', (request, _ctx, stream, token) =>
    handle(state, request, stream, token));
  participant.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'fenor.svg'));
  context.subscriptions.push(participant);
}

async function handle(
  state: FenorState,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  try {
    const kind: TaskKind = request.command && COMMANDS.has(request.command as TaskKind) ? request.command as TaskKind : 'livre';
    const task = await buildTask(state, kind, request.prompt, {
      progress: (m) => stream.progress(m),
      notice: (m) => stream.markdown(m),
    });
    if (!task) {
      return {};
    }
    await PROVIDERS.copilot.run({
      system: await buildSystemContext(state),
      task,
      cwd: state.roots[0] ?? process.cwd(),
      token,
      onText: (t) => stream.markdown(t),
      copilotModel: request.model,
    });
    return {};
  } catch (err) {
    stream.markdown(`Erro: ${errorMessage(err)}`);
    return { errorDetails: { message: errorMessage(err) } };
  }
}
