import * as https from 'https';

export interface AzureConfig {
  organization: string;
  project: string;
  team?: string;
  pat: string;
}

export interface WorkItem {
  id: number;
  project: string;
  title: string;
  type: string;
  state: string;
  assignedTo?: string;
  storyPoints?: number;
  remainingWork?: number;
  description?: string;
  acceptanceCriteria?: string;
  changedDate: string;
  tags: string[];
  url: string;
}

export interface Sprint {
  name: string;
  path: string;
  startDate?: string;
  finishDate?: string;
}

const API_VERSION = '7.1';
const REQUEST_TIMEOUT_MS = 20000;
const BATCH_SIZE = 200;
const FIELDS = [
  'System.Id', 'System.TeamProject', 'System.Title', 'System.WorkItemType', 'System.State', 'System.AssignedTo',
  'System.ChangedDate', 'System.Tags', 'System.Description',
  'Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort',
  'Microsoft.VSTS.Scheduling.RemainingWork', 'Microsoft.VSTS.Common.AcceptanceCriteria',
];

export class AzureError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Cliente mínimo da API REST do Azure DevOps (nuvem), autenticado por PAT. */
export class AzureDevOpsClient {
  private readonly base: string;

  constructor(private readonly config: AzureConfig, private readonly transport: Transport = httpsTransport) {
    this.base = `https://dev.azure.com/${encodeURIComponent(config.organization)}`;
  }

  private get projectUrl(): string {
    return `${this.base}/${encodeURIComponent(this.config.project)}`;
  }

  private get teamUrl(): string {
    return this.config.team ? `${this.projectUrl}/${encodeURIComponent(this.config.team)}` : this.projectUrl;
  }

