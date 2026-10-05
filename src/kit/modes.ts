/**
 * Modos de trabalho do método Fenor — o mesmo texto vira comando do Claude Code,
 * prompt do Copilot e instrução para o Codex. Inspirado no fluxo do Fenor Studio
 * (planner / executor / reviewer) e nos orquestradores do ECC (MIT, affaan-m/ECC).
 */

export type ModeId = 'planejar' | 'executar' | 'revisar' | 'corrigir' | 'feature' | 'salvar-sessao';

export interface Mode {
  id: ModeId;
  title: string;
  description: string;
  /** Modo só de leitura: a IA não pode editar código nem rodar comandos que alterem o projeto. */
  readOnly: boolean;
  body: string;
}

const READ_FIRST = `Antes de qualquer coisa, leia nesta ordem (pule o que não existir):
1. \`memory/INDEX.md\` — mapa do projeto
2. o arquivo mais recente de \`memory/sessions/\` — resuma em 3 linhas: feito, pendente, próximo passo
3. \`memory/progress/next.md\` e \`memory/plan.md\`
4. \`memory/kb/gotchas.md\` — erros já cometidos neste projeto: **não repita**
5. \`memory/kb/domain.md\` — regras de negócio
6. a seção "Especialistas e práticas (ECC)" do AGENTS.md — agentes e skills da stack deste projeto`;

const VERIFY = `Verificação (obrigatória antes de dizer que terminou): rode os comandos da seção
"Comandos de verificação" do AGENTS.md. Se algum falhar, corrija e rode de novo. Nunca declare
pronto com teste, build ou lint falhando — se não for possível rodar, diga isso explicitamente.`;

