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
| `acesso_uso` (tabela) | registro de uso — quem entrou em cada sistema, e quando |

⚠️ **Alterar `acesso-sme.js` afeta TODOS os sistemas da rede ao mesmo tempo.**
Não há versionamento por sistema: todos carregam o mesmo arquivo do mesmo lugar.
Uma quebra aqui derruba tudo de uma vez. Teste no `/teste` antes.

## Modelo de permissão

Quem decide o que uma pessoa vê em cada tela é a função `permissoes_json(email)`.
Ela avalia uma **cadeia de precedência** — o primeiro caso que se aplica decide,
e os de baixo nem são consultados:

| Ordem | Origem | Decide |
|---|---|---|
| 1º | super admin | vê tudo, sempre |
| 2º | `perfil_tela` — exceção individual | **concede ou NEGA** |
| 3º | `papel_permissoes` — papel da pessoa | concede ou nega |
| 4º | `is_viewer` / vínculo de escola com `acesso_escola_total` | concede |
| — | nada disso | não vê |

⚠️ **A ordem importa e não é a intuitiva.** A exceção individual **vence o
papel**. Uma linha em `perfil_tela` com `pode_ver = false` tira a tela de alguém
mesmo que o papel dela conceda — é assim que se faz o recorte de uma pessoa só,
sem inventar papel novo para cada exceção.

O modelo anterior somava tudo com **OR** (`bool_or`): bastava um caminho
conceder para a pessoa ver, e `perfil_tela` só conseguia adicionar, nunca tirar.
Se você encontrar `bool_or` de volta nessa função, alguém desfez isto.

O painel de administração é a interface disso. Mudanças de permissão acontecem
**aqui**, não nos sistemas.

### Papel é o padrão; exceção é o desvio

O acesso normal de uma pessoa **vem do papel**, e por isso se ajusta sozinho:
marcar uma tela nova em `papel_permissoes` alcança na hora todo mundo que tem
aquele papel, sem tocar em ninguém individualmente.

Uma linha em `perfil_tela` faz o oposto — ela **congela**. A partir dela aquela
pessoa para de acompanhar o papel naquela tela, para sempre, até alguém apagar
a linha. Por isso a aba Acessos mostra cada tela em um de dois modos:

| Modo | Significa |
|---|---|
| **segue o papel** (cinza, sem linha em `perfil_tela`) | acompanha o papel, hoje e no futuro |
| **exceção** (amarelo, com linha) | decide sozinha — libera ou **nega** — e ignora o papel |

⚠️ **Nunca copie o papel para `perfil_tela` em massa.** É o jeito fácil de
"deixar tudo marcado" e é exatamente o que quebra o ajuste automático: a pessoa
fica com o retrato de hoje e não recebe a tela de amanhã. O painel tinha um
atalho que fazia isso ("Liberar como papel") e ele foi removido.

Exceção que apenas repete o que o papel já concede não excetua nada — só
congela. Verificação:

```sql
select s.slug, t.slug, count(*)
  from perfil_tela pt
  join telas t on t.id = pt.tela_id
  join sistemas s on s.id = t.sistema_id
  join perfil_papeis pp on pp.perfil_id = pt.perfil_id
  join papeis pa on pa.id = pp.papel_id and pa.sistema_id = s.id
  join papel_permissoes ppm on ppm.papel_id = pa.id and ppm.tela_id = t.id
 where coalesce(pt.pode_ver,false) = coalesce(ppm.pode_ver,false)
 group by 1,2;
```

**Tela nova nasce fechada.** Cadastrar uma tela no catálogo não a concede a
papel nenhum — é preciso marcá-la no papel. Isso é deliberado: errar para o
lado de esconder é visível e reclamável; errar para o lado de mostrar é
invisível e grave.

A exceção a isso é a coluna `papeis.auto_novas_telas`. Quando ela é `true`, o
gatilho `trg_tela_nova_para_papeis` marca automaticamente toda tela nova
daquele sistema naquele papel, com `pode_ver` e **sem** `editar`/`exportar`.
Nasce `false` em todo papel: ligar é decisão por papel, nunca da rede inteira.

⚠️ **Olhe o alcance antes de ligar.** O papel `escola` do MAPA tem ~284
pessoas: com a chave ligada, uma tela cadastrada às 10h aparece para todas elas
às 10h01, ainda em construção. Ligue primeiro num papel administrativo, teste
com uma tela descartável, e só depois considere os papéis grandes.

Rede de segurança — telas recentes e quantas pessoas cada uma alcançou:

```sql
select t.id, s.slug, t.slug, count(distinct pp.perfil_id) as pessoas
  from telas t
  join sistemas s on s.id = t.sistema_id
  left join papel_permissoes ppm on ppm.tela_id = t.id and ppm.pode_ver
  left join perfil_papeis pp on pp.papel_id = ppm.papel_id
 group by t.id, s.slug, t.slug order by t.id desc limit 20;
```

**`is_viewer` não é papel.** É uma coluna em `perfis`, avaliada direto pela
`permissoes_json`. Os papéis chamados "Visualizador" no catálogo têm zero
pessoas em todos os sistemas — são casca. Marcar um deles não concede nada.

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

## Registro de uso (quem acessa e quem não acessa)

A tabela `acesso_uso` guarda **uma linha por pessoa × sistema**, com primeiro
acesso, último acesso e um contador. É o que alimenta a aba **Uso** do painel.
O script SQL e o desenho completo estão em
[`central/RELATORIO-ACESSO.md`](central/RELATORIO-ACESSO.md).