  private async request<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const sep = url.includes('?') ? '&' : '?';
    let res: HttpResponse;
    try {
      res = await this.transport({
        url: `${url}${sep}api-version=${API_VERSION}`,
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`:${this.config.pat}`).toString('base64')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (err) {
      throw new AzureError(`Sem conexão com o Azure DevOps: ${networkMessage(err)}`);
    }
    // PAT inválido costuma responder 203/302 com a página de login em vez de 401.
    if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400)) {
      throw new AzureError('Token (PAT) inválido ou expirado. Rode "Fenor: Conectar Azure DevOps" de novo.', 401);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new AzureError(`Azure DevOps respondeu ${res.status}: ${safeMessage(res.body) ?? 'erro sem detalhe'}`, res.status);
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new AzureError('Resposta inesperada do Azure DevOps (não é JSON).', res.status);
    }
  }

  async getCurrentSprint(): Promise<Sprint | null> {
    const data = await this.request<{ value: Array<{ name: string; path: string; attributes?: { startDate?: string; finishDate?: string } }> }>(
      `${this.teamUrl}/_apis/work/teamsettings/iterations?$timeframe=current`,
    );
    const it = data.value?.[0];
    return it ? { name: it.name, path: it.path, startDate: it.attributes?.startDate, finishDate: it.attributes?.finishDate } : null;
  }

  /** Itens do sprint atual; sem sprint configurado, os itens abertos alterados nos últimos 30 dias. */
  async getSprintWorkItems(sprint: Sprint | null): Promise<WorkItem[]> {
    const where = sprint
      ? `[System.IterationPath] UNDER '${escapeWiql(sprint.path)}'`
      : `[System.State] NOT IN ('Closed', 'Done', 'Removed', 'Concluído', 'Fechado') AND [System.ChangedDate] >= @Today - 30`;
    const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ${where} ORDER BY [System.ChangedDate] DESC`;
    const result = await this.request<{ workItems: Array<{ id: number }> }>(`${this.projectUrl}/_apis/wit/wiql?$top=500`, {
      method: 'POST',
      body: { query },
    });
    const ids = (result.workItems ?? []).map((w) => w.id);
    return this.getWorkItems(ids);
  }

  async getWorkItems(ids: number[]): Promise<WorkItem[]> {
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      batches.push(ids.slice(i, i + BATCH_SIZE));
    }
    const responses = await Promise.all(batches.map((batch) =>
      this.request<{ value: RawWorkItem[] }>(`${this.projectUrl}/_apis/wit/workitemsbatch`, {
        method: 'POST',
        body: { ids: batch, fields: FIELDS, errorPolicy: 'omit' },
      })));
    return responses.flatMap((r) => r.value ?? []).filter(Boolean).map((raw) => this.toWorkItem(raw));
  }

  /** Item pelo id, só se pertencer ao projeto configurado (o batch aceita ids de toda a organização). */
  async getWorkItem(id: number): Promise<WorkItem | undefined> {
    const item = (await this.getWorkItems([id]))[0];
    return item && item.project.toLowerCase() === this.config.project.toLowerCase() ? item : undefined;
  }

  webUrl(id: number): string {
    return `${this.projectUrl}/_workitems/edit/${id}`;
  }

  private toWorkItem(raw: RawWorkItem): WorkItem {
    const f = raw.fields ?? {};
    const assigned = f['System.AssignedTo'] as { displayName?: string } | string | undefined;
    return {
      id: raw.id,
      project: String(f['System.TeamProject'] ?? ''),
      title: String(f['System.Title'] ?? ''),
      type: String(f['System.WorkItemType'] ?? ''),
      state: String(f['System.State'] ?? ''),
      assignedTo: typeof assigned === 'string' ? assigned : assigned?.displayName,
      storyPoints: numberOrUndefined(f['Microsoft.VSTS.Scheduling.StoryPoints'] ?? f['Microsoft.VSTS.Scheduling.Effort']),
      remainingWork: numberOrUndefined(f['Microsoft.VSTS.Scheduling.RemainingWork']),
      description: stripHtml(f['System.Description']),
      acceptanceCriteria: stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria']),
      changedDate: String(f['System.ChangedDate'] ?? ''),
      tags: String(f['System.Tags'] ?? '').split(';').map((t) => t.trim()).filter(Boolean),
      url: this.webUrl(raw.id),
    };
  }
}

interface RawWorkItem {
  id: number;
  fields?: Record<string, unknown>;
}

/** Aceita "minha-org" ou a URL inteira "https://dev.azure.com/minha-org/MeuProjeto". */
export function parseAzureInput(input: string): { organization: string; project?: string } {
  const trimmed = input.trim().replace(/\/+$/, '');
  const match = /dev\.azure\.com\/([^/]+)(?:\/([^/?#]+))?/i.exec(trimmed)
    ?? /^https?:\/\/([^.]+)\.visualstudio\.com(?:\/([^/?#]+))?/i.exec(trimmed);
  if (match) {
    return { organization: decodeURIComponent(match[1]), project: match[2] ? decodeURIComponent(match[2]) : undefined };
  }
  return { organization: trimmed };
}

export function escapeWiql(value: string): string {
  return value.replace(/'/g, "''");
}

export function stripHtml(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message;
  } catch {
    return undefined;
  }
}

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

/**
 * Usa o módulo https do Node (e não fetch) porque o VS Code o ajusta para respeitar
 * http.proxy e os certificados do sistema — necessário em redes corporativas.
 */
export const httpsTransport: Transport = (req) => new Promise((resolve, reject) => {
  const r = https.request(req.url, { method: req.method, headers: req.headers, timeout: req.timeoutMs }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    res.on('error', reject);
  });
  r.on('timeout', () => r.destroy(new Error(`tempo esgotado após ${req.timeoutMs / 1000}s`)));
  r.on('error', reject);
  if (req.body) {
    r.write(req.body);
  }
  r.end();
});

function networkMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const code = (err as NodeJS.ErrnoException).code;
  const hints: Record<string, string> = {
    ENOTFOUND: 'endereço não encontrado (DNS ou proxy)',
    ECONNREFUSED: 'conexão recusada',
    ECONNRESET: 'conexão interrompida (proxy?)',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'certificado não reconhecido (inspeção TLS corporativa?)',
    SELF_SIGNED_CERT_IN_CHAIN: 'certificado não reconhecido (inspeção TLS corporativa?)',
  };
  return code && hints[code] ? `${hints[code]} [${code}]` : err.message;
}
