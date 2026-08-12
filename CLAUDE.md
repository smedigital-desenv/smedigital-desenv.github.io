# Portal SME Digital + Controle de Acesso CENTRAL

> **Este arquivo é lido automaticamente por qualquer sessão do Claude Code
> neste repositório.** Leia antes de mexer em qualquer coisa.

Este repositório é o **hub da rede**. Ele hospeda duas coisas:

- **O portal** (`index.html`) — vitrine dos sistemas, que mostra a cada pessoa
  apenas aqueles a que ela tem acesso.
- **O Controle de Acesso CENTRAL** (`central/`) — a autenticação de toda a rede
  e o painel onde se administram sistemas, telas, papéis, perfis e vínculos de
  escola.

Publicado em `smedigital.com.br` (GitHub Pages, site de usuário — a `main` vai
para a raiz do domínio).

## O que vive aqui e afeta todos os sistemas

| Arquivo | Papel |
|---|---|
| `central/config.js` | URL e chave anon do projeto Supabase do central |
| `central/acesso-sme.js` | módulo que os sistemas carregam; expõe `window.AcessoSME` |
| `central/login.html` | tela de login única da rede |
| `central/admin.html` / `admin.js` | painel de administração de acessos |
| `permissoes_log` (tabela) | trilha de auditoria — quem alterou o quê no acesso |

⚠️ **Alterar `acesso-sme.js` afeta TODOS os sistemas da rede ao mesmo tempo.**
Não há versionamento por sistema: todos carregam o mesmo arquivo do mesmo lugar.
Uma quebra aqui derruba tudo de uma vez. Teste no `/teste` antes.

## Modelo de permissão

O acesso de uma pessoa a um sistema é concedido por **qualquer** um destes
caminhos, avaliados pela função `permissoes_json(email)`:

- ser super admin;
- ser perfil de consulta (`is_viewer`);
- ter vínculo de escola, quando o sistema tem `acesso_escola_total`;
- ter papel no sistema (`perfil_papeis`);
- ter tela liberada individualmente (`perfil_tela`).

O painel de administração é a interface disso. Mudanças de permissão acontecem
**aqui**, não nos sistemas.

## Registro de alterações (auditoria)

A tabela `permissoes_log` guarda quem alterou o quê no controle de acesso —
`perfil_tela`, `papel_permissoes`, `perfil_papeis`, `perfil_escola` e as
mudanças sensíveis em `perfis` (super admin, ativo, tipo, visualizador). Cada
linha traz o estado de antes e o de depois, em `jsonb`.

- **Quem escreve é um trigger** (`registrar_mudanca_acesso`, `SECURITY DEFINER`).
  `insert`/`update`/`delete` estão revogados para `authenticated`, `anon` e
  `public`: nem o painel consegue mexer no registro.
- **Quem lê é só super admin**, pela policy que chama `sou_super_admin()`.
- A aba **Histórico** do painel (`admin.html` / `admin.js`) é a leitura disso.
  Se a tabela ainda não existir no banco, a aba explica o que falta em vez de
  estourar erro.

Alteração em `perfis` que não toca acesso (troca de nome, por exemplo) **não é
registrada** de propósito — log cheio de ruído é log que ninguém lê.

## Integrando um sistema novo

1. Cadastrar o sistema no catálogo (`sistemas`), com suas telas e papéis.
2. No sistema, antes de qualquer outro script:
   ```html
   <script>window.ACESSO_SISTEMA = 'slug-do-sistema';</script>
   <script src="/central/config.js"></script>
   <script src="/central/acesso-sme.js"></script>
   ```
3. Adicionar o card no portal (`index.html`).
4. Se o sistema tiver banco Supabase próprio, ele precisa de uma **ponte de
   sessão** — o token do central não é reconhecido por outro projeto. O MAPA tem
   essa ponte implementada e serve de referência.
---

## Regras da rede SME — valem para TODOS os sistemas

> Esta seção é padrão e idêntica em todos os repositórios da SME Ribeirão Preto.
> Ao alterá-la, replique nos demais.

### 1. Todo repositório aqui é PÚBLICO

Trate cada commit como publicação. O histórico do Git guarda para sempre: apagar
depois exige reescrita de histórico, força-push em todas as branches e abertura
de chamado no suporte do GitHub para purgar referências em pull requests. Já
aconteceu nesta rede e levou semanas.

**Nunca versione:**

- `*.sql`, `*.csv`, `*.dump`, `*.xlsx` — script de carga e export carregam dado
  real junto, quase sempre sem quem escreveu perceber. Estão no `.gitignore`.
- Dado pessoal de qualquer natureza: nome, e-mail, RA, matrícula, CPF, telefone,
  endereço. Nem em código, nem em comentário, nem em dado de exemplo, nem em
  mensagem de commit.
- Credencial de qualquer tipo: `service_role`, senha de banco, token de API,
  chave privada.

