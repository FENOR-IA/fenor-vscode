// Empacota o comando `fenor` (CLI + servidor MCP) num único arquivo, com o ECC ao lado.
const { build } = require('esbuild');
const { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync } = require('fs');
const path = require('path');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

build({
  entryPoints: [path.join(root, 'src/cli/main.ts')],
  outfile: path.join(dist, 'fenor.js'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  define: { FENOR_VERSION: JSON.stringify(pkg.version) },
  legalComments: 'none',
}).then(() => {
  chmodSync(path.join(dist, 'fenor.js'), 0o755);
  cpSync(path.join(root, 'ecc'), path.join(dist, 'ecc'), { recursive: true });
  cpSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));
  writeFileSync(path.join(dist, 'LEIAME.txt'), [
    `Fenor ${pkg.version} — comando de terminal e servidor MCP (Node 18+).`,
    '',
    'node fenor.js ajuda        lista os comandos',
    'node fenor.js intellij     mostra a configuração para o Copilot do IntelliJ',
    '',
    'Mantenha a pasta ecc/ ao lado do fenor.js (agentes e skills do kit).',
    '',
  ].join('\n'));
  console.log(`dist/fenor.js ${pkg.version} pronto.`);
});
