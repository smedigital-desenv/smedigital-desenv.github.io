# Relatório de uso — quem acessa e quem não acessa

> O script SQL desta página é **obrigatório**: sem ele nada é gravado e a aba
> **Uso** do painel aparece vazia, explicando o que falta. Rode uma vez, no SQL
> Editor do Supabase **do central**.
>
> ⚠️ O arquivo é `.md` e não `.sql` de propósito — `*.sql` está no `.gitignore`
> da rede porque script de banco costuma sair do editor com dado real colado
> junto. Copie daqui, cole lá.

## O que o relatório responde

Duas perguntas, e a segunda é a que ninguém conseguia responder antes:

1. **Quem está acessando** cada sistema, e quando foi a última vez.
2. **Quem tem acesso liberado e não usa** — a pessoa cadastrada, com papel,
   que nunca entrou ou parou de entrar.

Por isso a lista do painel **não** sai da tabela de uso: sai de `perfis`, com o
uso costurado por fora. Uma lista feita a partir dos registros de acesso só
mostra quem já acessa, que é justamente a metade fácil da pergunta.

## Como o dado nasce

```
pessoa entra em QUALQUER sistema da rede
   → acesso-sme.js confirma sessão e permissão do sistema
      → dispara registrar_acesso('<slug>')  (dispare-e-esqueça)
         → acesso_uso: 1 linha por pessoa × sistema, com último acesso e contador
   → painel do central (admin.html › Uso) cruza isso com quem TEM acesso
```

Pontos que **não** são detalhe:

- **Uma vez por sessão do navegador, por sistema.** O contador conta *sessão*,
  não página aberta. Gravar a cada carregamento inflaria o número de quem
  navega muito e custaria uma escrita por tela.
- **Nada espera pelo registro.** Ele é disparado sem `await` e qualquer falha
  dele é engolida no `console.debug`. Registro de uso não é controle de acesso:
  ele não pode barrar quem já passou por todas as checagens.
- **Simulação ("Ver como") não conta.** O super admin está olhando pelos olhos
  de outra pessoa; gravar ali inventaria acesso que ela nunca fez — o relatório
  passaria a dizer que alguém usa o sistema porque foi auditado.
- **O registro vem antes do gate de tela.** Quem entrou no sistema e esbarrou
  numa tela sem permissão *acessou o sistema*; foi só na tela errada.
- **Não é retroativo.** Quem usava a rede antes de o script rodar aparece como
  "nunca acessou" até entrar de novo. O rodapé da aba diz desde quando há
  registro, senão o relatório mente com cara de dado.
- **A função não checa permissão** — ela grava para o perfil de quem chamou, e
  só. Quem decide o que aparece é o painel, que lista apenas quem o cadastro
  alcança (papel, exceção ou super admin). Um registro para um sistema que a
  pessoa não alcança simplesmente nunca é exibido. Checar permissão aqui
  duplicaria a regra do painel em outro lugar, e as duas divergiriam na
  primeira correção feita só de um lado.

## O script