- **Quem escreve é a RPC `registrar_acesso(slug)`** (`SECURITY DEFINER`),
  disparada pelo `acesso-sme.js` depois de confirmado o acesso ao sistema. A
  identidade vem de `auth.uid()`/e-mail do token — o cliente manda o slug, não
  quem ele é. `insert`/`update`/`delete` na tabela estão revogados para
  `authenticated`, `anon` e `public`.
- **Quem lê é só super admin**, pela policy que chama `sou_super_admin()`.

⚠️ **O registro é dispare-e-esqueça, e tem que continuar sendo.** Nada da tela
espera por ele e qualquer falha morre num `console.debug`. Registro de uso não é
controle de acesso: ele não pode barrar quem já passou pelas checagens de
permissão. Se você transformá-lo em `await`, uma indisponibilidade do central
vira login travado em **todos** os sistemas da rede de uma vez.

⚠️ **Uma vez por sessão do navegador, por sistema** (chave `ACESSO_USO_v1` no
`sessionStorage`). O contador conta sessão, não página aberta — gravar a cada
carregamento inflaria o número de quem navega muito e custaria uma escrita por
tela.

⚠️ **Simulação ("Ver como") NÃO registra.** O super admin está olhando pelos
olhos de outra pessoa; gravar ali inventaria acesso que ela nunca fez, e o
relatório passaria a dizer que alguém usa o sistema porque foi auditado.

⚠️ **O relatório lista `perfis`, não `acesso_uso`.** A pergunta que ninguém
conseguia responder antes é a do lado vazio — quem tem acesso liberado e não
usa. Uma lista montada a partir dos registros de acesso só mostra quem já
acessa. Se alguém "simplificar" isso para ler direto da tabela de uso, metade
do relatório desaparece sem erro nenhum.

⚠️ **Quem decide o denominador é `perfilAlcancaSistema()`, no `admin.js`** —
super admin, papel ou exceção. É a MESMA função que a aba Usuários usa para
filtrar por sistema, e isso é de propósito: duplicá-la faria as duas telas
discordarem sobre quem deveria estar acessando, que é justamente a conta do
relatório.

⚠️ **Nada disso é retroativo.** Quem usava a rede antes de o script rodar
aparece como "nunca acessou" até entrar de novo. O rodapé da aba diz desde
quando há registro — não remova, senão o relatório mente com cara de dado.

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

#### A guarda anti-vazamento

Nada disso depende de alguém lembrar. Uma guarda automática barra arquivo de
dados, CPF, chave privada, `service_role` e lista de e-mails **antes** de
virarem publicação. Ela é versionada em
`.claude/hooks/verificar-vazamento.sh` e roda em quatro portas — porque fechar
só uma não fecha nada:

| Porta | Cobre |
|---|---|
| `PreToolUse` / Bash | `git commit` e `git push` feitos pelo Claude Code |
| `PreToolUse` / MCP do GitHub | escrita direta pela API (`create_or_update_file`, `push_files`), que não passa por git nenhum |
| `pre-commit` do git | quem commita fora do Claude Code — terminal, VS Code, GitHub Desktop |
| `pre-push` do git | última barreira antes de o conteúdo sair da máquina |

As duas últimas se instalam sozinhas: `.githooks/` é versionado e o
`SessionStart` aponta `core.hooksPath` para lá. À mão, uma vez por clone:
`git config core.hooksPath .githooks`.

⚠️ **Em cada COMPUTADOR ou dispositivo, rode o instalador uma vez.** Ele passa a
valer para **todo** repositório daquela máquina — inclusive os que ainda não
existem — e para **toda** sessão do Claude Code daquela conta, porque entra em
`~/.claude/settings.json`, que é do usuário e não do projeto:

```bash
curl -fsSL https://smedigital.com.br/guarda/instalar.sh | bash
```

⚠️ **O `git commit` passar não é sinal verde: o push é conferido de novo.** A
válvula `SME_PERMITIR_COMMIT=1` destranca UMA porta, não a publicação — o que
entrou por ela continua barrado no `push`. É de propósito: um descuido não pode
virar publicação por causa de uma variável de ambiente.

⚠️ **A guarda ignora as EXCLUSÕES (`--diff-filter=d`).** Apagar um arquivo
proibido é a correção, não a falta. Até 2026-08-25 ela olhava `--name-only`
puro e barrava justamente o commit que limpava o vazamento — ou seja, tornava
permanente qualquer vazamento que já tivesse acontecido.

⚠️ **E-mail institucional também é dado pessoal.** Três ou mais endereços
`.gov.br` distintos no mesmo diff bloqueiam; um endereço de contato num
documento passa. O vazamento de 2026-08 foram 3.152 endereços institucionais
dentro de scripts de carga, e a regra antiga liberava `.gov.br` inteiro.

⚠️ **O `%` fica FORA da parte local do e-mail, e isso não é descuido de
regex.** Com ele, o coringa do SQL (`email like '%@educacao.pmrp.sp.gov.br'`)
casa como se fosse endereço de gente, e uma checagem de domínio vira "dado
pessoal publicado". Foi assim que a auditoria acusou quatro arquivos do `lunar`
que não tinham endereço nenhum de pessoa.

⚠️ **Nada disso apaga o histórico, e o `.gitignore` não destrava arquivo já
rastreado.** A guarda impede o PRÓXIMO vazamento. O que já foi publicado só sai
com reescrita de histórico e força-push.

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
