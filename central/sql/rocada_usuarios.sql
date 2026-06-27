-- ============================================================================
-- ROÇADAS no controle central — PARTE B (usuários -> papel).
-- PRÉ-REQUISITO: rodar antes rocada_papeis.sql (Parte A) no CENTRAL.
-- Fonte: Supabase do Roçadas, tabela public.perfis(user_id, perfil) + auth.users.
--
-- O ajuste de domínio (permitir tipo='externo') já foi aplicado na migração do
-- GOM (gom_usuarios.sql) — vale para a EMPRESA do Roçadas também.
-- ============================================================================

-- ████████████████████████████████████████████████████████████████████████████
-- GERADOR ÚNICO — rode no SUPABASE DO ROÇADAS, cole o resultado no CENTRAL.
-- Mapeia: SME->papel 'sme' (tipo secretaria) | EMPRESA->papel 'empresa' (tipo externo)
-- ████████████████████████████████████████████████████████████████████████████
with base as (
  select lower(trim(u.email)) as email,
         case upper(coalesce(p.perfil,'')) when 'SME' then 'secretaria' else 'externo' end as tipo,
         case upper(coalesce(p.perfil,'')) when 'SME' then 'sme'
              when 'EMPRESA' then 'empresa' else 'sme' end as papel
  from public.perfis p
  join auth.users u on u.id = p.user_id
  where u.email is not null and trim(u.email) <> ''
),
ins_perfis as (
  select coalesce(
    'insert into public.perfis (email, tipo, is_super_admin, ativo) values '
    || string_agg(distinct format('(%L,%L,false,true)', email, tipo), ',')
    || ' on conflict (email) do nothing;', '-- perfis rocada: vazio') as sql
  from base
),
ins_papeis as (
  select coalesce(
    'insert into public.perfil_papeis (perfil_id, papel_id) select p.id, pa.id from (values '
    || string_agg(distinct format('(%L,%L)', email, papel), ',')
    || ') as v(email, papel) join public.perfis p on lower(p.email)=v.email'
    || ' join public.sistemas s on s.slug=''rocada'''
    || ' join public.papeis pa on pa.sistema_id=s.id and pa.slug=v.papel'
    || ' where not exists (select 1 from public.perfil_papeis pp where pp.perfil_id=p.id and pp.papel_id=pa.id and pp.escola_id is null);',
    '-- perfil_papeis rocada: vazio') as sql
  from base
)
select 'begin;' || E'\n\n' || ins_perfis.sql || E'\n\n' || ins_papeis.sql || E'\n\ncommit;'
from ins_perfis, ins_papeis;