export const MODES: Record<ModeId, Mode> = {
  planejar: {
    id: 'planejar',
    title: 'Planejar',
    description: 'Analisa o código e escreve o plano, sem editar código',
    readOnly: true,
    body: `# Modo Planejar

Você está no **modo Planejar**. NÃO edite código, NÃO faça commits.

${READ_FIRST}

Depois:
1. Entenda o pedido. Se houver work item (AB#NNN), use a descrição e os critérios de aceite.
   Liste as dúvidas que mudariam o plano — pergunte antes de seguir se forem bloqueantes.
2. Leia o código envolvido. Cite arquivos e funções reais; não invente.
3. Escreva \`memory/plan.md\`:
   - objetivo e critérios de aceite (verificáveis)
   - passos pequenos e numerados, cada um com os arquivos que mudam
   - testes a criar ou ajustar por passo (o teste vem antes do código)
   - contratos que mudam (endpoints, payloads, tabelas) com exemplo de cURL
   - riscos e como mitigar
4. Escreva ou atualize \`memory/spec.md\` com o detalhe técnico.
5. Atualize \`memory/progress/next.md\` com o primeiro passo.

Termine dizendo: "Plano salvo em memory/plan.md. Use o modo Executar para implementar."`,
  },
  executar: {
    id: 'executar',
    title: 'Executar',
    description: 'Implementa o plano passo a passo, com teste antes e verificação no fim',
    readOnly: false,
    body: `# Modo Executar

Você está no **modo Executar**. Siga \`memory/plan.md\` — não improvise escopo.

${READ_FIRST}

Para cada passo do plano:
1. Escreva ou ajuste o teste que prova o comportamento (deve falhar antes da mudança).
2. Implemente o mínimo para o teste passar, seguindo as regras em \`.fenor/regras/\`.
3. Rode os testes do projeto. Verde antes de avançar.
4. Atualize \`memory/progress/done.md\` (o que foi feito) e \`memory/progress/next.md\` (próximo passo).
5. Decisão relevante? Registre em \`memory/decisions/AAAA-MM-DD-assunto.md\` (contexto, decisão, alternativas).

${VERIFY}

Commits: só quando o usuário pedir; mensagem convencional (\`feat:\`, \`fix:\`…) citando \`AB#NNN\` quando houver.

Ao encerrar, siga o modo **Salvar sessão** (\`.fenor/modos/salvar-sessao.md\`).`,
  },
  revisar: {
    id: 'revisar',
    title: 'Revisar',
    description: 'Revisa segurança, bugs e qualidade, sem editar código',
    readOnly: true,
    body: `# Modo Revisar

Você está no **modo Revisar**. NÃO edite código — apenas documente.

${READ_FIRST}

Use o agente revisor da stack (ex.: \`.claude/agents/java-reviewer.md\`, \`php-reviewer\`, \`react-reviewer\`) junto com \`security-reviewer\`.

Revise as mudanças atuais (\`git diff\` e arquivos novos) — ou o módulo indicado pelo usuário — contra
o plano e as regras em \`.fenor/regras/\`. Para cada achado: severidade, arquivo:linha, problema,
por que importa, correção sugerida.

Checklist:
- **Segurança:** injeção SQL, XSS, CSRF, autenticação/autorização, segredos no código, dados pessoais em log (LGPD)
- **Bugs:** casos de borda, nulos, concorrência, erros engolidos, fuso horário, dinheiro em ponto flutuante
- **Testes:** comportamento novo sem teste, testes que não provam nada
- **Desempenho:** consultas N+1, falta de índice/paginação, laços desnecessários
- **Qualidade:** duplicação, funções longas, nomes ruins, aderência à stack

Severidades: CRÍTICO (bloqueia), ALTO (corrigir antes do merge), MÉDIO, BAIXO.
Salve em \`memory/agents/revisao-AAAA-MM-DD.md\` e termine com o veredito: pode seguir ou não.`,
  },
  corrigir: {
    id: 'corrigir',
    title: 'Corrigir defeito',
    description: 'Reproduz o bug com teste vermelho, corrige até verde e registra o aprendizado',
    readOnly: false,
    body: `# Modo Corrigir defeito

Você está no **modo Corrigir defeito**. Regra de ouro: **sem teste vermelho, não há correção.**

${READ_FIRST}

Siga a skill \`tdd-workflow\` (e a de TDD da stack, ex.: \`springboot-tdd\`).

1. **Reproduzir:** escreva um teste de regressão que reproduz o defeito e **falha** pelo motivo certo.
   Se não conseguir reproduzir, pare e explique o que falta (dados, ambiente, logs).
2. **Causa raiz:** encontre a causa, não o sintoma. Procure o mesmo padrão em outros pontos do código.
3. **Corrigir:** a menor mudança que deixa o teste verde, sem quebrar os demais.
4. **Verificar:** ${VERIFY.replace('Verificação (obrigatória antes de dizer que terminou): ', '')}
5. **Aprender:** registre em \`memory/kb/gotchas.md\` — sintoma, causa e como evitar — em 2 a 4 linhas.
6. Atualize \`memory/progress/done.md\`.

Entregue: causa raiz, o teste criado, a correção e onde mais o padrão aparecia.`,
  },
  feature: {
    id: 'feature',
    title: 'Nova feature',
    description: 'Do requisito ao código testado: critérios, plano, testes, implementação e revisão',
    readOnly: false,
    body: `# Modo Nova feature

Você está no **modo Nova feature**. Fluxo completo, uma etapa por vez, sem pular.

${READ_FIRST}

1. **Requisito:** reescreva o pedido em critérios de aceite verificáveis (Dado / Quando / Então).
   Confirme com o usuário se houver ambiguidade.
2. **Plano:** escreva \`memory/plan.md\` como no modo Planejar (passos pequenos, arquivos, testes, riscos).
3. **Testes primeiro:** crie os testes que provam os critérios — devem falhar (skill \`tdd-workflow\` e a de TDD da stack).
4. **Implementação:** passo a passo até os testes passarem, seguindo \`.fenor/regras/\`.
5. **Verificação** (skill \`verification-loop\`): ${VERIFY.replace('Verificação (obrigatória antes de dizer que terminou): ', '')}
6. **Revisão:** aplique o checklist do modo Revisar nas suas próprias mudanças e corrija CRÍTICO/ALTO.
7. **Documentação:** atualize \`memory/kb/domain.md\` (regras novas), \`memory/progress/done.md\` e,
   se mudou contrato entre serviços, documente o endpoint com exemplo de cURL.`,
  },
  'salvar-sessao': {
    id: 'salvar-sessao',
    title: 'Salvar sessão',
    description: 'Salva o contexto da sessão e os aprendizados na memória do projeto',
    readOnly: false,
    body: `# Modo Salvar sessão

Salve o contexto para a próxima sessão retomar exatamente daqui. Escreva só em \`memory/\`.

1. Crie \`memory/sessions/AAAA-MM-DD-assunto.md\` com: objetivo da sessão, o que foi feito
   (arquivos e commits), decisões, o que ficou pendente, próximo passo concreto.
2. Atualize \`memory/progress/next.md\`, \`done.md\` e \`blockers.md\`.
3. Extraia aprendizados — só o que for novo, sem repetir o que já está lá:
   - \`memory/kb/gotchas.md\`: erros, armadilhas, comportamentos inesperados
   - \`memory/kb/domain.md\`: regras de negócio confirmadas
   - \`memory/kb/integrations.md\`: APIs e serviços configurados ou testados
4. Se o mapa do projeto mudou, atualize \`memory/INDEX.md\`.

Seja conciso. Preserve o conteúdo existente.`,
  },
};

export const MODE_ORDER: ModeId[] = ['planejar', 'executar', 'revisar', 'corrigir', 'feature', 'salvar-sessao'];
