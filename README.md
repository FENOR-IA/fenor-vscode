# Fenor para VS Code

O método Fenor dentro do **GitHub Copilot**, para projetos **Java (Spring)** e **React**.

Abra a pasta dos seus projetos e o Fenor:

- mostra todos os projetos, a situação de cada um (git e documentos) e o sprint do **Azure DevOps**;
- instala em cada projeto um **kit** que faz o Copilot trabalhar com método: lê a memória do projeto antes de agir, segue as regras da stack, usa revisores especialistas e **não diz que terminou com teste quebrado**;
- organiza os projetos em **sistemas** (front, back, API…) e gera um **vault** estilo Obsidian para cada sistema.

Gratuito e open source (MIT).

## Como usar

1. **Barra lateral Fenor → Projetos:** os projetos Java e React aparecem com a situação de cada um.
2. **Aplicar o kit:** botão direito no projeto → **Aplicar kit Fenor**. Antes de gravar você vê a pré-visualização arquivo por arquivo.
3. **Trabalhar no chat do Copilot:**
   - `/fenor-planejar`, `/fenor-executar`, `/fenor-revisar`, `/fenor-corrigir`, `/fenor-feature`, `/fenor-salvar-sessao`
   - `@fenor /situacao`, `@fenor /board`, `@fenor /planejar 1234`, `@fenor /testes 1234`, `@fenor /revisar`
   - ou o botão ▶ ao lado do projeto, que escolhe o modo e o work item por você.

## O que o kit grava no projeto

Tudo no formato nativo do Copilot, pronto para commit:

| Onde | O quê |
|---|---|
| `.github/copilot-instructions.md` | Método Fenor, comandos de verificação do projeto, modos — num **bloco marcado** (o resto do arquivo é do time) |
| `.github/instructions/fenor-*.instructions.md` | Regras comuns, de segurança, de testes e da stack, aplicadas pelo tipo de arquivo |
| `.github/prompts/fenor-*.prompt.md` | Os modos `/fenor-…` |
| `.github/agents/`, `.github/skills/` | Revisores e práticas do [ECC](https://github.com/affaan-m/ECC) (MIT): `java-reviewer`, `react-reviewer`, `security-reviewer`, `springboot-tdd`, `verification-loop`… |
| `memory/` | Memória do projeto: plano, próximo passo, armadilhas, regras de negócio, decisões, sessões |

**Projeto que já tem instruções do Copilot:** nada do time é sobrescrito. O `copilot-instructions.md` ganha só o bloco do Fenor; arquivo do time com o mesmo nome de um do Fenor vira *conflito* e não é tocado; em caso de regra conflitante, as instruções do time têm prioridade.

## Ferramentas do Fenor no Copilot

| Ferramenta | Para quê |
|---|---|
| `#fenor_contexto` | Traz a memória do projeto (sessão anterior, próximo passo, armadilhas, regras de negócio) |
| `#fenor_verificar` | Roda os testes, o build e o lint **detectados pelo Fenor** e reprova se algo falhar |
| `#fenor_salvar_sessao` | Salva a sessão, o próximo passo e os aprendizados |

## Azure DevOps

**Fenor: Conectar Azure DevOps** → URL do projeto (`https://dev.azure.com/org/Projeto`) e um token pessoal com **Work Items: Read**. O token fica no cofre do VS Code.

## Segurança

- A IA é o Copilot que a empresa já usa; a extensão não tem chave de IA própria.
- A única conexão de rede é com o Azure DevOps (respeitando proxy e certificados configurados no VS Code).
- Nenhuma telemetria.

## Dica

O Copilot procura instruções, prompts, agentes e skills na raiz da pasta aberta. Para tudo funcionar, **abra o repositório do projeto** (ou um workspace com cada repositório como pasta). Com a pasta-mãe de vários repositórios aberta, o Fenor gera as instruções de cada projeto na raiz, mas os prompts `/fenor-…` só aparecem abrindo o repositório.

## Desenvolvimento

```bash
npm install
npm test
npx vsce package
code --install-extension fenor-*.vsix
```
