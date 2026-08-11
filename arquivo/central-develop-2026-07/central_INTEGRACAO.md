# Plugar um sistema no controle de acesso central

Objetivo: o sistema passa a **exigir login pelo central** e a **mostrar/bloquear
telas** conforme as permissões (`minhas_permissoes()`), em vez de ter login e
regras próprias.

> Pré-requisito: o sistema é servido na **mesma origem** do central
> (`smedigital.com.br/<sistema>/`). Mesma origem ⇒ sessão compartilhada ⇒ **SSO**.

---

## 1) Sistemas em HTML (GOM, SATE, Presença, MAPA…)

Em **todas** as páginas protegidas, inclua no `<head>` (ANTES dos scripts do app):

```html
<script>window.ACESSO_SISTEMA = 'gom';</script>          <!-- slug do sistema -->
<script src="/central/config.js"></script>
<script src="/central/acesso-sme.js"></script>
```

Pronto — o módulo já:
- redireciona ao **login do central** se não houver sessão (e volta à página certa depois);
- carrega as permissões do usuário;
- **bloqueia** a tela atual (pelo nome do arquivo, ex.: `triagem.html` → tela `triagem`) se não puder ver;
- **esconde** elementos marcados:

```html
<a data-tela="relatorios" href="relatorios.html">Relatórios</a>   <!-- some se não puder ver -->
<button data-perm="triagem:editar">Salvar</button>               <!-- some se não puder editar -->
```

No código, cheque permissões pelo objeto global:

```js
await AcessoSME.pronto;
if (AcessoSME.can('triagem', 'editar')) { /* ... */ }
AcessoSME.perfil;   // { id, nome, email, tipo, is_super_admin }
AcessoSME.escolas;  // unidades vinculadas
AcessoSME.signOut();
```

**Isolamento por escola** (sistemas onde a escola vê tudo, dados isolados):

```js
const visiveis = AcessoSME.filtrarEscolas(linhas, r => r.nome_unidade);
if (AcessoSME.podeVerEscola(nomeUnidade)) { /* ... */ }
```

### Ao migrar um sistema que já tinha login/permissão próprios (ex.: GOM)
1. Remova o antigo (`js/permissoes.js`, telas de login próprias).
2. O **papel** de cada usuário agora vem do central (`perfil_papeis`); o mapa
   papel→tela é o `papel_permissoes` (já migrado).
3. Onde o código fazia `perfilTemAcesso('triagem')`, troque por
   `AcessoSME.can('triagem')`.

---

## 2) Sistemas em React/Vite (Roçadas, Repositório)

Não dá para usar `<script>` do mesmo jeito. Use um cliente Supabase apontando
para o **central** e chame a RPC `minhas_permissoes()` num contexto de auth:

```js
import { createClient } from '@supabase/supabase-js';

// mesmas credenciais do central/config.js
export const central = createClient(CENTRAL_URL, CENTRAL_ANON_KEY);

export async function carregarAcesso() {
  const { data: { session } } = await central.auth.getSession();
  if (!session) { window.location.href = '/central/login.html?next=' + encodeURIComponent(location.pathname); return null; }
  const { data } = await central.rpc('minhas_permissoes');
  return data; // { autorizado, perfil, escolas, sistemas:[{slug, telas:{...}}] }
}
```

Depois, um `can(sistema, tela, acao)` sobre o objeto e guards de rota (como o
`SMERoute`/`EmpresaRoute` que já existem) passam a checar as telas do central.

> Posso gerar esse módulo pronto (`acesso.ts`) para o Roçadas quando chegarmos nele.

---

## 3) Camadas de controle (importante)

| Camada | O que o central controla | Status |
|---|---|---|
| **Login** (quem entra) | allowlist `perfis` + domínio/`bypass_dominio` | ✅ pronto |
| **Telas** (o que aparece) | `minhas_permissoes()` + `acesso-sme.js` | ✅ pronto (esta integração) |
| **Dados** (RLS por usuário) | RLS nas tabelas de dados usando `tem_permissao()` | ⏳ fase 2 |

**Fase 1 (agora):** o central controla o **login** e **quais telas** cada um vê.
O dado de cada sistema continua no Supabase do próprio sistema.

**Fase 2 (depois):** para a RLS dos **dados** usar a identidade central, os dados
precisam conviver com as tabelas de acesso (mesmo projeto) ou federar a
identidade. É um passo maior, feito sistema a sistema.

---

## 4) Ordem sugerida
1. **SATE** (greenfield — sem legado para remover) — melhor piloto.
2. **GOM** (substitui o `permissoes.js` próprio).
3. **Roçadas** / **Revista** / **Repositório** (React — módulo equivalente).

## Configuração no Supabase central (uma vez)
Em **Authentication → URL Configuration → Redirect URLs**, já basta o curinga
`https://smedigital.com.br/**` (cobre todos os `/<sistema>/`).
