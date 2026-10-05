#!/bin/bash
# Cria um workspace de demonstração com projetos Java, React e Symfony,
# cada um com histórico git e commits referenciando work items (AB#).
# Uso: scripts/criar-demo.sh [pasta]   (padrão: ~/fenor-demo)
set -euo pipefail

DEST="${1:-$HOME/fenor-demo}"
[ -e "$DEST" ] && { echo "Já existe: $DEST (apague antes ou passe outra pasta)"; exit 1; }

commit() { # pasta, mensagem, autor, dias atrás
  local when; when=$(date -d "-$4 days" --iso-8601=seconds)
  git -C "$1" add -A
  GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" \
    git -C "$1" -c user.name="$3" -c user.email="$(echo "$3" | tr ' ' '.' | tr '[:upper:]' '[:lower:]')@exemplo.com" commit -qm "$2"
}

java_project() { # pasta, artifactId, java, boot
  mkdir -p "$1/src/main/java/com/exemplo" "$1/src/test/java/com/exemplo"
  cat > "$1/pom.xml" <<POM
<project>
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>$4</version></parent>
  <groupId>com.exemplo</groupId>
  <artifactId>$2</artifactId>
  <version>1.0.0</version>
  <properties><java.version>$3</java.version></properties>
</project>
POM
}

mkdir -p "$DEST"

# --- Sistema Cartões: API Java + front React -------------------------------
java_project "$DEST/cartoes/api-cartoes" api-cartoes 17 3.2.5
cat > "$DEST/cartoes/api-cartoes/src/main/java/com/exemplo/CartaoController.java" <<'JAVA'
package com.exemplo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/cartoes")
public class CartaoController {
    @GetMapping("/{id}/limite")
    public LimiteDto limite(@PathVariable Long id) { return new LimiteDto(id, 5000); }

    @PostMapping("/{id}/bloqueio")
    public void bloquear(@PathVariable Long id, @RequestBody BloqueioRequest req) { }
}
JAVA
echo 'package com.exemplo; class CartaoControllerTest {}' > "$DEST/cartoes/api-cartoes/src/test/java/com/exemplo/CartaoControllerTest.java"
git -C "$DEST/cartoes/api-cartoes" init -q
commit "$DEST/cartoes/api-cartoes" "chore: estrutura inicial da API" "Ana Souza" 12
echo 'package com.exemplo; class LimiteServiceTest {}' > "$DEST/cartoes/api-cartoes/src/test/java/com/exemplo/LimiteServiceTest.java"
commit "$DEST/cartoes/api-cartoes" "feat: consulta de limite do cartão AB#101" "Ana Souza" 4
echo 'package com.exemplo; class BloqueioServiceTest {}' > "$DEST/cartoes/api-cartoes/src/test/java/com/exemplo/BloqueioServiceTest.java"
commit "$DEST/cartoes/api-cartoes" "fix: bloqueio respeita cartão adicional AB#104" "Bruno Lima" 1

mkdir -p "$DEST/cartoes/web-cartoes/src"
cat > "$DEST/cartoes/web-cartoes/package.json" <<'JSON'
{ "name": "web-cartoes", "version": "0.8.0",
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1", "axios": "^1.7.0" },
  "devDependencies": { "vite": "^5.4.0", "vitest": "^2.0.0" } }
JSON
cat > "$DEST/cartoes/web-cartoes/src/api.ts" <<'TS'
import axios from 'axios';
export const buscarLimite = (id: number) => axios.get(`/api/cartoes/${id}/limite`);
export const bloquear = (id: number, motivo: string) => axios.post(`/api/cartoes/${id}/bloqueio`, { motivo });
TS
echo "test('limite', () => {});" > "$DEST/cartoes/web-cartoes/src/Limite.test.tsx"
git -C "$DEST/cartoes/web-cartoes" init -q
commit "$DEST/cartoes/web-cartoes" "feat: tela de limite AB#102" "Carla Dias" 3

# --- Sistema Pix: API Java sem testes ---------------------------------------
java_project "$DEST/pix/api-pix" api-pix 21 3.3.4
echo 'package com.exemplo; public class PixController {}' > "$DEST/pix/api-pix/src/main/java/com/exemplo/PixController.java"
git -C "$DEST/pix/api-pix" init -q
commit "$DEST/pix/api-pix" "feat: cadastro de chave Pix AB#110" "Bruno Lima" 6

# --- Backoffice Symfony -----------------------------------------------------
mkdir -p "$DEST/backoffice/src/Controller" "$DEST/backoffice/tests"
cat > "$DEST/backoffice/composer.json" <<'JSON'
{ "name": "exemplo/backoffice", "type": "project",
  "require": { "php": ">=8.2", "symfony/framework-bundle": "6.4.*" },
  "require-dev": { "phpunit/phpunit": "^10.5" } }
JSON
echo '<?php class ClienteControllerTest {}' > "$DEST/backoffice/tests/ClienteControllerTest.php"
git -C "$DEST/backoffice" init -q
commit "$DEST/backoffice" "feat: consulta de clientes AB#120" "Diego Rocha" 8

# Arquivo modificado sem commit, para testar /revisar.
cat >> "$DEST/cartoes/api-cartoes/src/main/java/com/exemplo/CartaoController.java" <<'JAVA'
// TODO: logar o número completo do cartão para auditoria
JAVA

echo "Workspace de demonstração criado em: $DEST"
echo "Abra com: code \"$DEST\""
