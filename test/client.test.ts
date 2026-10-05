import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { AzureDevOpsClient, AzureError, Transport } from '../src/azure/client';
import { getGitInfo, getWorkingDiff } from '../src/portfolio/git';

interface Call { url: string; method: string; body?: unknown; auth?: string }

function mockTransport(routes: Array<[RegExp, number, unknown]>, calls: Call[]): Transport {
  return async (req) => {
    calls.push({ url: req.url, method: req.method, body: req.body ? JSON.parse(req.body) : undefined, auth: req.headers.Authorization });
    const route = routes.find(([re]) => re.test(req.url));
    const [, status, body] = route ?? [/./, 404, { message: 'not found' }];
    return { status, body: status === 203 ? '<html>login</html>' : JSON.stringify(body) };
  };
}

const CONFIG = { organization: 'banco x', project: 'Cartões', pat: 'segredo' };
const clientWith = (routes: Array<[RegExp, number, unknown]>, calls: Call[] = []) =>
  new AzureDevOpsClient(CONFIG, mockTransport(routes, calls));

test('lê o sprint atual e os itens com os campos mapeados', async () => {
  const calls: Call[] = [];
  const client = clientWith([
    [/teamsettings\/iterations/, 200, { value: [{ name: 'Sprint 42', path: "Cartões\\Sprint 42", attributes: { startDate: '2026-09-29' } }] }],
    [/wit\/wiql/, 200, { workItems: [{ id: 7 }, { id: 8 }] }],
    [/workitemsbatch/, 200, { value: [
      { id: 7, fields: { 'System.TeamProject': 'Cartões', 'System.Title': 'Extrato', 'System.WorkItemType': 'User Story', 'System.State': 'Active', 'System.AssignedTo': { displayName: 'Ana' }, 'Microsoft.VSTS.Scheduling.StoryPoints': 5, 'System.Tags': 'pix; mobile', 'Microsoft.VSTS.Common.AcceptanceCriteria': '<p>Dado que</p>', 'System.ChangedDate': '2026-10-01' } },
      { id: 8, fields: { 'System.Title': 'Bug', 'System.WorkItemType': 'Bug', 'System.State': 'New' } },
    ] }],
  ], calls);

  const sprint = await client.getCurrentSprint();
  const items = await client.getSprintWorkItems(sprint);

  assert.equal(sprint?.name, 'Sprint 42');
  assert.equal(calls[0].url, 'https://dev.azure.com/banco%20x/Cart%C3%B5es/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1');
  assert.equal(calls[0].auth, `Basic ${Buffer.from(':segredo').toString('base64')}`);
  assert.match((calls[1].body as { query: string }).query, /\[System\.IterationPath\] UNDER 'Cartões\\Sprint 42'/);
  assert.deepEqual((calls[2].body as { ids: number[] }).ids, [7, 8]);
  assert.deepEqual(items[0], {
    id: 7, project: 'Cartões', title: 'Extrato', type: 'User Story', state: 'Active', assignedTo: 'Ana', storyPoints: 5, remainingWork: undefined,
    description: undefined, acceptanceCriteria: 'Dado que', changedDate: '2026-10-01', tags: ['pix', 'mobile'],
    url: 'https://dev.azure.com/banco%20x/Cart%C3%B5es/_workitems/edit/7',
  });
  assert.equal(items[1].assignedTo, undefined);
});

test('sem sprint, busca itens abertos recentes', async () => {
  const calls: Call[] = [];
  const client = clientWith([[/wit\/wiql/, 200, { workItems: [] }]], calls);

  const items = await client.getSprintWorkItems(null);

  assert.deepEqual(items, []);
  assert.match((calls[0].body as { query: string }).query, /@Today - 30/);
  assert.equal(calls.length, 1);
});

test('PAT inválido vira erro claro (Azure responde 203 com página de login)', async () => {
  const client = clientWith([[/./, 203, null]]);

  await assert.rejects(client.getCurrentSprint(), (err: unknown) => err instanceof AzureError && err.status === 401 && /PAT/.test(err.message));
});

test('erro da API traz a mensagem do Azure', async () => {
  const client = clientWith([[/./, 404, { message: 'Projeto não existe' }]]);

  await assert.rejects(client.getCurrentSprint(), /404: Projeto não existe/);
});

test('falha de rede vira erro legível', async () => {
  const err = Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  const client = new AzureDevOpsClient(CONFIG, async () => { throw err; });

  await assert.rejects(client.getCurrentSprint(), /Sem conexão com o Azure DevOps: certificado não reconhecido/);
});

test('getWorkItem ignora itens de outro projeto da organização', async () => {
  const client = clientWith([[/workitemsbatch/, 200, { value: [{ id: 9, fields: { 'System.TeamProject': 'Outro', 'System.Title': 'X' } }] }]]);

  assert.equal(await client.getWorkItem(9), undefined);
});

test('lê branch, commits do projeto e arquivos modificados no git', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-git-'));
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q');
  run('symbolic-ref', 'HEAD', 'refs/heads/main');
  run('config', 'user.email', 't@t');
  run('config', 'user.name', 'Teste');
  await fs.mkdir(path.join(repo, 'api'));
  await fs.writeFile(path.join(repo, 'api', 'a.txt'), '1');
  await fs.writeFile(path.join(repo, 'outro.txt'), '1');
  run('add', '.');
  run('commit', '-qm', 'feat: api AB#5');
  await fs.writeFile(path.join(repo, 'api', 'a.txt'), '2');

  const info = await getGitInfo(path.join(repo, 'api'));
  const diff = await getWorkingDiff(path.join(repo, 'api'));

  assert.equal(info.branch, 'main');
  assert.equal(info.commits.length, 1);
  assert.deepEqual(info.commits[0].workItemIds, [5]);
  assert.equal(info.dirtyFiles, 1);
  assert.match(diff, /^\+2$/m);
});

test('pasta sem git não quebra', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-nogit-'));

  const info = await getGitInfo(dir);

  assert.deepEqual(info, { branch: undefined, commits: [], dirtyFiles: 0 });
});
