import * as path from 'path';
import * as vscode from 'vscode';
import { errorMessage, FenorState } from '../state';
import { track } from '../usage/tracker';
import { buildSystemContext, buildTask, TaskKind } from './tasks';

const COMMANDS = new Set<TaskKind>(['situacao', 'board', 'planejar', 'testes', 'revisar', 'portfolio']);

/** @fenor no chat do Copilot, com o modelo escolhido no próprio chat. */
export function registerChatParticipant(context: vscode.ExtensionContext, state: FenorState): void {
  const participant = vscode.chat.createChatParticipant('fenor.chat', (request, _ctx, stream, token) =>
    handle(state, request, stream, token));
  participant.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'icon.png'));
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
    const system = await buildSystemContext(state);
    const messages = [vscode.LanguageModelChatMessage.User(system), vscode.LanguageModelChatMessage.User(task)];
    const started = Date.now();
    const response = await request.model.sendRequest(messages, {}, token);
    let output = '';
    for await (const chunk of response.text) {
      output += chunk;
      stream.markdown(chunk);
    }
    track({
      tipo: 'chat',
      comando: kind,
      projeto: projectHint(state, request.prompt),
      modelo: request.model.name || request.model.id,
      tokensEntrada: await countTokens(request.model, `${system}\n${task}`, token),
      tokensSaida: await countTokens(request.model, output, token),
      duracaoMs: Date.now() - started,
      ok: true,
    });
    return {};
  } catch (err) {
    stream.markdown(`Erro: ${errorMessage(err)}`);
    return { errorDetails: { message: errorMessage(err) } };
  }
}

async function countTokens(model: vscode.LanguageModelChat, text: string, token: vscode.CancellationToken): Promise<number> {
  try {
    return await model.countTokens(text, token);
  } catch {
    return Math.ceil(text.length / 4); // estimativa grosseira quando o modelo não conta
  }
}

/** Projeto citado no pedido (nome ou caminho), para atribuir o consumo. */
function projectHint(state: FenorState, prompt: string): string | undefined {
  const text = prompt.toLowerCase();
  return state.projects.find((p) => text.includes(p.relPath.toLowerCase()) || text.includes(p.name.toLowerCase()))?.relPath;
}
