# Fenor para VS Code

Abra o VS Code na pasta que reúne seus projetos e o Fenor organiza tudo num lugar só:
projetos **Java, React, PHP (Symfony, Laravel, apps Fenor), Node e Python**, a **situação** de cada
um (lida do git e dos `.md`), o **sprint do Azure DevOps** e um assistente de IA que planeja, cria
plano de testes e revisa código — funcionando igual com **GitHub Copilot, Claude Code ou Codex**.

## IA: Copilot, Claude Code ou Codex

| IA | Como o Fenor usa | Requisito |
|---|---|---|
| GitHub Copilot | API de modelos do VS Code; também o `@fenor` no chat | extensão GitHub Copilot Chat |
| Claude Code | `claude -p`, só ferramentas de leitura (Read, Grep, Glob) | CLI `claude` instalado e logado |
| Codex | `codex exec`, sandbox padrão só leitura | CLI `codex` instalado e logado |

Escolha em **Fenor: Escolher IA** ou clicando em `✨ Fenor: …` na barra de status (padrão: automático).
Os comandos **Fenor IA: …** (situação, sprint, planejar, testes, revisar, portfólio) e **Fenor: Perguntar à IA…**
funcionam com qualquer uma; a resposta é gravada em `.fenor/respostas/` e aberta em pré-visualização.

## Kit Fenor: o método que reduz erro

**Fenor: Aplicar kit Fenor nos projetos** grava em cada projeto (pronto para commit):

| O quê | Onde | Para quem |
|---|---|---|
| Memória estruturada (plano, próximo passo, feito, bloqueios, regras de negócio, armadilhas, decisões, sessões) | `memory/` — nunca sobrescrita | todas as IAs |
| Modos: Planejar, Executar, Revisar, Corrigir defeito, Nova feature, Salvar sessão | `.fenor/modos/` | todas |
| Regras da stack (comum, segurança, testes, Java/Spring, React, PHP, Symfony, Laravel, PHP 7.4) | `.fenor/regras/` | todas |
| Instruções + comandos de verificação detectados | `AGENTS.md` (bloco marcado) | Codex, Copilot |
| Instruções | `CLAUDE.md` (bloco marcado, importa o AGENTS.md) | Claude Code |
| Instruções | `.github/copilot-instructions.md` (bloco marcado) | Copilot |
| Comandos `/fenor-planejar` … `/fenor-salvar-sessao` | `.claude/commands/`, `.github/prompts/` | Claude Code, Copilot |

**Fenor: Abrir modo de trabalho** (ou ▶ ao lado do projeto) abre o modo escolhido com a IA escolhida:
Claude Code e Codex num terminal dentro do projeto; Copilot no chat em modo agente. Planejar e Revisar
são só leitura. O método vem do Fenor Studio e das regras/orquestradores do [ECC](https://github.com/affaan-m/ECC) (MIT).

Gratuito e open source (MIT).

## O que tem na v0.1

| Recurso | Onde |
|---|---|
| Portfólio: todos os projetos da pasta, stack e versões, branch, arquivos modificados, nº de testes, último commit | Barra lateral **Fenor → Projetos** |
| Sprint do Azure DevOps por status, com alertas (sem critério de aceite, sem responsável, parado, grande demais) | **Fenor → Sprint** |
| Painel: indicadores, kanban do sprint, alertas, carga do time, tabela de projetos, commits ligados a work items (`AB#123`) | Comando **Fenor: Abrir painel** |
| `@fenor /board` — análise do sprint e sugestão de organização | Chat do Copilot |
| `@fenor /planejar 1234` — plano de implementação do work item | Chat do Copilot |
| `@fenor /testes 1234` — plano de QA com cenários e cURL | Chat do Copilot |
| `@fenor /revisar projeto` — revisão das mudanças não commitadas | Chat do Copilot |
| `@fenor /portfolio` — resumo e padronização dos projetos | Chat do Copilot |
| Memória do time (`.fenor/memoria.md`), lida pelo @fenor | Comando **Fenor: Abrir memória do workspace** |

## Segurança e privacidade

- A IA é o **GitHub Copilot** que você já usa, via API oficial do VS Code. A extensão não tem chave de IA própria.
- A única conexão de rede é com o **Azure DevOps** (`dev.azure.com`) da sua organização.
- O token pessoal (PAT) fica no **cofre do VS Code** (SecretStorage), nunca em arquivo ou setting.
- Nenhuma telemetria. Nada é gravado no board: as sugestões aparecem só no chat.

## Instalação local

```bash
npm install
npm test            # compila e roda os testes
npx vsce package    # gera fenor-0.1.0.vsix
code --install-extension fenor-0.1.0.vsix
```

Requer VS Code 1.95+ e, para o @fenor, a extensão GitHub Copilot Chat.

## Conectar ao Azure DevOps

1. No Azure DevOps: **User settings → Personal access tokens → New token**, escopo **Work Items: Read**.
2. No VS Code: **Fenor: Conectar Azure DevOps** e cole a URL do projeto (`https://dev.azure.com/org/Projeto`) e o token.

O sprint exibido é o atual do time padrão do projeto. Para outro time, ajuste `fenor.azure.team`.

## Demonstração sem Azure

```bash
scripts/criar-demo.sh          # cria ~/fenor-demo com projetos Java, React e Symfony
code ~/fenor-demo
```

## Commits ligados ao board

Cite o work item na mensagem de commit com `AB#1234` (padrão do Azure Boards). O painel liga o
commit ao item do sprint.

## Próximas fases

1. Geração e execução de testes por projeto (JUnit, Vitest/Jest, PHPUnit)
2. Mapa de serviços (endpoints Spring/Symfony e chamadas do React) e geração de cURL / `.http`
3. Fluxo por história: planejar → executar → testar → revisar → PR
4. Gravar no board (quebrar histórias, critérios de aceite), sempre com confirmação
