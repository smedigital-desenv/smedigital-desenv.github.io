-- ============================================================================
-- MIGRAÇÃO MAPA -> CENTRAL — escolas, perfis, vínculos e permissões por tela.
-- O schema do central foi modelado no MAPA, então as tabelas são iguais.
-- Migração por CHAVE NATURAL (email/nome/slug): os IDs identity diferem entre
-- os projetos, mas as chaves naturais batem. Tudo idempotente.
--
-- FLUXO RECOMENDADO (com as duas abas abertas):
--   PARTE A) Rode o GERADOR no MAPA -> ele devolve UM script completo.
--   PARTE A) Copie esse script e rode no CENTRAL (faz tudo de uma vez).
--   PARTE B) Rode os AJUSTES/VERIFICAÇÃO no CENTRAL.
-- (A PARTE C tem as 4 consultas separadas, caso prefira passo a passo.)
-- ============================================================================


-- ████████████████████████████████████████████████████████████████████████████
-- PARTE A — GERADOR ÚNICO  (rode no MAPA, cole o resultado no CENTRAL)
-- Devolve uma única célula de texto com o script inteiro (begin; ... commit;).
-- ████████████████████████████████████████████████████████████████████████████
with
esc as (
  select coalesce(
    'insert into public.escolas (nome, email_institucional) select v.nome, v.email from (values '
    || string_agg(format('(%L,%L)', trim(nome_unidade), nullif(trim(email),'')), ',' order by nome_unidade)
    || ') as v(nome, email) where not exists (select 1 from public.escolas e where e.nome = v.nome);',
    '-- escolas: nada a migrar') as sql
  from public.unidades where nome_unidade is not null
),
perf as (
  select coalesce(
    'insert into public.perfis (email, nome, tipo, is_super_admin, ativo) values '
    || string_agg(format('(%L,%L,%L,%L,%L)', lower(email), nome, coalesce(tipo,'escola'),
                  coalesce(is_super_admin,false), coalesce(ativo,true)), ',')
    || ' on conflict (email) do nothing;',
    '-- perfis: nada a migrar') as sql
  from public.perfis
),
vinc as (
  select coalesce(
    'insert into public.perfil_escola (perfil_id, escola_id, vinculo) select p.id, e.id, null from (values '
    || string_agg(distinct format('(%L,%L)', lower(email_usuario), trim(nome_unidade)), ',')
    || ') as v(email, escola) join public.perfis p on lower(p.email)=v.email'
    || ' join public.escolas e on trim(e.nome)=v.escola on conflict (perfil_id, escola_id) do nothing;',
    '-- vinculos: nada a migrar') as sql
  from public.usuarios where email_usuario is not null and nome_unidade is not null
),
ptela as (
  select coalesce(
    'insert into public.perfil_tela (perfil_id, tela_id, pode_ver, pode_editar, pode_exportar)'
    || ' select p.id, t.id, v.ver::boolean, v.editar::boolean, v.exportar::boolean from (values '
    || string_agg(format('(%L,%L,%L,%L,%L)', lower(pf.email), tl.slug,
                  pt.pode_ver, pt.pode_editar, pt.pode_exportar), ',')
    || ') as v(email, tela_slug, ver, editar, exportar) join public.perfis p on lower(p.email)=v.email'
    || ' join public.telas t on t.slug=v.tela_slug'
    || ' join public.sistemas s on s.id=t.sistema_id and s.slug=''mapa'''
    || ' on conflict (perfil_id, tela_id) do update set pode_ver=excluded.pode_ver,'
    || ' pode_editar=excluded.pode_editar, pode_exportar=excluded.pode_exportar;',
    '-- perfil_tela: nada a migrar') as sql
  from public.perfil_tela pt
  join public.perfis pf on pf.id = pt.perfil_id
  join public.telas tl on tl.id = pt.tela_id
)
select '-- ===== Migração MAPA -> central (gerado automaticamente) ====='
    || E'\nbegin;\n\n' || esc.sql || E'\n\n' || perf.sql || E'\n\n' || vinc.sql || E'\n\n' || ptela.sql
    || E'\n\ncommit;' as script_para_o_central
