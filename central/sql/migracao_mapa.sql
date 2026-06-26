-- ============================================================================
-- MIGRAÇÃO MAPA -> CENTRAL (escolas, perfis, vínculos e permissões por tela).
-- O schema do central foi modelado no MAPA, então as tabelas são iguais.
--
-- COMO USAR (com as duas abas abertas: MAPA e central):
--   Para cada bloco abaixo:
--     1. Rode a consulta no SQL Editor do **MAPA**.
--     2. Copie a célula de texto retornada (é um comando SQL pronto).
--     3. Cole e rode esse comando no SQL Editor do **central**.
--   ORDEM IMPORTA: 1 (escolas) -> 2 (perfis) -> 3 (perfil_escola) -> 4 (perfil_tela).
--
-- Por que por chave natural (email/nome/slug) e não por id: os IDs identity do
-- MAPA e do central são diferentes; resolvendo pelas chaves naturais nada se
-- desalinha. Tudo idempotente (pode rodar de novo).
-- ============================================================================

-- ───────────── 1) ESCOLAS — fonte: unidades (traz o e-mail institucional) ─────────────
select
 'insert into public.escolas (nome, email_institucional)' || E'\n' ||
 'select v.nome, v.email from (values ' ||
 string_agg(format('(%L,%L)', trim(nome_unidade), nullif(trim(email),'')), ',' order by nome_unidade) ||
 ') as v(nome, email) where not exists (select 1 from public.escolas e where e.nome = v.nome);'
from public.unidades
where nome_unidade is not null;

-- ───────────── 2) PERFIS / USUÁRIOS (rode no MAPA, cole no central) ─────────────
-- on conflict (email) do nothing -> preserva os super admins já cadastrados no central.
select
 'insert into public.perfis (email, nome, tipo, is_super_admin, ativo) values ' ||
 string_agg(format('(%L,%L,%L,%L,%L)', lower(email), nome, coalesce(tipo,'escola'),
            coalesce(is_super_admin,false), coalesce(ativo,true)), ',') ||
 ' on conflict (email) do nothing;'
from public.perfis;

-- ───────────── 3) PERFIL_ESCOLA / VÍNCULOS — fonte: usuarios (email -> escola) ─────────────
select
 'insert into public.perfil_escola (perfil_id, escola_id, vinculo)' || E'\n' ||
 'select p.id, e.id, null from (values ' ||
 string_agg(distinct format('(%L,%L)', lower(email_usuario), trim(nome_unidade)), ',') ||
 ') as v(email, escola)' || E'\n' ||
 'join public.perfis p on lower(p.email)=v.email' || E'\n' ||
 'join public.escolas e on trim(e.nome)=v.escola' || E'\n' ||
 'on conflict (perfil_id, escola_id) do nothing;'
from public.usuarios
where email_usuario is not null and nome_unidade is not null;

-- ───────────── 4) PERFIL_TELA / PERMISSÕES (rode no MAPA, cole no central) ─────────────
-- As telas do MAPA viram as telas do sistema 'mapa' no central (resolução por slug).
select
 'insert into public.perfil_tela (perfil_id, tela_id, pode_ver, pode_editar, pode_exportar)' || E'\n' ||
 'select p.id, t.id, v.ver::boolean, v.editar::boolean, v.exportar::boolean from (values ' ||
 string_agg(format('(%L,%L,%L,%L,%L)', lower(pf.email), tl.slug,
            pt.pode_ver, pt.pode_editar, pt.pode_exportar), ',') ||
 ') as v(email, tela_slug, ver, editar, exportar)' || E'\n' ||
 'join public.perfis p on lower(p.email)=v.email' || E'\n' ||
 'join public.telas t on t.slug=v.tela_slug' || E'\n' ||
 'join public.sistemas s on s.id=t.sistema_id and s.slug=''mapa''' || E'\n' ||
 'on conflict (perfil_id, tela_id) do update set pode_ver=excluded.pode_ver, pode_editar=excluded.pode_editar, pode_exportar=excluded.pode_exportar;'
from public.perfil_tela pt
join public.perfis pf on pf.id = pt.perfil_id
join public.telas tl on tl.id = pt.tela_id;
