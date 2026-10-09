import { Project } from '../portfolio/scanner';

/**
 * Regras de código, condensadas a partir das regras do ECC (MIT, affaan-m/ECC) e das convenções do Fenor.
 * Viram .github/instructions/*.instructions.md — o Copilot aplica pelo tipo de arquivo (applyTo).
 */

export type RuleId = 'comum' | 'seguranca' | 'testes' | 'java' | 'react';

export const RULE_APPLY_TO: Record<RuleId, string> = {
  comum: '**',
  seguranca: '**',
  testes: '**',
  java: '**/*.java',
  react: '**/*.{ts,tsx,js,jsx}',
};

export const RULES: Record<RuleId, string> = {
  comum: `# Regras comuns

- Leia antes de mudar: entenda o código vizinho e siga o estilo, nomes e padrões que já existem.
- Funções pequenas e focadas (< 50 linhas); arquivos coesos (< 800 linhas); no máximo 4 níveis de aninhamento — prefira retorno antecipado.
- Prefira dados imutáveis: crie novos objetos em vez de alterar os recebidos.
- Trate erros explicitamente em toda camada. Nunca engula exceção em silêncio. Mensagem amigável para o usuário, detalhe no log do servidor.
- Valide toda entrada na fronteira do sistema (requisição, arquivo, API externa). Falhe cedo com mensagem clara.
- Sem números mágicos: use constantes com nome.
- Sem código de depuração no commit (prints, dumps, console.log, código comentado).
- Mudança pequena e com propósito único. Não refatore o que não foi pedido.
- Não invente API, tabela ou campo: confira no código ou na documentação.
`,
  seguranca: `# Regras de segurança

- Nunca coloque segredo no código (senha, token, chave). Use variáveis de ambiente ou cofre; \`.env\` nunca vai para o git.
- SQL sempre parametrizado. Nunca concatene entrada do usuário em consulta.
- Escape a saída em HTML por padrão. Nada de inserir HTML vindo do usuário sem sanitizar.
- Proteção CSRF em toda ação que altera estado.
- Confira autorização em todo endpoint, não só autenticação (o usuário pode acessar *este* recurso?).
- Dados pessoais (CPF, telefone, e-mail, conta, cartão) não vão para log nem para mensagens de erro (LGPD).
- Dinheiro: nunca em ponto flutuante — use centavos inteiros ou decimal.
- Datas: grave em UTC, converta só na exibição.
- Dependência nova só com justificativa: verifique manutenção e vulnerabilidades conhecidas antes de adicionar.
`,
  testes: `# Regras de testes

- Teste antes do código quando houver comportamento novo ou defeito (vermelho → verde → refatorar).
- Defeito corrigido = teste de regressão que falhava antes da correção.
- Teste comportamento, não implementação. Nome do teste descreve o comportamento esperado.
- Estrutura Preparar / Agir / Verificar.
- Testes independentes entre si; sem depender de ordem ou de estado compartilhado.
- Cubra os casos de borda: vazio, nulo, limite, erro externo, permissão negada.
- Meta de cobertura: 80% nas regras de negócio.
`,
  java: `# Regras Java / Spring

- Injeção por construtor (campos \`final\`), nunca \`@Autowired\` em campo.
- Controller fino: valida entrada (Bean Validation, \`@Valid\`) e delega; regra de negócio na camada de serviço.
- DTOs na borda da API; não exponha entidades JPA diretamente.
- \`@Transactional\` na camada de serviço, com escopo mínimo; cuidado com chamadas internas que ignoram o proxy.
- JPA: evite N+1 (\`JOIN FETCH\`, \`@EntityGraph\`), pagine consultas, nada de \`findAll()\` sem limite.
- Tratamento de erro centralizado com \`@RestControllerAdvice\`; respostas de erro padronizadas, sem stack trace para o cliente.
- \`Optional\` como retorno, nunca como parâmetro ou campo. Sem \`null\` em coleções retornadas.
- \`BigDecimal\` para dinheiro; \`java.time\` para datas (nada de \`Date\`).
- Testes: JUnit 5 + Mockito para unidade; \`@WebMvcTest\`/\`@DataJpaTest\` para fatias; Testcontainers para integração com banco.
- Logs com SLF4J e parâmetros (\`log.info("x {}", y)\`), sem dados pessoais.
`,
  react: `# Regras React

- Componentes de função; props tipadas com interface/type nomeado.
- Regras dos hooks: só no topo, nunca em condição ou laço; dependências do \`useEffect\` completas e corretas.
- Estado do servidor em biblioteca de dados (TanStack Query, SWR) — não duplique em estado local.
- \`key\` estável em listas (id, nunca índice quando a lista muda).
- Nada de \`dangerouslySetInnerHTML\` sem sanitizar.
- Acessibilidade: elementos semânticos, \`label\` em campos, foco visível, navegação por teclado.
- Testes com Testing Library pelo comportamento visível (papel, texto), não por classe CSS.
- Sem \`console.log\` no commit; trate estados de carregando, vazio e erro em toda tela com dados.
`,
};

export function rulesFor(project: Pick<Project, 'stack'>): RuleId[] {
  return ['comum', 'seguranca', 'testes', project.stack];
}
