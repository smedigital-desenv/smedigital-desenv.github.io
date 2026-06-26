-- ============================================================================
-- GOM no controle central — PARTE B (usuários -> papel) + ajuste de domínio.
--
-- PRÉ-REQUISITO: rode antes a PARTE A (gom_papeis.sql) no CENTRAL, que cria as
-- telas, os papéis (admin_gom/secretaria/empresa/escola) e suas permissões.
--
-- Fonte dos usuários: Supabase PRÓPRIO do GOM (iqldovwttomkjkoakosc), tabela
-- public.perfis (colunas: email, perfil, ativo).
-- ============================================================================


-- ████████████████████████████████████████████████████████████████████████████
-- GERADOR ÚNICO — rode no SUPABASE DO GOM, cole o resultado no CENTRAL.
-- Mapeia: ADMIN_GOM->admin_gom | SECRETARIA/GOM->secretaria | EMPRESA->empresa | ESCOLA->escola
--         tipo central: EMPRESA->externo | ESCOLA->escola | demais->secretaria
-- ████████████████████████████████████████████████████████████████████████████
with base as (
  select lower(trim(email)) as email,
         case upper(coalesce(perfil,''))
           when 'EMPRESA' then 'externo' when 'ESCOLA' then 'escola' else 'secretaria' end as tipo,
         case upper(coalesce(perfil,''))
           when 'ADMIN_GOM' then 'admin_gom' when 'ADMIN-GOM' then 'admin_gom'
           when 'EMPRESA' then 'empresa' when 'ESCOLA' then 'escola' else 'secretaria' end as papel,
         coalesce(ativo, true) as ativo
  from public.perfis
  where email is not null and trim(email) <> ''
),
ins_perfis as (
  select coalesce(
    'insert into public.perfis (email, tipo, is_super_admin, ativo) values '
    || string_agg(distinct format('(%L,%L,false,%L)', email, tipo, ativo), ',')
    || ' on conflict (email) do nothing;', '-- perfis GOM: vazio') as sql
  from base
),
ins_papeis as (
  select coalesce(
    'insert into public.perfil_papeis (perfil_id, papel_id) select p.id, pa.id from (values '
    || string_agg(distinct format('(%L,%L)', email, papel), ',')
    || ') as v(email, papel) join public.perfis p on lower(p.email)=v.email'
    || ' join public.sistemas s on s.slug=''gom'''
    || ' join public.papeis pa on pa.sistema_id=s.id and pa.slug=v.papel'
    || ' where not exists (select 1 from public.perfil_papeis pp where pp.perfil_id=p.id and pp.papel_id=pa.id and pp.escola_id is null);',
    '-- perfil_papeis GOM: vazio') as sql
  from base
)
select 'begin;' || E'\n\n' || ins_perfis.sql || E'\n\n' || ins_papeis.sql || E'\n\ncommit;'
from ins_perfis, ins_papeis;


-- ████████████████████████████████████████████████████████████████████████████
-- AJUSTE DE DOMÍNIO — rode no CENTRAL (1x). Permite login de parceiros EMPRESA
-- (fora de @educacao...) desde que cadastrados como tipo='externo'.
-- ████████████████████████████████████████████████████████████████████████████
create or replace function public.minhas_permissoes()
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_perfil public.perfis%rowtype;
begin
  select * into v_perfil from public.perfis
   where lower(email) = public.jwt_email() and ativo = true limit 1;

  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;

  -- Domínio institucional OU super admin OU parceiro externo (empresa/fornecedor).
  if not v_perfil.is_super_admin
     and lower(v_perfil.email) not like '%@educacao.pmrp.sp.gov.br'
     and coalesce(v_perfil.tipo,'') <> 'externo' then
    return json_build_object('autorizado', false, 'motivo', 'dominio');
  end if;

  if v_perfil.auth_user_id is null then
    update public.perfis
       set auth_user_id = (nullif(current_setting('request.jwt.claims', true),'')::json ->> 'sub')::uuid
     where id = v_perfil.id;
  end if;

  return public.permissoes_json(v_perfil.email);
end;
$$;
