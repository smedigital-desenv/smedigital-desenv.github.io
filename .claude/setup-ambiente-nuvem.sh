#!/bin/bash
# ============================================================================
# Setup script do ambiente de nuvem — rede SME Ribeirão Preto
#
# Cole isto em claude.ai/code → Environments → (seu ambiente) → Setup script.
#
# Roda como root, uma vez por ambiente, ANTES de o Claude Code iniciar, e o
# resultado fica no snapshot do ambiente. Como o mesmo ambiente atende a TODA
# sessão de nuvem — navegador, app do celular, app de desktop, `claude --cloud`,
# rotinas —, a regra passa a valer em qualquer aparelho, sem instalar nada.
#
# O que ele faz: grava a memória de usuário do perfil em ~/.claude/CLAUDE.md,
# que o Claude Code lê no início de toda sessão, em qualquer repositório.
#
# Ao mudar o texto abaixo, o ambiente reconstrói o cache sozinho na próxima
# sessão. Termina em exit 0 — script que falha impede a sessão de subir.
# ============================================================================

mkdir -p "$HOME/.claude" || true

cat > "$HOME/.claude/CLAUDE.md" <<'FIM_DAS_REGRAS'
# Regras permanentes — perfil SME Ribeirão Preto

> Este arquivo é memória de usuário: vale para **toda** sessão do Claude Code
> deste perfil, em qualquer repositório, conversa nova ou já aberta.

## Nunca versionar script SQL nem arquivo de dados

Os repositórios desta rede são **públicos**, e os sites são publicados pelo
**GitHub Pages a partir da raiz do repositório**. Todo arquivo commitado vira
URL pública e baixável — `db/carga.sql` no Git é `.../db/carga.sql` no navegador.
O histórico do Git, além disso, é permanente: apagar depois exige reescrita de
histórico, força-push em todas as branches e chamado no suporte do GitHub.

Portanto, em qualquer repositório deste perfil:

1. **Nunca faça `git add`, `git commit` ou `git push` de `.sql`, `.csv`,
   `.dump`, `.xlsx` ou `.xls`.** Sem exceção — nem migração, nem "só o esquema",
   nem exemplo com dado fictício. Se um desses arquivos aparecer staged, tire-o
   com `git rm --cached` antes de commitar.
2. **Entregue o script fora do repositório.** Escreva em `db/` (que fica no
   `.gitignore`) e mande o arquivo pela conversa, para rodar no SQL Editor do
   Supabase. É lá que ele vive.
3. **Nunca contorne a guarda para publicar um arquivo de dados.**
   `git commit --no-verify`, `git add -f` e `SME_PERMITIR_COMMIT=1` servem a
   falso positivo em arquivo que comprovadamente não tem dado pessoal. Se a
   guarda barrou um `.sql`, ela acertou.
4. **Nunca versione dado pessoal** — nome, e-mail, RA, matrícula, CPF, telefone,
   endereço — em código, comentário, dado de exemplo ou mensagem de commit. Se o
   conteúdo de um campo é a identificação de alguém, ele vai para o banco, atrás
   de autenticação, e não para o arquivo estático.
5. **Nunca versione credencial**: `service_role`, senha de banco, token de API,
   chave privada. A chave `anon` do Supabase é a única exceção — é pública por
   design.

6. **Se a máquina for sua, instale a guarda nela uma vez.** Uma linha, e ela
   passa a valer em todo repositório daquele computador — inclusive nos que
   ainda não existem — e em toda sessão do Claude Code daquele perfil:
   `curl -fsSL https://smedigital.com.br/guarda/instalar.sh | bash`.
   Em sessão de nuvem não adianta: o container é efêmero, e ali quem cobre é
   este texto (pelo setup script do ambiente) mais o que vem versionado no
   repositório.

Antes de qualquer `git add -A` ou `git commit -a`, confira o que entrou:
`git status --short` e `git diff --cached --name-only`. Um `-A` distraído é
exatamente como os 3.152 e-mails de servidores foram parar na web em
`smedigital-desenv/site`, baixáveis por qualquer um até 2026-08-25.

Estes sistemas tratam **dados pessoais de crianças**, alguns de natureza
sensível. Na dúvida, pergunte antes de commitar.
FIM_DAS_REGRAS

echo "memoria do perfil SME gravada em $HOME/.claude/CLAUDE.md"
exit 0