**Pode versionar:** a chave `anon` do Supabase. Ela é pública por natureza e vai
para o navegador de qualquer visitante. A segurança real está nas permissões do
banco, nunca em esconder essa chave.

Os sistemas desta rede tratam **dados pessoais de crianças**, alguns de natureza
sensível. Isso não é hipótese: é o conteúdo real da maioria destas bases.

### 2. Login é sempre pelo Controle de Acesso CENTRAL

Nenhum sistema da rede deve ter login próprio. A autenticação acontece no
**central** (`smedigital.com.br/central/`), que governa quem entra, em quais
sistemas e em quais telas.

Integrar um sistema novo:

```html
<script>window.ACESSO_SISTEMA = 'slug-do-sistema';</script>
<script src="/central/config.js"></script>
<script src="/central/acesso-sme.js"></script>
```

Isso expõe `window.AcessoSME` com `.pronto`, `.perfil`, `.escolas`, `.sistema`,
`.can(tela, acao)`, `.token()`, `.signOut()` e `.simular()`. Sem sessão válida,
a pessoa é levada ao login do central automaticamente.

O sistema precisa estar cadastrado no catálogo do central (tabela `sistemas`),
com suas telas e papéis, antes de a integração funcionar.

**Quando o sistema tem banco Supabase próprio**, existe um degrau: um token
emitido pelo central não é reconhecido por outro projeto Supabase. É preciso uma
ponte que valide o token do central e abra sessão no projeto do sistema. O MAPA
tem essa ponte implementada (`supabase/functions/central-bridge/`) e serve de
referência — não reinvente, copie.

### 3. Segurança do banco (Supabase)

Invariantes. Quebrar qualquer uma expõe dado:

1. **O papel `anon` não tem permissão em nada.** Nem tabela, nem função. Se você
   for escrever `grant ... to anon`, pare e entenda por que aquilo está fechado.
2. **Toda tabela com dado pessoal tem RLS ligado E policy com condição real.**
   RLS ligado sem policy adequada não protege — e policies permissivas se somam
   com **OR**, então uma única `using (true)` anula todas as outras da tabela.
   Verificação canônica:
   ```sql
   select tablename, policyname, cmd from pg_policies
    where schemaname='public' and qual='true' and cmd in ('SELECT','ALL');
   ```
   Só catálogo e configuração podem aparecer aí.
3. **View materializada IGNORA RLS.** É cópia física dos dados. Proteger só a
   tabela de origem é proteção de fachada; revogue o acesso direto e exponha por
   função.
4. **Função `SECURITY DEFINER` ignora RLS** — ela roda com o poder do dono. Ou
   aplica o recorte por dentro, ou não deveria ser `DEFINER`.
5. **O filtro feito em JavaScript não é segurança.** É conforto visual. Quem
   abre o DevTools vê tudo que o banco entregou. A regra tem que estar no
   Postgres.

**Desempenho:** chamadas de função dentro de policy precisam ser envolvidas em
`(select ...)`, senão são reavaliadas linha a linha e a consulta estoura tempo
até em tabela pequena:

```sql
using ( (select public.minha_funcao()) or coluna = ... )
```

### 4. Armadilhas de publicação

- **O `git push` feito por automação não dispara o workflow de deploy.** Rode
  manualmente pela aba Actions depois de publicar.
- **Confirme o push por hash, não pela mensagem.** `git push | tail` esconde
  "Everything up-to-date":
  ```bash
  git fetch origin -q && git rev-parse --short origin/main
  ```
- **O SQL Editor do Supabase envolve o script inteiro numa transação.** Um erro
  no meio **desfaz tudo que veio antes**, e o painel mostra só a mensagem do
  erro — parece que o resto passou. Ao falhar no meio, presuma que nada rodou.
- **Edge Function não vai junto no deploy do site.** Alterá-la exige republicar
  pelo painel do Supabase ou pela CLI. Front-end e função desalinhados produzem
  erros que não parecem versão.

### 5. Ao investigar um problema

1. `403` / `permission denied` costuma ser proteção funcionando, não avaria.
   Antes de conceder acesso, entenda por que aquilo está fechado.
2. Erro **intermitente** que "funciona depois de algumas tentativas" é assinatura
   de **corrida**, não de configuração. Procure o que executa o mesmo código duas
   vezes (prerender, prefetch, listener duplicado, aba oculta).
3. Timeout em tabela pequena é estatística velha ou instância saturada. Rode
   `ANALYZE` e verifique a capacidade no painel antes de culpar policy.
4. Antes de propor `grant`, releia a seção 3.

### 6. Manutenção deste arquivo

Ao alterar arquitetura, modelo de acesso, fluxo de autenticação ou processo de
publicação, **atualize este arquivo no mesmo commit**. Não espere que peçam.
Documento desatualizado é pior que nenhum: induz ao erro com aparência de
autoridade.
