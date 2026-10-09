import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Registro de uso do Fenor (local, por usuário, fora dos repositórios).
 * Só o que passa pelo Fenor é medido: o VS Code não expõe o consumo do Copilot usado diretamente.
 */

export type UsageKind = 'chat' | 'ferramenta' | 'verificacao' | 'kit' | 'modo' | 'vault' | 'relatorio';

export interface UsageEvent {
  ts: string;
  tipo: UsageKind;
  projeto?: string;
  comando?: string;
  modelo?: string;
  tokensEntrada?: number;
  tokensSaida?: number;
  duracaoMs?: number;
  ok?: boolean;
  detalhe?: string;
}

export const USAGE_FILE = 'uso.jsonl';

export async function appendEvent(dir: string, event: UsageEvent): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, USAGE_FILE), `${JSON.stringify(event)}\n`, 'utf8');
}

export async function readEvents(dir: string, from: Date, to: Date): Promise<UsageEvent[]> {
  const raw = await fs.readFile(path.join(dir, USAGE_FILE), 'utf8').catch(() => '');
  const start = from.getTime();
  const end = to.getTime();
  return raw.split('\n').flatMap((line): UsageEvent[] => {
    if (!line.trim()) {
      return [];
    }
    try {
      const e = JSON.parse(line) as UsageEvent;
      const t = Date.parse(e.ts);
      return Number.isFinite(t) && t >= start && t <= end ? [e] : [];
    } catch {
      return [];
    }
  });
}

export interface Breakdown {
  chave: string;
  eventos: number;
  tokens: number;
}

export interface UsageSummary {
  pedidosChat: number;
  tokensEntrada: number;
  tokensSaida: number;
  chamadasFerramentas: number;
  verificacoes: { ok: number; falha: number };
  porDia: Array<{ dia: string; tokens: number; eventos: number }>;
  porProjeto: Breakdown[];
  porComando: Breakdown[];
  porModelo: Breakdown[];
}

export function summarizeUsage(events: readonly UsageEvent[], from: Date, to: Date): UsageSummary {
  const tokens = (e: UsageEvent) => (e.tokensEntrada ?? 0) + (e.tokensSaida ?? 0);
  const chat = events.filter((e) => e.tipo === 'chat');
  const verif = events.filter((e) => e.tipo === 'verificacao');
  return {
    pedidosChat: chat.length,
    tokensEntrada: chat.reduce((s, e) => s + (e.tokensEntrada ?? 0), 0),
    tokensSaida: chat.reduce((s, e) => s + (e.tokensSaida ?? 0), 0),
    chamadasFerramentas: events.filter((e) => e.tipo === 'ferramenta' || e.tipo === 'verificacao').length,
    verificacoes: { ok: verif.filter((e) => e.ok).length, falha: verif.filter((e) => e.ok === false).length },
    porDia: days(from, to).map((dia) => {
      const doDia = events.filter((e) => e.ts.slice(0, 10) === dia);
      return { dia, tokens: doDia.reduce((s, e) => s + tokens(e), 0), eventos: doDia.length };
    }),
    porProjeto: breakdown(events, (e) => e.projeto ?? '(sem projeto)', tokens),
    porComando: breakdown(events, (e) => `${e.tipo}${e.comando ? `: ${e.comando}` : ''}`, tokens),
    porModelo: breakdown(chat, (e) => e.modelo ?? '(desconhecido)', tokens),
  };
}

function breakdown(events: readonly UsageEvent[], key: (e: UsageEvent) => string, tokens: (e: UsageEvent) => number): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const e of events) {
    const k = key(e);
    const prev = map.get(k) ?? { chave: k, eventos: 0, tokens: 0 };
    map.set(k, { chave: k, eventos: prev.eventos + 1, tokens: prev.tokens + tokens(e) });
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens || b.eventos - a.eventos);
}

/** Dias (AAAA-MM-DD, UTC) entre as datas, inclusive. */
export function days(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (d.getTime() <= to.getTime() && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const CSV_COLUMNS: Array<keyof UsageEvent> = ['ts', 'tipo', 'projeto', 'comando', 'modelo', 'tokensEntrada', 'tokensSaida', 'duracaoMs', 'ok', 'detalhe'];

export function eventsToCsv(events: readonly UsageEvent[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(','), ...events.map((e) => CSV_COLUMNS.map((c) => cell(e[c])).join(','))].join('\n') + '\n';
}
