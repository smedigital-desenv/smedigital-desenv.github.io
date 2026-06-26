# Central de Acesso da Rede SME

Controle de acesso **por tela** e login único para os sistemas da rede municipal
de educação de Ribeirão Preto. Este diretório (`/central/`) vive no portal
`smedigital.com.br` e fala com um **projeto Supabase central novo**, modelado a
partir do sistema do MAPA (`smedigital-desenv/mapa-sme`).

> Esta é a 1ª entrega: o **Painel de Administração** de acessos por tela, para
> avaliar disponibilidade e usabilidade do modelo antes de plugar os sistemas.

## Arquivos

| Arquivo | O que é |
|---|---|
| `sql/install.sql` | Esquema completo do projeto central (tabelas, funções, RLS, seed). Rode uma vez no SQL Editor do Supabase. |
| `config.js` | URL + anon key do projeto central. **Preencha após criar o projeto.** |
| `acesso-sme.js` | Biblioteca de auth/autorização da rede (`window.AcessoSME`). Versão neutra do `auth.js` do MAPA. |
| `login.html` | Tela de login (Google). Depois de entrar, redireciona ao **portal** (`/index.html`). |
| `admin.html` + `admin.js` | **Painel de Administração** — exclusivo para super administradores. |

## Como o acesso funciona

- **Identidade:** Supabase Auth com Google.
- **Autorização:** a secretaria pré-cadastra os e-mails em `perfis` (allowlist).
  Quem não está lá entra no Auth mas **não recebe nenhuma permissão** (RLS nega
  tudo) → tela "sem acesso".
- **Por tela:** a liberação principal é feita em `perfil_tela` (1 checkbox por
  tela: ver / editar / exportar). Há ainda o atalho por **papel**
  (`perfil_papeis` + `papel_permissoes`), mantido por compatibilidade.
- **Contrato estável:** a RPC `minhas_permissoes()` devolve um JSON
  `{ autorizado, perfil, escolas, sistemas:[{ slug, nome, url, icone, cor, papel,
  telas:{ slug:{ nome, ver, editar, exportar } } }] }`. É isso que o `acesso-sme.js`
  e os sistemas consomem.

## Passo a passo (deploy)

1. **Criar o projeto** novo no [Supabase](https://supabase.com) (este é o *central*).
2. **Auth → Providers:** habilite **Google**.
3. **Auth → URL Configuration:** em *Site URL* e *Redirect URLs* adicione a
   origem do portal: `https://smedigital.com.br` (e, para testes locais, a URL do
   seu servidor). Mesma origem ⇒ SSO entre os sistemas.
4. **SQL Editor:** cole `sql/install.sql` inteiro e clique em **Run**.
5. **Credenciais:** copie *Project URL* e *anon public key* (Settings → API) para
   `config.js` (`window.ACESSO_CFG.url` e `.anonKey`).
6. **Super admin:** o seed já libera `desenv.sme@gmail.com` e
   `matheusprospero@gmail.com`. Ajuste em `sql/install.sql` se precisar.
7. Acesse `/central/admin.html` com uma conta super admin.

> A anon key é pública por natureza (a segurança real é a RLS). Para apontar a
> outro projeto sem mexer no git, crie `central/config.local.js` definindo
> `window.ACESSO_CFG` — ele está no `.gitignore`.

## O Painel de Administração (`admin.html`)

Exclusivo para super admins. Seções:

- **Acessos por tela** — escolha *sistema* + *usuário* e marque ver/editar/exportar
  por tela. Grava em `perfil_tela`.
- **Usuários** — cadastra e-mails autorizados (allowlist), ativa/desativa, alterna
  super admin.
- **Escolas e vínculos** — cadastra unidades e vincula usuários (`perfil_escola`).
- **Catálogo** — cadastra sistemas e suas telas (registro do passo 3 do plano).
- **Ver como** — simula o acesso de qualquer usuário via `permissoes_de()`.

## Plugar um sistema no controle central (próximos passos)

Em qualquer página do sistema, **antes** de incluir o módulo:

```html
<script>window.ACESSO_SISTEMA = 'sate';</script>   <!-- slug do sistema -->
<script src="/central/config.js"></script>
<script src="/central/acesso-sme.js"></script>
```

Depois, no código da página:

```js
await AcessoSME.pronto;
if (AcessoSME.can('agendamento', 'editar')) { /* ... */ }
```

Marcação declarativa também funciona:

```html
<a data-tela="agendamento" href="...">Agendamento</a>      <!-- some se não puder ver -->
<button data-perm="agendamento:editar">Salvar</button>     <!-- some se não puder editar -->
```
