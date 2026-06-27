-- ============================================================================
-- PORTFÓLIO MAG (revista) — PARTE B (usuários -> papel).
-- PRÉ-REQUISITO: rodar antes revista_papeis.sql (Parte A) no CENTRAL.
-- Fonte: Supabase do Revista, tabela public.usuarios(email, perfil, ativo).
-- 'publico' entra como tipo externo + bypass_dominio (pode ser fora do domínio).
-- ============================================================================

-- ████████████████████████████████████████████████████████████████████████████
-- GERADOR ÚNICO — rode no SUPABASE DO REVISTA, cole o resultado no CENTRAL.
-- Mapeia: perfil 'secretaria' -> papel 'secretaria' (tipo secretaria)
--         qualquer outro     -> papel 'publico'    (tipo externo, bypass_dominio)
-- ████████████████████████████████████████████████████████████████████████████
with base as (
  select lower(trim(email)) as email,
         case lower(coalesce(perfil,'')) when 'secretaria' then 'secretaria' else 'escola' end as tipo,
         case lower(coalesce(perfil,'')) when 'secretaria' then 'secretaria' else 'publico' end as papel,
         coalesce(ativo, true) as ativo
  from public.usuarios
  where email is not null and trim(email) <> ''
),
ins_perfis as (
  select coalesce(
    'insert into public.perfis (email, tipo, is_super_admin, bypass_dominio, ativo) values '
    || string_agg(distinct format('(%L,%L,false,%L,true)', email, tipo, (tipo = 'externo')), ',')
    || ' on conflict (email) do nothing;', '-- perfis revista: vazio') as sql
  from base
),
ins_papeis as (
  select coalesce(
    'insert into public.perfil_papeis (perfil_id, papel_id) select p.id, pa.id from (values '
    || string_agg(distinct format('(%L,%L)', email, papel), ',')
    || ') as v(email, papel) join public.perfis p on lower(p.email)=v.email'
    || ' join public.sistemas s on s.slug=''revista'''
    || ' join public.papeis pa on pa.sistema_id=s.id and pa.slug=v.papel'
    || ' where not exists (select 1 from public.perfil_papeis pp where pp.perfil_id=p.id and pp.papel_id=pa.id and pp.escola_id is null);',
    '-- perfil_papeis revista: vazio') as sql
  from base
)
select 'begin;' || E'\n\n' || ins_perfis.sql || E'\n\n' || ins_papeis.sql || E'\n\ncommit;'
from ins_perfis, ins_papeis;
