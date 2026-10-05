import { spawn } from 'child_process';
import { ProjectCommands } from './commands';

export type VerifyStep = 'test' | 'build' | 'lint';

export interface StepResult {
  step: VerifyStep;
  command?: string;
  ok: boolean;
  skipped: boolean;
  code?: number;
  output: string;
  durationMs: number;
}

const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT = 6000;

/** Roda os comandos detectados do projeto (nunca comandos vindos da IA). */
export async function runVerification(
  cwd: string,
  commands: ProjectCommands,
  steps: readonly VerifyStep[],
  signal?: AbortSignal,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of steps) {
    const command = commands[step];
    if (!command) {
      results.push({ step, ok: true, skipped: true, output: 'sem comando detectado para esta etapa', durationMs: 0 });
      continue;
    }
    results.push(await runShell(step, command, cwd, signal));
  }
  return results;
}

function runShell(step: VerifyStep, command: string, cwd: string, signal?: AbortSignal): Promise<StepResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' } });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT * 2);
    };
    const kill = () => child.kill('SIGTERM');
    const timer = setTimeout(kill, STEP_TIMEOUT_MS);
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const finish = (code: number, extra = '') => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      resolve({ step, command, ok: code === 0, skipped: false, code, output: tail(output + extra), durationMs: Date.now() - started });
    };
    child.on('error', (err) => finish(-1, `\n${err.message}`));
    child.on('close', (code) => finish(code ?? -1));
  });
}

function tail(text: string): string {
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '').trim();
  return clean.length > MAX_OUTPUT ? `…\n${clean.slice(-MAX_OUTPUT)}` : clean;
}

export function formatVerification(project: string, results: readonly StepResult[]): string {
  const ran = results.filter((r) => !r.skipped);
  const failed = ran.filter((r) => !r.ok);
  const header = !ran.length
    ? `Projeto ${project}: nenhum comando de verificação detectado. Informe o usuário e combine como verificar.`
    : failed.length
      ? `Projeto ${project}: VERIFICAÇÃO FALHOU em ${failed.map((r) => r.step).join(', ')}. Não declare a tarefa concluída — corrija e verifique de novo.`
      : `Projeto ${project}: verificação OK (${ran.map((r) => r.step).join(', ')}).`;
  const details = results.map((r) => r.skipped
    ? `## ${r.step}: pulado (${r.output})`
    : `## ${r.step}: ${r.ok ? 'OK' : `FALHOU (código ${r.code})`} — \`${r.command}\` em ${Math.round(r.durationMs / 1000)}s\n\`\`\`\n${r.output || '(sem saída)'}\n\`\`\``);
  return [header, ...details].join('\n\n');
}
