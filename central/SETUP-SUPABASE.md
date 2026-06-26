# Setup do Supabase central (dev)

Projeto de desenvolvimento: `pvdhepvtoavkyoschkod` (`https://pvdhepvtoavkyoschkod.supabase.co`).
A URL + anon key já estão em `config.js`. A anon key é pública (a segurança é a RLS).

## Checklist no painel do Supabase

1. **Banco** — SQL Editor → cole e rode `central/sql/install.sql` (tabelas,
   funções, RLS, seed). Super admins do seed: `desenv.sme@gmail.com` e
   `matheusprospero@gmail.com`.
2. **Google** — Authentication → Providers → Google → Enable. Informe Client ID
   e Secret (pode reaproveitar os do MAPA). Copie a *Callback URL* mostrada e
   adicione-a em **Authorized redirect URIs** do OAuth Client no Google Cloud.
3. **Origens** — Authentication → URL Configuration:
   - Site URL: `https://smedigital.com.br`
   - Redirect URLs: `https://smedigital.com.br/**` e `http://localhost:5500/**`

## Como testar

- **Local:** `python3 -m http.server 5500` na raiz do repo → abra
  `http://localhost:5500/central/login.html`.
- **Produção:** `https://smedigital.com.br/central/login.html` (após publicar na `main`).

Entre com uma conta super admin (ex.: `desenv.sme@gmail.com`). Se aparecer
"sem acesso", confira se o e-mail está em `perfis` e `ativo`, e se o domínio
bate (super admin é exceção à regra de domínio).

## Trocar de projeto sem mexer no git

Crie `central/config.local.js` (está no `.gitignore`) redefinindo
`window.ACESSO_CFG` antes dos demais scripts.
