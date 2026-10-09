import { appendEvent, UsageEvent } from './log';

/** Ponto único de registro de uso; a pasta é a globalStorage da extensão (fora dos repositórios). */

let usageDir: string | undefined;

export function setUsageDir(dir: string): void {
  usageDir = dir;
}

export function getUsageDir(): string | undefined {
  return usageDir;
}

/** Registra sem nunca quebrar o fluxo principal. */
export function track(event: Omit<UsageEvent, 'ts'>): void {
  if (!usageDir) {
    return;
  }
  void appendEvent(usageDir, { ts: new Date().toISOString(), ...event }).catch(() => undefined);
}
