import { Project } from '../portfolio/scanner';

/**
 * Regras de código por stack, condensadas a partir das regras do ECC (MIT, affaan-m/ECC)
 * e das convenções do Fenor. Ficam em .fenor/regras/ dentro de cada projeto.
 */

export type RuleId = 'comum' | 'seguranca' | 'testes' | 'java' | 'react' | 'node' | 'php' | 'symfony' | 'laravel' | 'fenor-php74' | 'python';

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
  node: `# Regras Node / TypeScript

- Tipos explícitos em funções exportadas; evite \`any\` — use \`unknown\` e estreite.
- \`async/await\` com \`try/catch\`; nunca deixe promessa sem tratamento.
- Valide entrada externa com esquema (ex.: Zod).
- Configuração por variável de ambiente, validada na inicialização.
`,
  php: `# Regras PHP

- \`declare(strict_types=1);\` e PSR-12.
- PDO com prepared statements em toda consulta com dado variável.
- \`password_hash()\` / \`password_verify()\` para senhas — nunca MD5/SHA1.
- Escape a saída nos templates (\`htmlspecialchars\` com \`ENT_QUOTES\` e UTF-8).
- Sem \`var_dump\`, \`print_r\`, \`dd()\` ou \`die()\` no código.
- Tipos em parâmetros e retornos; exceções em vez de retornos mágicos (\`false\`, \`-1\`).
`,
  symfony: `# Regras Symfony

- Serviços com autowiring e injeção por construtor; controllers finos.
- Validação com o componente Validator (constraints nas DTOs/entidades); formulários com token CSRF.
- Doctrine: parâmetros nomeados no DQL/QueryBuilder; evite N+1 com \`JOIN\` + \`addSelect\`; paginação.
- Autorização com Voters e \`#[IsGranted]\`/\`denyAccessUnlessGranted\`.
- Configuração sensível em variáveis de ambiente / Secrets do Symfony.
- Testes: PHPUnit com \`KernelTestCase\` / \`WebTestCase\`.
`,
  laravel: `# Regras Laravel

- Form Requests para validação; controllers finos; regra de negócio em services/actions.
- Eloquent: \`with()\` para evitar N+1; nada de \`Model::all()\` sem limite; proteja atribuição em massa (\`$fillable\`).
- Policies/Gates para autorização. Migrations reversíveis.
- Testes com \`php artisan test\` (Feature e Unit).
`,
  'fenor-php74': `# Regras de app Fenor (PHP 7.4)

O servidor roda PHP 7.4. Escreva código compatível:
- \`str_starts_with($s, $p)\` → \`strpos($s, $p) === 0\`
- \`str_ends_with($s, $suf)\` → \`substr($s, -strlen($suf)) === $suf\`
- \`str_contains($s, $n)\` → \`strpos($s, $n) !== false\`
- Proibido: enums, propriedades \`readonly\`, \`match()\`, argumentos nomeados, \`func(...)\` como callable, retorno \`never\`.
- Banco MySQL: \`ON DUPLICATE KEY UPDATE\`, \`AUTO_INCREMENT\`, \`TINYINT(1)\` para booleano. Nada de sintaxe PostgreSQL.
- Banco isolado por app: nunca acesse o banco de outro app.
`,
  python: `# Regras Python

- PEP 8, type hints em funções públicas.
- Exceções específicas; nunca \`except:\` vazio.
- Consultas parametrizadas; segredos em variáveis de ambiente.
- Testes com pytest.
`,
};

export function rulesFor(project: Pick<Project, 'stack' | 'framework'>): RuleId[] {
  const fw = project.framework ?? '';
  const ids: RuleId[] = ['comum', 'seguranca', 'testes'];
  switch (project.stack) {
    case 'java':
      ids.push('java');
      break;
    case 'react':
      ids.push('react', 'node');
      break;
    case 'node':
      ids.push('node');
      break;
    case 'php':
      ids.push('php');
      if (/Symfony/.test(fw)) {
        ids.push('symfony');
      }
      if (/Laravel/.test(fw)) {
        ids.push('laravel');
      }
      if (/App Fenor/.test(fw)) {
        ids.push('fenor-php74');
      }
      break;
    case 'python':
      ids.push('python');
      break;
  }
  return ids;
}
