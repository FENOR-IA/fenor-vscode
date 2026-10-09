import * as path from 'path';
import * as vscode from 'vscode';
import { detectCommands } from '../kit/commands';
import { buildProjectContext, saveSession, SessionInput } from '../kit/memoryFiles';
import { formatVerification, runVerification, VerifyStep } from '../kit/verify';
import { FenorState, ProjectWithGit } from '../state';
import { track } from '../usage/tracker';

/**
 * Ferramentas que o Copilot (modo agente) pode chamar — o que garante o acerto do método Fenor:
 * memória lida sempre, verificação obrigatória e sessão salva no fim.
 */

interface ProjectInput {
  projeto?: string;
}

interface VerifyInput extends ProjectInput {
  etapas?: VerifyStep[];
}

const ALL_STEPS: VerifyStep[] = ['test', 'build', 'lint'];

export function registerCopilotTools(context: vscode.ExtensionContext, state: FenorState): void {
  if (typeof vscode.lm?.registerTool !== 'function') {
    return;
  }
  context.subscriptions.push(
    vscode.lm.registerTool<ProjectInput>('fenor_contexto', {
      async invoke(options) {
        const project = await resolveProject(state, options.input.projeto);
        track({ tipo: 'ferramenta', comando: 'fenor_contexto', projeto: project.relPath, ok: true });
        return text(await buildProjectContext(project.path, project.name));
      },
    }),
    vscode.lm.registerTool<VerifyInput>('fenor_verificar', {
      async prepareInvocation(options) {
        const project = await resolveProject(state, options.input.projeto);
        const commands = await detectCommands(project);
        const steps = pickSteps(options.input.etapas);
        const list = steps.map((s) => commands[s]).filter(Boolean).map((c) => `\`${c}\``).join(', ') || 'nenhum comando detectado';
        return {
          invocationMessage: `Verificando ${project.name}…`,
          confirmationMessages: { title: `Rodar a verificação de ${project.name}?`, message: new vscode.MarkdownString(`Comandos detectados pelo Fenor: ${list}`) },
        };
      },
      async invoke(options, token) {
        const project = await resolveProject(state, options.input.projeto);
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => controller.abort());
        try {
          const started = Date.now();
          const results = await runVerification(project.path, await detectCommands(project), pickSteps(options.input.etapas), controller.signal);
          const ran = results.filter((r) => !r.skipped);
          track({ tipo: 'verificacao', comando: 'fenor_verificar', projeto: project.relPath, ok: ran.length ? ran.every((r) => r.ok) : undefined, duracaoMs: Date.now() - started, detalhe: ran.map((r) => `${r.step}:${r.ok ? 'ok' : 'falhou'}`).join(' ') });
          return text(formatVerification(project.name, results));
        } finally {
          sub.dispose();
        }
      },
    }),
    vscode.lm.registerTool<ProjectInput & SessionInput>('fenor_salvar_sessao', {
      async prepareInvocation(options) {
        const project = await resolveProject(state, options.input.projeto);
        return { invocationMessage: `Salvando a sessão em ${project.name}/memory…` };
      },
      async invoke(options) {
        const project = await resolveProject(state, options.input.projeto);
        const input = options.input;
        if (!input.assunto || !Array.isArray(input.feito) || !input.proximo) {
          throw new Error('Informe assunto, feito (lista) e proximo.');
        }
        const written = await saveSession(project.path, input, new Date());
        track({ tipo: 'ferramenta', comando: 'fenor_salvar_sessao', projeto: project.relPath, ok: true, detalhe: input.assunto });
        return text(`Sessão salva em ${project.name}: ${written.join(', ')}.`);
      },
    }),
  );
}

function pickSteps(steps: unknown): VerifyStep[] {
  const valid = Array.isArray(steps) ? steps.filter((s): s is VerifyStep => ALL_STEPS.includes(s)) : [];
  return valid.length ? valid : ALL_STEPS;
}

/** Projeto pelo nome/caminho informado, pelo arquivo aberto ou, se houver só um, o único. */
async function resolveProject(state: FenorState, wanted?: string): Promise<ProjectWithGit> {
  if (!state.projects.length) {
    await state.refreshProjects();
  }
  const projects = state.projects;
  const key = wanted?.trim().toLowerCase().replace(/\/+$/, '');
  if (key) {
    const found = projects.find((p) => p.name.toLowerCase() === key || p.relPath.toLowerCase() === key)
      ?? projects.find((p) => p.relPath.toLowerCase().endsWith(`/${key}`));
    if (found) {
      return found;
    }
  }
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const byEditor = active
    ? [...projects].filter((p) => active.startsWith(p.path + path.sep)).sort((a, b) => b.path.length - a.path.length)[0]
    : undefined;
  if (byEditor && !key) {
    return byEditor;
  }
  if (projects.length === 1) {
    return projects[0];
  }
  throw new Error(`${key ? `Projeto "${wanted}" não encontrado. ` : 'Informe o projeto. '}Projetos: ${projects.map((p) => p.relPath).join(', ')}`);
}

function text(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}
