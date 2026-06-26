-- ============================================================================
-- CONTROLE DE ACESSO CENTRAL DA REDE SME — Ribeirão Preto
-- Projeto Supabase CENTRAL (NOVO — criado do zero).
-- Modelado a partir do sistema do MAPA (smedigital-desenv/mapa-sme),
-- consolidando sql/07_controle_acesso + 08_perfil_telas + 10_simular_acesso.
-- ----------------------------------------------------------------------------
-- Como aplicar:
--   1. Crie um novo projeto no Supabase (este é o CENTRAL da rede).
--   2. Auth > Providers: habilite Google. Restrinja por domínio no app.
--   3. SQL Editor: cole este arquivo INTEIRO e clique em Run.
--   4. Copie a URL e a anon key do projeto para central/config.js.
--   5. Auth > URL Configuration: adicione a origem do portal
--      (https://smedigital.com.br) em Site URL e Redirect URLs.
--
-- Idempotente: pode rodar de novo com segurança em homologação.
-- ============================================================================

-- ============================================================================
-- 1) TABELAS
-- ============================================================================

-- Escolas da rede
create table if not exists public.escolas (
  id                  bigint generated always as identity primary key,
  codigo_inep         text unique,
  nome                text not null,
  email_institucional text,
  ativo               boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Perfis = allowlist de usuários. Chave natural = e-mail (Google).
-- A secretaria cadastra o e-mail ANTES de a pessoa logar.
create table if not exists public.perfis (
  id             bigint generated always as identity primary key,
  email          text not null unique,            -- e-mail Google autorizado (lowercase)
  nome           text,
  tipo           text not null default 'escola',  -- 'secretaria' | 'escola' | 'externo'
  auth_user_id   uuid,                            -- preenchido no 1º login (referência a auth.users)
  is_super_admin boolean not null default false,  -- acesso total (administra tudo)
  ativo          boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists idx_perfis_email on public.perfis (lower(email));

-- Vínculo N:N usuário <-> escola
create table if not exists public.perfil_escola (
  perfil_id bigint not null references public.perfis(id)  on delete cascade,
  escola_id bigint not null references public.escolas(id) on delete cascade,
  vinculo   text,                                 -- 'gestor','coordenador','professor'...
  primary key (perfil_id, escola_id)
);

-- Sistemas da rede (central, mapa, gom, sate, rocada, ...). url = caminho no domínio.
create table if not exists public.sistemas (
  id    bigint generated always as identity primary key,
  slug  text not null unique,                     -- 'mapa','gom','sate'...
  nome  text not null,
  url   text,                                     -- '/mapa-sme/' etc
  icone text,                                     -- classe bootstrap-icons, ex 'bi-map-fill'
  cor   text,                                     -- cor do card no portal
  ordem int not null default 0,
  ativo boolean not null default true
);

-- Telas dentro de cada sistema (avaliacao, atribuicao, ...)
create table if not exists public.telas (
  id         bigint generated always as identity primary key,
  sistema_id bigint not null references public.sistemas(id) on delete cascade,
  slug       text not null,                       -- 'avaliacao','atribuicao'...
  nome       text not null,
  ordem      int not null default 0,
  unique (sistema_id, slug)
);

-- Papéis por sistema (admin, editor, leitor) — atalho opcional
create table if not exists public.papeis (
  id         bigint generated always as identity primary key,
  sistema_id bigint not null references public.sistemas(id) on delete cascade,
  slug       text not null,
  nome       text not null,
  unique (sistema_id, slug)
);

-- O que cada papel pode fazer em cada tela
create table if not exists public.papel_permissoes (
  papel_id      bigint not null references public.papeis(id) on delete cascade,
  tela_id       bigint not null references public.telas(id)  on delete cascade,
  pode_ver      boolean not null default true,
  pode_editar   boolean not null default false,
  pode_exportar boolean not null default false,
  primary key (papel_id, tela_id)
);

-- Atribuição: que papel um perfil tem em cada sistema (escola opcional)
create table if not exists public.perfil_papeis (
  id        bigint generated always as identity primary key,
  perfil_id bigint not null references public.perfis(id)  on delete cascade,
  papel_id  bigint not null references public.papeis(id)  on delete cascade,
  escola_id bigint references public.escolas(id) on delete cascade,
  unique (perfil_id, papel_id, escola_id)
);

-- LIBERAÇÃO DIRETA de tela por perfil (o jeito que a secretaria administra:
-- 1 checkbox por tela). É a fonte principal usada pelo PAINEL DE ADMINISTRAÇÃO.
create table if not exists public.perfil_tela (
  perfil_id     bigint not null references public.perfis(id) on delete cascade,
  tela_id       bigint not null references public.telas(id)  on delete cascade,
  pode_ver      boolean not null default true,
  pode_editar   boolean not null default false,
  pode_exportar boolean not null default false,
  primary key (perfil_id, tela_id)
);

-- ============================================================================
-- 2) FUNÇÕES AUXILIARES (SECURITY DEFINER p/ ler perfis sob RLS)
-- ============================================================================

-- E-mail do usuário autenticado, a partir do JWT do Supabase Auth.
create or replace function public.jwt_email()
returns text language sql stable as $$
  select lower(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email')
$$;

-- id do perfil ativo correspondente ao e-mail logado (ou NULL).
create or replace function public.current_perfil_id()
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.perfis
  where lower(email) = public.jwt_email() and ativo = true
  limit 1
$$;

-- É super admin?
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_super_admin from public.perfis
       where lower(email) = public.jwt_email() and ativo = true limit 1),
    false)
