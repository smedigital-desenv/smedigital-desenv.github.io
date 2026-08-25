#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Guarda anti-vazamento da rede SME — instalação POR MÁQUINA.
#
# Rode UMA VEZ em cada computador que usa esta conta:
#
#   curl -fsSL https://smedigital.com.br/guarda/instalar.sh | bash
#
# O que isto passa a valer, nesta máquina, para SEMPRE:
#
#   • TODO repositório do git — inclusive os que ainda não existem e os que
#     não são da rede SME —, porque `core.hooksPath` global alcança qualquer
#     clone. Commit e push passam pela guarda.
#   • TODA sessão do Claude Code — nova ou retomada, em qualquer pasta —,
#     porque o hook entra em ~/.claude/settings.json, que é do usuário e não
#     do projeto.
#   • A escrita direta pela API do GitHub (ferramentas MCP), que não passa
#     por git nenhum e por isso escapava de qualquer hook.
#
# Para desinstalar:  git config --global --unset core.hooksPath
#                    e tire o bloco "sme-guarda" de ~/.claude/settings.json
# ---------------------------------------------------------------------------
set -eu

DEST="${SME_GUARDA_DIR:-$HOME/.sme-guarda}"
FONTE="${SME_GUARDA_URL:-https://smedigital.com.br/guarda/verificar-vazamento.sh}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo .)"

mkdir -p "$DEST/hooks"

# 1. A guarda em si — do lado do disco se este script veio de um clone,
#    da web se veio pelo curl.
if [ -f "$AQUI/verificar-vazamento.sh" ]; then
  cp "$AQUI/verificar-vazamento.sh" "$DEST/verificar-vazamento.sh"
elif [ -f "$AQUI/../.claude/hooks/verificar-vazamento.sh" ]; then
  cp "$AQUI/../.claude/hooks/verificar-vazamento.sh" "$DEST/verificar-vazamento.sh"
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL "$FONTE" -o "$DEST/verificar-vazamento.sh"
else
  echo "Não achei a guarda nem consegui baixá-la ($FONTE)." >&2; exit 1
fi
chmod +x "$DEST/verificar-vazamento.sh"
bash -n "$DEST/verificar-vazamento.sh" || { echo "Guarda baixada está corrompida." >&2; exit 1; }

# 2. Hooks globais do git.
#
#    ⚠️ core.hooksPath global vale para TODO repositório da máquina, e
#    substitui o .git/hooks de cada um. Por isso estes hooks ENCADEIAM o hook
#    próprio do repositório depois de rodar a guarda: quem já usa husky ou
#    qualquer outro pre-commit continua funcionando.
#
#    Um repositório que define core.hooksPath local (é o caso dos da rede SME,
#    que apontam para .githooks) manda no seu próprio clone — o local vence o
#    global, e lá a guarda vem versionada.
cat > "$DEST/hooks/pre-commit" <<'EOF'
#!/usr/bin/env bash
GUARDA="$(dirname "$0")/../verificar-vazamento.sh"
[ -f "$GUARDA" ] && { bash "$GUARDA" < /dev/null || exit $?; }
R="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$R" ] && [ -x "$R/.git/hooks/pre-commit" ] && exec "$R/.git/hooks/pre-commit" "$@"
exit 0
EOF
cat > "$DEST/hooks/pre-push" <<'EOF'
#!/usr/bin/env bash
ENTRADA="$(cat || true)"
GUARDA="$(dirname "$0")/../verificar-vazamento.sh"
[ -f "$GUARDA" ] && { printf '%s' "$ENTRADA" | SME_GUARDA_MODO=push bash "$GUARDA" || exit $?; }
R="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$R" ] && [ -x "$R/.git/hooks/pre-push" ] && { printf '%s' "$ENTRADA" | exec "$R/.git/hooks/pre-push" "$@"; }
exit 0
EOF
chmod +x "$DEST/hooks/pre-commit" "$DEST/hooks/pre-push"
git config --global core.hooksPath "$DEST/hooks"

# 3. Claude Code, no nível do USUÁRIO — vale para toda sessão desta conta
#    nesta máquina, em qualquer pasta, nova ou retomada.
CFG="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
[ -f "$CFG" ] || printf '{}\n' > "$CFG"

MESCLA='
import json, sys, os
cfg, guarda = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(cfg, encoding="utf-8"))
except Exception:
    d = {}
if not isinstance(d, dict):
    d = {}
cmd = "bash \"%s\"" % guarda
entradas = [
    {"matcher": "Bash",
     "hooks": [{"type": "command", "command": cmd, "statusMessage": "Guarda anti-vazamento (sme-guarda)"}]},
    {"matcher": "mcp__github__(create_or_update_file|push_files)",
     "hooks": [{"type": "command", "command": cmd, "statusMessage": "Guarda anti-vazamento (sme-guarda)"}]},
]
h = d.setdefault("hooks", {})
pre = [e for e in h.get("PreToolUse", []) if "sme-guarda" not in json.dumps(e)]
h["PreToolUse"] = entradas + pre
json.dump(d, open(cfg, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
open(cfg, "a", encoding="utf-8").write("\n")
'
if command -v python3 >/dev/null 2>&1; then
  python3 -c "$MESCLA" "$CFG" "$DEST/verificar-vazamento.sh"
elif command -v python >/dev/null 2>&1; then
  python -c "$MESCLA" "$CFG" "$DEST/verificar-vazamento.sh"
else
  echo "AVISO: sem python nesta máquina — ~/.claude/settings.json não foi mexido." >&2
  echo "       O git (commit e push) já está protegido. Para fechar o Claude Code," >&2
  echo "       acrescente à mão um hook PreToolUse chamando: $DEST/verificar-vazamento.sh" >&2
fi

echo "Guarda anti-vazamento instalada em $DEST"
echo "  git:         core.hooksPath global -> $DEST/hooks (todo repositório desta máquina)"
echo "  Claude Code: hook PreToolUse em $CFG (toda sessão desta conta nesta máquina)"
echo
echo "Confira com:  git config --global core.hooksPath"
