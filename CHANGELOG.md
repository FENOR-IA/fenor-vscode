# Changelog

## 0.2.0 — 2026-10-09

IntelliJ e terminal.

- **Servidor MCP do Fenor** (`fenor-cli.zip`): `fenor_projetos`, `fenor_contexto`, `fenor_verificar`, `fenor_salvar_sessao` e `fenor_situacao` no Copilot do IntelliJ (e de qualquer IDE com MCP). Sem dependências; detecta a pasta aberta na IDE.
- **Comando `fenor`** no terminal: `projetos`, `kit [--aplicar]`, `situacao`, `uso --dias N` e `intellij` (configuração pronta para colar no Copilot).
- **Painel de Uso** soma também o uso registrado pelo MCP (`~/.fenor/`).
- Verificação sem comandos detectados não conta mais como reprovada.

## 0.1.0 — 2026-10-09

Primeira versão: o método Fenor dentro do GitHub Copilot, para projetos Java (Spring) e React.

- **Portfólio:** projetos Java e React da pasta aberta, situação de cada um (git e documentos `.md`), pendências e relatório.
- **Azure DevOps:** sprint atual, alertas, carga do time, commits ligados a work items (`AB#123`).
- **Kit Fenor no formato do Copilot:** instruções (bloco marcado em `.github/copilot-instructions.md`), regras por tipo de arquivo, modos `/fenor-planejar`, `/fenor-executar`, `/fenor-revisar`, `/fenor-corrigir`, `/fenor-feature`, `/fenor-salvar-sessao`, agentes e skills do ECC, e memória do projeto em `memory/`. Nunca sobrescreve arquivos do time; pré-visualização antes de aplicar.
- **Ferramentas para o Copilot:** `#fenor_contexto`, `#fenor_verificar` (roda testes, build e lint detectados) e `#fenor_salvar_sessao`.
- **@fenor no chat:** `/situacao`, `/board`, `/planejar`, `/testes`, `/revisar`, `/portfolio`.
- **Sistemas e vault:** painel para agrupar projetos (front, back, API…) e gerar um vault estilo Obsidian como repositório próprio.
- **Uso e atividade:** tokens consumidos pelo Fenor, onde foram gastos, o que você fez no período, relatório em Markdown e CSV.
