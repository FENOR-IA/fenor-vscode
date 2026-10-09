# fenor-vscode

Extensão open source (MIT) que leva o método Fenor para o **GitHub Copilot**, em projetos **Java (Spring) e React**,
mais um servidor MCP e um comando `fenor` para o IntelliJ e o terminal. Repo: `FENOR-IA/fenor-vscode`.
Alvo principal: o trabalho do Benhur num banco (Copilot homologado, Azure DevOps na nuvem, VS Code e IntelliJ).

## Decisões de escopo (não reabrir sem pedido)
- **Só Copilot + Java + React** (09/10/2026). Claude Code, Codex e as stacks PHP/Node/Python foram removidos; estão no
  histórico (commit `1b41a7b` e anteriores).
- **Kit vai sempre para o repositório** do projeto, todo em `.github/` + `memory/`. **Nunca sobrescreve arquivo do time:**
  `.fenor/kit.json` lista o que o Fenor gerou; arquivo alheio no mesmo caminho = "conflito", não é tocado.
  Instruções do time têm prioridade sobre as do Fenor.
- **Vault** = repositório separado por sistema (um sistema agrupa vários backs e fronts), configurado no painel Sistemas
  (`.fenor/sistemas.json`).
- **IntelliJ via MCP + CLI**, não plugin Kotlin (só se MCP+CLI não bastarem). Máquinas do banco têm Node.
- Distribuição: Release do GitHub a cada tag (`fenor.vsix` + `fenor-cli.zip`). Marketplace/Open VSX só com os secrets
  `VSCE_PAT` / `OVSX_PAT` (ainda não criados).

## Mapa do código
| Pasta | O quê |
|---|---|
| `src/portfolio/` | scanner (Java/React), git, `.md` (pendências/checklists), situação, relatório |
| `src/kit/` | kit: build (arquivos), apply (plano/manifesto/conflito/pré-visualização), modes, rules, ecc, commands (comandos detectados), verify, memoryFiles |
| `src/copilot/` | ferramentas `fenor_*` (API `vscode.lm`) e instruções na raiz com `applyTo` |
| `src/chat/` | `@fenor` (participante do chat) e tarefas |
| `src/systems/` | painel Sistemas e vault |
| `src/usage/` | registro de uso (JSONL), atividade (git/sessões), painel e relatório |
| `src/cli/` | servidor MCP (sem dependências) e comando `fenor`; empacotado por `scripts/build-cli.js` em `dist/` |
| `ecc/` | cópia do ECC (agentes + skills de Java/React), atualizada por `scripts/atualizar-ecc.sh` |

Tudo fora de `extension.ts`, `state.ts`, `views/`, `*/panel.ts` e `copilot/tools.ts` é puro (sem `vscode`) e testável
com `node --test`. `npm test` compila e roda tudo; `npm run build:cli` gera o `dist/fenor.js`.

## Armadilhas encontradas
- **Webview com CSP por nonce bloqueia atributo `style`** (inclusive `setAttribute('style')`): larguras de barras vão em
  `data-pct` e são aplicadas por script (`el.style.setProperty`), que o CSP permite. `confirm()` não existe em webview.
- **Copilot ignora o `.github` de subpastas** quando a pasta-mãe de vários repos está aberta → instruções geradas na raiz
  com `applyTo: '<projeto>/**'`; prompts/agentes/skills só abrindo o repo. Copilot lê `.claude/agents` e `.claude/skills`
  nativamente — não duplicar agente em `.claude` e `.github`.
- **O VS Code não expõe tokens do Copilot usado diretamente**; o painel de Uso mede só `@fenor` (via `countTokens`) e as
  ferramentas `fenor_*`. Premium requests: cobrança do GitHub.
- **GitHub Actions:** `if: env.X` de um step não enxerga o `env` declarado no próprio step → secrets no `env` do job.
- **`fetch` no extension host não respeita proxy/certificados corporativos** → cliente Azure usa `https.request`.
- Azure DevOps com PAT inválido costuma responder 203/302 (página de login), não 401.
- Prompts gerados em template literal: crases dentro do texto precisam de escape (`\``) — já quebrou o build duas vezes.
- Diff embutido em prompt: usar fence mais longa que a maior sequência de crases do diff (injeção via `.md` alterado).

## Como publicar
1. Subir `version` no `package.json` e registrar no `CHANGELOG.md`.
2. Commit + push no `main` (CI roda testes, `vsce package` e `build:cli`).
3. `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z` → Release com `fenor.vsix` e `fenor-cli.zip`.
   A Action recusa tag diferente da versão do `package.json`.

## Estado e próximos passos (09/10/2026)
- Publicado: **v0.2.0** (Release com `.vsix` e `fenor-cli.zip`).
- Ainda não testado em ambiente real: Copilot chamando as ferramentas no VS Code, agentes/skills aparecendo no seletor,
  MCP dentro do IntelliJ, workspace multi-raiz.
- Fase B incompleta: enriquecer o vault com IA (endpoints, tabelas, integrações reais) e "aplicar vault nos projetos".
- Roadmap restante: rodar sistemas localmente, pedidos/QA, gravar no board, PRs e pipelines do Azure (paridade South System).
- Longo prazo (Fenor Studio): VS Code no navegador (code-server) com esta extensão.
