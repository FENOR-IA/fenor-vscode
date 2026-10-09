#!/bin/bash
# Copia do ECC instalado (~/.claude) para ecc/ só o que o kit Fenor usa.
# ECC: https://github.com/affaan-m/ECC — MIT, Copyright (c) 2026 Affaan Mustafa.
# Uso: scripts/atualizar-ecc.sh [origem]   (padrão: ~/.claude)
set -euo pipefail

SRC="${1:-$HOME/.claude}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/ecc"

AGENTS="code-reviewer security-reviewer tdd-guide planner silent-failure-hunter code-explorer
java-reviewer database-reviewer react-reviewer typescript-reviewer e2e-runner"
SKILLS="tdd-workflow verification-loop security-review error-handling api-design database-migrations
springboot-tdd springboot-verification springboot-patterns springboot-security java-coding-standards jpa-patterns
react-patterns react-testing react-performance frontend-patterns e2e-testing"

rm -rf "$DEST"
mkdir -p "$DEST/agents" "$DEST/skills"

for a in $AGENTS; do cp "$SRC/agents/$a.md" "$DEST/agents/"; done
for s in $SKILLS; do cp -r "$SRC/skills/ecc/$s" "$DEST/skills/"; done

gh api repos/affaan-m/ECC/contents/LICENSE --jq .content | base64 -d > "$DEST/LICENSE"
echo "ECC copiado para $DEST: $(find "$DEST" -type f | wc -l) arquivos, $(du -sh "$DEST" | cut -f1)"
