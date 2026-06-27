-- ============================================================================
-- ROÇADAS no controle central — PARTE A (determinística).
-- Modelo do rocada: tabela perfis(perfil) com papéis SME e EMPRESA; rotas
-- gated em src/App.tsx. Traduz para telas + papeis + papel_permissoes.
-- Rode no SQL Editor do CENTRAL. Idempotente.
-- ============================================================================

-- 1) TELAS do Roçadas
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('unidades',         'Unidades',         1),
    ('dashboard',        'Dashboard',        2),
    ('registrar_rocada', 'Registrar Roçada', 3),
    ('validar_rocadas',  'Validar Roçadas',  4),
    ('historico',        'Histórico',        5),
    ('relatorios',       'Relatórios',       6),
    ('configuracoes',    'Configurações',    7)
  ) as x(slug,nome,ordem)
where s.slug = 'rocada'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- 2) PAPÉIS do Roçadas
insert into public.papeis (sistema_id, slug, nome)
select s.id, x.slug, x.nome
from public.sistemas s, (values
    ('sme',     'SME (Secretaria)'),
    ('empresa', 'Empresa')
  ) as x(slug,nome)
where s.slug = 'rocada'
on conflict (sistema_id, slug) do update set nome=excluded.nome;

-- 3) PERMISSÕES DOS PAPÉIS (mapa de rotas do App.tsx)
--    ver/editar = true; exportar só para SME.
insert into public.papel_permissoes (papel_id, tela_id, pode_ver, pode_editar, pode_exportar)
select pa.id, t.id, true, true, (pa.slug = 'sme')
from public.sistemas s
join public.papeis pa on pa.sistema_id = s.id
join public.telas  t  on t.sistema_id  = s.id
join (values
    -- SME: ambos + validar/relatorios/configuracoes
    ('sme','unidades'),('sme','dashboard'),('sme','historico'),
    ('sme','validar_rocadas'),('sme','relatorios'),('sme','configuracoes'),
    -- EMPRESA: ambos + registrar
    ('empresa','unidades'),('empresa','dashboard'),('empresa','historico'),
    ('empresa','registrar_rocada')
  ) as m(papel, tela) on m.papel = pa.slug and m.tela = t.slug
where s.slug = 'rocada'
on conflict (papel_id, tela_id) do update
  set pode_ver=excluded.pode_ver, pode_editar=excluded.pode_editar, pode_exportar=excluded.pode_exportar;