$$;

-- ============================================================================
-- 3) BUILDER ÚNICO do mapa de acesso (sem efeitos colaterais).
--    Fonte única da verdade — usada por minhas_permissoes() e permissoes_de().
--    Une 3 fontes de acesso a tela:
--      1) super admin  -> vê tudo;
--      2) perfil_tela  -> liberações diretas por perfil (jeito novo);
--      3) papel/papel_permissoes -> compatibilidade com atalho por papel.
-- ============================================================================
create or replace function public.permissoes_json(p_email text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_perfil public.perfis%rowtype;
  v_result json;
begin
  select * into v_perfil from public.perfis
   where lower(email) = lower(p_email) and ativo = true
   limit 1;

  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;

  select json_build_object(
    'autorizado', true,
    'perfil', json_build_object(
        'id', v_perfil.id, 'nome', v_perfil.nome, 'email', v_perfil.email,
        'tipo', v_perfil.tipo, 'is_super_admin', v_perfil.is_super_admin),
    'escolas', coalesce((
        select json_agg(json_build_object('id', e.id, 'nome', e.nome, 'vinculo', pe.vinculo) order by e.nome)
        from public.perfil_escola pe join public.escolas e on e.id = pe.escola_id
        where pe.perfil_id = v_perfil.id and e.ativo = true), '[]'::json),
    'sistemas', coalesce((
        select json_agg(s_obj order by ordem) from (
          select s.ordem,
            json_build_object(
              'slug', s.slug, 'nome', s.nome, 'url', s.url, 'icone', s.icone, 'cor', s.cor,
              'papel', (case when v_perfil.is_super_admin then 'admin' else coalesce(pp_papel.slug,'perfil') end),
              -- telas que o usuário pode VER neste sistema (união das 3 fontes)
              'telas', coalesce((
                 select json_object_agg(tl.slug, json_build_object(
                          'nome', tl.nome, 'ver', tl.ver, 'editar', tl.editar, 'exportar', tl.exportar))
                 from (
                   select t.slug, max(t.nome) as nome,
                          bool_or(src.ver) as ver, bool_or(src.editar) as editar, bool_or(src.exportar) as exportar
                   from public.telas t
                   join lateral (
                     select true as ver, true as editar, true as exportar where v_perfil.is_super_admin
                     union all
                     select pt.pode_ver, pt.pode_editar, pt.pode_exportar
                     from public.perfil_tela pt where pt.tela_id = t.id and pt.perfil_id = v_perfil.id
                     union all
                     select perm.pode_ver, perm.pode_editar, perm.pode_exportar
                     from public.papel_permissoes perm where perm.tela_id = t.id and perm.papel_id = pp_papel.id
                   ) src on true
                   where t.sistema_id = s.id
                   group by t.slug
                   having bool_or(src.ver)
                 ) tl
                ), '{}'::json)
            ) as s_obj
          from public.sistemas s
          left join lateral (
             select pa.id, pa.slug
             from public.perfil_papeis pp
             join public.papeis pa on pa.id = pp.papel_id and pa.sistema_id = s.id
             where pp.perfil_id = v_perfil.id
             limit 1
          ) pp_papel on true
          where s.ativo = true
            and (
              v_perfil.is_super_admin
              or pp_papel.id is not null
              or exists (
                 select 1 from public.perfil_tela pt
                 join public.telas t on t.id = pt.tela_id
                 where pt.perfil_id = v_perfil.id and t.sistema_id = s.id and pt.pode_ver)
            )
        ) sis
      ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- minhas_permissoes() — usa o builder, mantém restrição de domínio + 1º acesso.
-- VOLATILE: grava auth_user_id no 1º login (escrita exige VOLATILE).
-- ----------------------------------------------------------------------------
create or replace function public.minhas_permissoes()
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_perfil public.perfis%rowtype;
begin
  select * into v_perfil from public.perfis
   where lower(email) = public.jwt_email() and ativo = true limit 1;

  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;

  -- RESTRIÇÃO DE DOMÍNIO: só @educacao.pmrp.sp.gov.br (super admin é exceção).
  if not v_perfil.is_super_admin
     and lower(v_perfil.email) not like '%@educacao.pmrp.sp.gov.br' then
    return json_build_object('autorizado', false, 'motivo', 'dominio');
  end if;

  -- grava o auth_user_id no 1º acesso
  if v_perfil.auth_user_id is null then
    update public.perfis
       set auth_user_id = (nullif(current_setting('request.jwt.claims', true),'')::json ->> 'sub')::uuid
     where id = v_perfil.id;
  end if;

  return public.permissoes_json(v_perfil.email);
end;
$$;

-- ----------------------------------------------------------------------------
-- permissoes_de(email) — super admin obtém as permissões de outro perfil
-- para SIMULAR o acesso ("ver como").
-- ----------------------------------------------------------------------------
create or replace function public.permissoes_de(p_email text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    return json_build_object('autorizado', false, 'motivo', 'sem_permissao');
  end if;
  return public.permissoes_json(p_email);
end;
$$;

-- ----------------------------------------------------------------------------
-- tem_permissao(sistema, tela, acao) — helper para RLS nas tabelas de DADOS
-- dos sistemas (fase 4). Retorna true se o usuário logado pode a ação na tela.
-- ----------------------------------------------------------------------------
create or replace function public.tem_permissao(p_sistema text, p_tela text, p_acao text default 'ver')
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_super_admin() then true
    else exists (
      select 1
      from public.telas t
      join public.sistemas s on s.id = t.sistema_id and s.slug = lower(p_sistema)
      where t.slug = lower(p_tela)
        and (
          exists (
            select 1 from public.perfil_tela pt
            where pt.tela_id = t.id and pt.perfil_id = public.current_perfil_id()
              and case lower(p_acao)
                    when 'editar'   then pt.pode_editar
                    when 'exportar' then pt.pode_exportar
                    else pt.pode_ver end
          )
          or exists (
            select 1
            from public.perfil_papeis pp
            join public.papel_permissoes perm on perm.papel_id = pp.papel_id and perm.tela_id = t.id
            where pp.perfil_id = public.current_perfil_id()
              and case lower(p_acao)
                    when 'editar'   then perm.pode_editar
                    when 'exportar' then perm.pode_exportar
                    else perm.pode_ver end
          )
        )
    )
  end
$$;

grant execute on function public.minhas_permissoes()                 to authenticated, anon;
grant execute on function public.permissoes_de(text)                 to authenticated;
grant execute on function public.tem_permissao(text, text, text)     to authenticated;

-- ============================================================================
-- 4) RLS — habilita em todas as tabelas
-- ============================================================================
alter table public.escolas          enable row level security;
alter table public.perfis           enable row level security;
alter table public.perfil_escola    enable row level security;
alter table public.sistemas         enable row level security;
alter table public.telas            enable row level security;
alter table public.papeis           enable row level security;
alter table public.papel_permissoes enable row level security;
alter table public.perfil_papeis    enable row level security;
alter table public.perfil_tela      enable row level security;

-- Catálogo (escolas, sistemas, telas, papeis, papel_permissoes):
-- leitura p/ autenticados; escrita só super admin.
do $$
declare t text;
begin
  foreach t in array array['escolas','sistemas','telas','papeis','papel_permissoes']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_adm', t);
    execute format($f$create policy %I on public.%I for select to authenticated using (true)$f$, t||'_sel', t);
    execute format($f$create policy %I on public.%I for all to authenticated
                       using (public.is_super_admin()) with check (public.is_super_admin())$f$, t||'_adm', t);
  end loop;
end $$;

-- Perfis: cada um lê o próprio; super admin lê/escreve todos.
drop policy if exists perfis_self  on public.perfis;
drop policy if exists perfis_admin on public.perfis;
create policy perfis_self  on public.perfis for select to authenticated
  using (lower(email) = public.jwt_email() or public.is_super_admin());
create policy perfis_admin on public.perfis for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Vínculos / atribuições / liberações: usuário lê os próprios; super admin gerencia.
drop policy if exists perfil_escola_self  on public.perfil_escola;
drop policy if exists perfil_escola_admin on public.perfil_escola;
create policy perfil_escola_self  on public.perfil_escola for select to authenticated
  using (perfil_id = public.current_perfil_id() or public.is_super_admin());
create policy perfil_escola_admin on public.perfil_escola for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists perfil_papeis_self  on public.perfil_papeis;
drop policy if exists perfil_papeis_admin on public.perfil_papeis;
create policy perfil_papeis_self  on public.perfil_papeis for select to authenticated
  using (perfil_id = public.current_perfil_id() or public.is_super_admin());
create policy perfil_papeis_admin on public.perfil_papeis for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists perfil_tela_self  on public.perfil_tela;
drop policy if exists perfil_tela_admin on public.perfil_tela;
create policy perfil_tela_self  on public.perfil_tela for select to authenticated
  using (perfil_id = public.current_perfil_id() or public.is_super_admin());
create policy perfil_tela_admin on public.perfil_tela for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ============================================================================
-- 5) SEED — super admins + sistemas da rede + telas iniciais
-- ============================================================================

-- Super admins iniciais (contas administrativas + e-mails institucionais).
insert into public.perfis (email, nome, tipo, is_super_admin)
values
  ('desenv.sme@gmail.com',                    'Desenvolvimento SME', 'secretaria', true),
  ('diogoperez@educacao.pmrp.sp.gov.br',      'Diogo Perez',         'secretaria', true),
  ('matheusprospero@educacao.pmrp.sp.gov.br', 'Matheus Prospero',    'secretaria', true),
  ('matheusprospero@gmail.com',               'Matheus Prospero',    'secretaria', true)
on conflict (email) do update set is_super_admin = true, tipo = 'secretaria', ativo = true;

-- Sistemas da rede (alinhados ao portal smedigital.com.br).
insert into public.sistemas (slug, nome, url, icone, cor, ordem) values
  ('central',     'Painel Central',         '/central/',     'bi-shield-lock-fill', '#7c3aed', 0),
  ('mapa',        'MAPA',                   '/mapa-sme/',    'bi-map-fill',         '#002b5e', 1),
  ('gom',         'GOM',                    '/gom-sme/',     'bi-tools',            '#b45309', 2),
  ('sate',        'SATE',                   '/sate-sme/',    'bi-bus-front-fill',   '#0e7490', 3),
  ('rocada',      'Roçadas',                '/rocada/',      'bi-tree-fill',        '#15803d', 4),
  ('repositorio', 'Repositório Pedagógico', '/repositorio/', 'bi-journals',         '#9333ea', 5),
  ('revista',     'Portfólio MAG',          '/revista/',     'bi-book-half',        '#be123c', 6),
  ('presenca',    'Validação de Presença',  '/presenca/',    'bi-check2-circle',    '#0d9488', 7)
on conflict (slug) do update
  set nome=excluded.nome, url=excluded.url, icone=excluded.icone, cor=excluded.cor, ordem=excluded.ordem;

-- Telas do PAINEL CENTRAL (o próprio painel de administração).
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('acessos',  'Acessos por tela', 1),
    ('usuarios', 'Usuários',         2),
    ('escolas',  'Escolas',          3),
    ('catalogo', 'Catálogo',         4),
    ('simular',  'Ver como',         5)
  ) as x(slug,nome,ordem)
where s.slug = 'central'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- Telas conhecidas do MAPA (referência; demais sistemas registram via Catálogo).
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('avaliacao','Avaliações',1),
    ('atribuicao','Atribuição',2),
    ('elefante','Elefante Letrado',3),
    ('fluencia','Fluência Leitora',4),
    ('educacao_especial','Educação Especial',5),
    ('relatorios','Relatórios',6)
  ) as x(slug,nome,ordem)
where s.slug = 'mapa'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- ============================================================================
-- PRONTO. O PAINEL DE ADMINISTRAÇÃO (central/admin.html), visível só para
-- super admin, usa estas tabelas via supabase-js autenticado:
--   perfis        — cadastro de e-mails autorizados
--   perfil_tela   — liberação de telas por perfil (1 checkbox por tela)
--   perfil_escola — vínculo do perfil com a unidade
--   sistemas/telas — catálogos (e cadastro de novas telas)
-- e as RPCs minhas_permissoes() / permissoes_de() para "ver como".
-- ============================================================================
