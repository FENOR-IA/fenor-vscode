import { strict as assert } from 'assert';
import * as path from 'path';
import { test } from 'node:test';
import { buildKitFiles } from '../src/kit/build';
import { eccKitFiles, eccSelection, toCopilotAgent } from '../src/kit/ecc';

const ECC_ROOT = path.join(__dirname, '..', '..', 'ecc');

test('seleciona agentes, skills e regras do ECC pela stack', () => {
  const java = eccSelection({ stack: 'java', framework: 'Spring Boot 3' });
  const laravel = eccSelection({ stack: 'php', framework: 'Laravel 10' });
  const docs = eccSelection({ stack: 'outro' });

  assert.ok(java.agents.includes('java-reviewer') && java.agents.includes('security-reviewer'));
  assert.ok(java.skills.includes('springboot-tdd') && java.skills.includes('verification-loop'));
  assert.deepEqual(java.rules, ['common', 'java']);
  assert.ok(laravel.skills.includes('laravel-tdd'));
  assert.ok(!eccSelection({ stack: 'php', framework: 'Symfony 6' }).skills.includes('laravel-tdd'));
  assert.deepEqual(docs.rules, ['common']);
});

test('gera agentes para Claude Code e Copilot, skills e regras a partir do ECC embutido', async () => {
  const files = await eccKitFiles(ECC_ROOT, eccSelection({ stack: 'java', framework: 'Spring Boot 3' }));
  const paths = new Set(files.map((f) => f.relPath));

  assert.ok(paths.has('.claude/agents/java-reviewer.md'));
  assert.ok(paths.has('.github/agents/java-reviewer.agent.md'));
  assert.ok(paths.has('.claude/skills/springboot-tdd/SKILL.md'));
  assert.ok(paths.has('.claude/skills/security-review/cloud-infrastructure-security.md'));
  assert.ok(paths.has('.fenor/ecc/regras/java/coding-style.md'));
  assert.ok(![...paths].some((p) => p.endsWith('/hooks.md')));
  assert.match(files.find((f) => f.relPath === '.fenor/ecc/LICENSE')?.content ?? '', /MIT License[\s\S]*Affaan Mustafa/);
  assert.ok(files.every((f) => f.kind === 'generated' && f.content.length > 0));
});

test('agente do Copilot mantém o texto e troca o cabeçalho', () => {
  const claude = '---\nname: java-reviewer\ndescription: Expert Java reviewer. MUST BE USED.\ntools: ["Read"]\nmodel: sonnet\n---\n\n## Corpo\nRevise.';

  const copilot = toCopilotAgent(claude, 'java-reviewer');

  assert.equal(copilot, "---\nname: java-reviewer\ndescription: 'Expert Java reviewer. MUST BE USED.'\n---\n\n## Corpo\nRevise.");
});

test('AGENTS.md aponta para os especialistas do ECC da stack', () => {
  const agents = buildKitFiles({ name: 'api', stack: 'java', framework: 'Spring Boot 3' }, {}, '2026-10-04').find((f) => f.relPath === 'AGENTS.md');

  assert.match(agents?.content ?? '', /Especialistas e práticas \(ECC\)/);
  assert.match(agents?.content ?? '', /`\.claude\/agents\/java-reviewer\.md`/);
  assert.match(agents?.content ?? '', /`\.claude\/skills\/springboot-tdd\/SKILL\.md`/);
});
