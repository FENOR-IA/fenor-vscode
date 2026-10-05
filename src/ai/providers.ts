import * as vscode from 'vscode';
import { claudeArgs, CliId, codexArgs, findCli, parseClaudeLine, runCli } from './cli';

export type ProviderId = 'copilot' | CliId;

export interface AiRequest {
  system: string;
  task: string;
  cwd: string;
  token: vscode.CancellationToken;
  onText: (text: string) => void;
  /** Modelo escolhido no chat do Copilot, quando vem do @fenor. */
  copilotModel?: vscode.LanguageModelChat;
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  isAvailable(): Promise<boolean>;
  run(req: AiRequest): Promise<void>;
}

const CLI_TIMEOUT_MS = 15 * 60 * 1000;

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  copilot: 'GitHub Copilot',
  claude: 'Claude Code',
  codex: 'Codex',
};

class CopilotProvider implements AiProvider {
  readonly id = 'copilot' as const;
  readonly label = PROVIDER_LABEL.copilot;

  async isAvailable(): Promise<boolean> {
    return typeof vscode.lm?.selectChatModels === 'function'
      && (await vscode.lm.selectChatModels({ vendor: 'copilot' })).length > 0;
  }

  async run(req: AiRequest): Promise<void> {
    const model = req.copilotModel ?? (await vscode.lm.selectChatModels({ vendor: 'copilot' }))[0];
    if (!model) {
      throw new Error('Nenhum modelo do Copilot disponível. Instale o GitHub Copilot Chat e entre na sua conta.');
    }
    const messages = [vscode.LanguageModelChatMessage.User(req.system), vscode.LanguageModelChatMessage.User(req.task)];
    const response = await model.sendRequest(messages, {}, req.token);
    for await (const chunk of response.text) {
      req.onText(chunk);
    }
  }
}

class CliProvider implements AiProvider {
  constructor(readonly id: CliId, readonly label: string) {}

  private async command(): Promise<string | undefined> {
    const configured = vscode.workspace.getConfiguration('fenor.ai').get<string>(`${this.id}Path`, '').trim();
    return findCli(this.id, configured || undefined);
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(await this.command());
  }

  async run(req: AiRequest): Promise<void> {
    const command = await this.command();
    if (!command) {
      throw new Error(`${this.label} não encontrado. Instale o CLI ou informe o caminho em "fenor.ai.${this.id}Path".`);
    }
    const controller = new AbortController();
    const sub = req.token.onCancellationRequested(() => controller.abort());
    let error: string | undefined;
    let wrote = false;
    try {
      const result = this.id === 'claude'
        ? await runCli(command, claudeArgs(req.system), {
          cwd: req.cwd,
          stdin: req.task,
          signal: controller.signal,
          timeoutMs: CLI_TIMEOUT_MS,
          onStdoutLine: (line) => {
            const event = parseClaudeLine(line);
            if (event.text) {
              req.onText(`${wrote ? '\n\n' : ''}${event.text}`);
              wrote = true;
            }
            error = event.error ?? error;
          },
        })
        : await runCli(command, codexArgs(req.cwd), {
          cwd: req.cwd,
          stdin: `${req.system}\n\n---\n\n${req.task}`,
          signal: controller.signal,
          timeoutMs: CLI_TIMEOUT_MS,
          onStdout: (chunk) => {
            req.onText(chunk);
            wrote = true;
          },
        });
      if (req.token.isCancellationRequested) {
        return;
      }
      if (error || result.code !== 0) {
        throw new Error(error ?? `${this.label} saiu com código ${result.code}. ${lastLines(result.stderr)}`);
      }
      if (!wrote) {
        throw new Error(`${this.label} não devolveu resposta. ${lastLines(result.stderr)}`);
      }
    } finally {
      sub.dispose();
    }
  }
}

function lastLines(text: string): string {
  return text.trim().split('\n').slice(-5).join('\n');
}

export const PROVIDERS: Record<ProviderId, AiProvider> = {
  copilot: new CopilotProvider(),
  claude: new CliProvider('claude', PROVIDER_LABEL.claude),
  codex: new CliProvider('codex', PROVIDER_LABEL.codex),
};

const AUTO_ORDER: ProviderId[] = ['copilot', 'claude', 'codex'];

/** Provedor configurado; em "auto", o primeiro disponível na ordem Copilot → Claude Code → Codex. */
export async function resolveProvider(): Promise<AiProvider | undefined> {
  const configured = vscode.workspace.getConfiguration('fenor.ai').get<string>('provider', 'auto') as ProviderId | 'auto';
  if (configured !== 'auto') {
    return PROVIDERS[configured];
  }
  for (const id of AUTO_ORDER) {
    if (await PROVIDERS[id].isAvailable()) {
      return PROVIDERS[id];
    }
  }
  return undefined;
}

export async function availableProviders(): Promise<ProviderId[]> {
  const checks = await Promise.all(AUTO_ORDER.map(async (id) => ((await PROVIDERS[id].isAvailable()) ? id : undefined)));
  return checks.filter((id): id is ProviderId => Boolean(id));
}
