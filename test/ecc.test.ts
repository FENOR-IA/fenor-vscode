import { strict as assert } from 'assert';
import * as path from 'path';
import { test } from 'node:test';
import { copilotInstructions } from '../src/kit/build';
import { eccKitFiles, eccSelection, toCopilotAgent } from '../src/kit/ecc';

const ECC_ROOT = path.join(__dirname, '..', '..', 'ecc');

test('seleciona agentes e skills do ECC por stack', () => {
  const java = eccSelection({ stack: 'java' });
  const react = eccSelection({ stack: 'react' });

  assert.ok(java.agents.includes('java-reviewer') && java.agents.includes('security-reviewer'));
  assert.ok(java.skills.includes('springboot-tdd') && java.skills.includes('verification-loop'));
  assert.ok(react.agents.includes('react-reviewer') && !react.agents.includes('java-reviewer'));
  assert.ok(react.skills.includes('react-testing'));
});

test('instala agentes e skills no formato do Copilot (.github)', async () => {
  const files = await eccKitFiles(ECC_ROOT, eccSelection({ stack: 'java' }));
  const paths = new Set(files.map((f) => f.relPath));

  assert.ok(paths.has('.github/agents/java-reviewer.agent.md'));
  assert.ok(paths.has('.github/skills/springboot-tdd/SKILL.md'));
  assert.ok(paths.has('.github/skills/security-review/cloud-infrastructure-security.md'));
  assert.ok(![...paths].some((p) => p.startsWith('.claude/')));
  assert.match(files.find((f) => f.relPath === '.github/ECC-LICENSE')?.content ?? '', /MIT License[\s\S]*Affaan Mustafa/);
  assert.ok(files.every((f) => f.kind === 'generated' && f.content.length > 0));
});

test('agente do Copilot mantém o texto, troca o cabeçalho e credita o ECC', () => {
  const claude = '---\nname: java-reviewer\ndescription: Expert Java reviewer. MUST BE USED.\ntools: ["Read"]\nmodel: sonnet\n---\n\n## Corpo\nRevise.';

  const copilot = toCopilotAgent(claude, 'java-reviewer');

  assert.ok(copilot.startsWith("---\nname: java-reviewer\ndescription: 'Expert Java reviewer. MUST BE USED.'\n---\n\n<!-- Do ECC"));
  assert.ok(copilot.endsWith('## Corpo\nRevise.'));
  assert.doesNotMatch(copilot, /tools:|model:/);
});

test('instruções do Copilot apontam os especialistas e dão prioridade ao time', () => {
  const text = copilotInstructions({ name: 'api', stack: 'java' }, { test: './mvnw test' });

  assert.match(text, /`java-reviewer`/);
  assert.match(text, /`springboot-tdd`/);
  assert.match(text, /instruções do time[\s\S]*têm prioridade/);
  assert.match(text, /#fenor_verificar/);
  assert.match(text, /`\/fenor-corrigir`/);
});