from esc, perf, vinc, ptela;


-- ████████████████████████████████████████████████████████████████████████████
-- PARTE B — AJUSTES + VERIFICAÇÃO  (rode no CENTRAL, depois de importar)
-- ████████████████████████████████████████████████████████████████████████████

-- B.1 reafirma os super admins (caso o do-nothing tenha pulado a atualização)
update public.perfis set is_super_admin = true, tipo = 'secretaria', ativo = true
where lower(email) in (
  'desenv.sme@gmail.com',
  'diogoperez@educacao.pmrp.sp.gov.br',
  'matheusprospero@educacao.pmrp.sp.gov.br',
  'matheusprospero@gmail.com'
);

-- B.2 confere as contagens
select 'escolas'       as tabela, count(*) from public.escolas
union all select 'perfis',        count(*) from public.perfis
union all select 'perfil_escola', count(*) from public.perfil_escola
union all select 'perfil_tela',   count(*) from public.perfil_tela
order by 1;


-- ████████████████████████████████████████████████████████████████████████████
-- PARTE C — ALTERNATIVA: as 4 consultas separadas (passo a passo)
-- Rode cada uma no MAPA e cole o resultado no CENTRAL, na ordem 1->2->3->4.
-- ████████████████████████████████████████████████████████████████████████████

-- 1) ESCOLAS (de unidades, com e-mail institucional)
-- select 'insert into public.escolas (nome, email_institucional) select v.nome, v.email from (values '
--   || string_agg(format('(%L,%L)', trim(nome_unidade), nullif(trim(email),'')), ',' order by nome_unidade)
--   || ') as v(nome, email) where not exists (select 1 from public.escolas e where e.nome = v.nome);'
-- from public.unidades where nome_unidade is not null;

-- 2) PERFIS (de perfis; do nothing preserva os super admins do central)
-- select 'insert into public.perfis (email, nome, tipo, is_super_admin, ativo) values '
--   || string_agg(format('(%L,%L,%L,%L,%L)', lower(email), nome, coalesce(tipo,'escola'),
--      coalesce(is_super_admin,false), coalesce(ativo,true)), ',') || ' on conflict (email) do nothing;'
-- from public.perfis;

-- 3) VÍNCULOS (de usuarios: email -> nome_unidade)
-- select 'insert into public.perfil_escola (perfil_id, escola_id, vinculo) select p.id, e.id, null from (values '
--   || string_agg(distinct format('(%L,%L)', lower(email_usuario), trim(nome_unidade)), ',')
--   || ') as v(email, escola) join public.perfis p on lower(p.email)=v.email'
--   || ' join public.escolas e on trim(e.nome)=v.escola on conflict (perfil_id, escola_id) do nothing;'
-- from public.usuarios where email_usuario is not null and nome_unidade is not null;

-- 4) PERMISSÕES (de perfil_tela -> telas do sistema 'mapa')
-- select 'insert into public.perfil_tela (perfil_id, tela_id, pode_ver, pode_editar, pode_exportar)'
--   || ' select p.id, t.id, v.ver::boolean, v.editar::boolean, v.exportar::boolean from (values '
--   || string_agg(format('(%L,%L,%L,%L,%L)', lower(pf.email), tl.slug, pt.pode_ver, pt.pode_editar, pt.pode_exportar), ',')
--   || ') as v(email, tela_slug, ver, editar, exportar) join public.perfis p on lower(p.email)=v.email'
--   || ' join public.telas t on t.slug=v.tela_slug join public.sistemas s on s.id=t.sistema_id and s.slug=''mapa'''
--   || ' on conflict (perfil_id, tela_id) do update set pode_ver=excluded.pode_ver,'
--   || ' pode_editar=excluded.pode_editar, pode_exportar=excluded.pode_exportar;'
-- from public.perfil_tela pt join public.perfis pf on pf.id=pt.perfil_id join public.telas tl on tl.id=pt.tela_id;