```sql
-- ===========================================================================
-- Registro de uso dos sistemas da rede (projeto CENTRAL)
-- Rode uma vez no SQL Editor. Idempotente.
-- ===========================================================================

-- 1) A tabela: uma linha por pessoa × sistema.
create table if not exists public.acesso_uso (
  perfil_id       bigint      not null references public.perfis(id)   on delete cascade,
  sistema_id      bigint      not null references public.sistemas(id) on delete cascade,
  primeiro_acesso timestamptz not null default now(),
  ultimo_acesso   timestamptz not null default now(),
  acessos         integer     not null default 1,
  primary key (perfil_id, sistema_id)
);
create index if not exists acesso_uso_sistema_idx on public.acesso_uso (sistema_id);
create index if not exists acesso_uso_ultimo_idx  on public.acesso_uso (ultimo_acesso desc);

comment on table public.acesso_uso is
  'Uso dos sistemas: uma linha por perfil × sistema. Escrita SÓ por registrar_acesso(); leitura só de super admin.';

-- 2) Ninguém escreve direto. Nem o painel.
alter table public.acesso_uso enable row level security;
revoke all on public.acesso_uso from anon, public;
grant select on public.acesso_uso to authenticated;

-- Leitura: super admin, e mais ninguém. A chamada vai dentro de (select ...)
-- para o Postgres avaliá-la uma vez por consulta, não uma vez por linha.
drop policy if exists acesso_uso_leitura_super on public.acesso_uso;
create policy acesso_uso_leitura_super on public.acesso_uso
  for select to authenticated
  using ( (select public.sou_super_admin()) );

-- Sem policy de insert/update/delete: a escrita só existe pela função abaixo.

-- 3) A função. SECURITY DEFINER porque a tabela é fechada para todo mundo.
--    Ela grava para o perfil de QUEM CHAMOU — o cliente não escolhe a
--    identidade, só o slug do sistema.
create or replace function public.registrar_acesso(p_sistema text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_perfil  public.perfis.id%type;
  v_sistema public.sistemas.id%type;
begin
  if p_sistema is null or btrim(p_sistema) = '' then return; end if;

  -- Mesma regra de identidade do resto do central: casa por auth.uid() ou,
  -- na falta dele, pelo e-mail do token.
  select p.id into v_perfil
    from public.perfis p
   where p.auth_user_id = auth.uid()
      or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
   order by (p.auth_user_id = auth.uid()) desc nulls last
   limit 1;
  if v_perfil is null then return; end if;         -- sem perfil, nada a registrar

  select s.id into v_sistema
    from public.sistemas s
   where s.slug = lower(btrim(p_sistema))
   limit 1;
  if v_sistema is null then return; end if;        -- slug desconhecido: ignora

  insert into public.acesso_uso (perfil_id, sistema_id)
       values (v_perfil, v_sistema)
  on conflict (perfil_id, sistema_id) do update
       set ultimo_acesso = now(),
           acessos       = public.acesso_uso.acessos + 1;
end;
$$;

revoke all on function public.registrar_acesso(text) from anon, public;
grant execute on function public.registrar_acesso(text) to authenticated;

-- 4) PostgREST precisa reler o schema para enxergar tabela e função novas.
notify pgrst, 'reload schema';
```

## Conferência depois de rodar

```sql
-- anon não pode nada (tem que voltar VAZIO)
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema='public' and table_name='acesso_uso' and grantee='anon';

-- nenhuma policy permissiva sem condição
select policyname, cmd from pg_policies
 where schemaname='public' and tablename='acesso_uso' and qual='true';

-- os registros chegando (rode depois de entrar em algum sistema)
select s.slug, count(*) pessoas, max(u.ultimo_acesso) mais_recente
  from public.acesso_uso u join public.sistemas s on s.id = u.sistema_id
 group by 1 order by 1;
```

Se a aba **Uso** continuar dizendo que o registro não existe, é o PostgREST com
o schema antigo em cache: rode de novo `notify pgrst, 'reload schema';`.

## A aba Uso do painel

`admin.html` › **Uso** (só super admin, como o resto do painel).

- **Cartões** — quantas pessoas o cadastro alcança, quantas acessaram no
  período, quantas pararam e quantas nunca entraram.
- **Adoção por sistema** — ordenada da menor adoção para a maior, porque o topo
  da lista é a ação a tomar. ⚠️ O denominador é **quem alcança aquele sistema**,
  não a rede inteira: comparar contra a rede faria um sistema de nicho parecer
  abandonado.
- **Pessoas** — ordenada por quem menos usa primeiro (nunca acessou, depois o
  acesso mais antigo), com filtro de sistema, período, situação e busca.
- **CSV** — a lista filtrada, com `;` e BOM (o que o Excel em pt-BR abre sem
  pedir importação). ⚠️ O arquivo leva nome e e-mail de servidor: é dado
  pessoal, nasce no computador de quem baixou e **não** entra em repositório.

⚠️ **"Sessões" não é "quantas vezes abriu a tela".** É quantas sessões de
navegador registraram aquele sistema. Quem deixa a aba aberta o dia inteiro
conta 1; quem entra de três computadores conta 3.
