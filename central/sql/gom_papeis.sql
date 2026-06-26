-- ============================================================================
-- GOM no controle central — PARTE A (determinística).
-- Traduz o mapa fixo GOM_PERFIS_ACESSO (js/permissoes.js do gom-sme) para o
-- modelo de PAPÉIS do central: telas + papeis + papel_permissoes.
-- Rode no SQL Editor do CENTRAL. Idempotente.
--
-- Depois, a PARTE B (usuários -> papel) vem da tabela perfis do Supabase do GOM
-- (iqldovwttomkjkoakosc) — gerada à parte.
-- ============================================================================

-- 1) TELAS do GOM (mesmo conteúdo do telas_sistemas.sql)
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('dashboard',     'Dashboard Operacional',   1),
    ('triagem',       'Triagem Operacional',     2),
    ('fila',          'Fila de Visita',          3),
    ('aprovacao',     'Aprovação e Validação',   4),
    ('empresa',       'Painel da Empresa',       5),
    ('campo',         'Campo — Acompanhamento',  6),
    ('alertas',       'Pendências e Alertas',    7),
    ('obras',         'Obras e Ampliações',      8),
    ('historico',     'Memorial de Atendimentos',9),
    ('relatorios',    'Relatórios e Gráficos',   10),
    ('cadastro',      'Cadastro de Solicitações',11),
    ('equipes',       'Gerenciamento de Equipes',12),
    ('acompanhar',    'Acompanhar Solicitação',  13),
    ('escola',        'Minha Escola',            14),
    ('configuracoes', 'Configurações do Sistema',15),
    ('saldo',         'Saldo',                   16)
  ) as x(slug,nome,ordem)
where s.slug = 'gom'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- 2) PAPÉIS do GOM (roles do GOM_PERFIS_ACESSO)
insert into public.papeis (sistema_id, slug, nome)
select s.id, x.slug, x.nome
from public.sistemas s, (values
    ('admin_gom',  'Administrador GOM'),
    ('secretaria', 'Secretaria'),
    ('empresa',    'Empresa'),
    ('escola',     'Escola')
  ) as x(slug,nome)
where s.slug = 'gom'
on conflict (sistema_id, slug) do update set nome=excluded.nome;

-- 3) PERMISSÕES DOS PAPÉIS (mapa papel->tela do permissoes.js)
--    pode_ver e pode_editar = true; pode_exportar só p/ admin_gom e secretaria.
insert into public.papel_permissoes (papel_id, tela_id, pode_ver, pode_editar, pode_exportar)
select pa.id, t.id, true, true, (pa.slug in ('admin_gom','secretaria'))
from public.sistemas s
join public.papeis pa on pa.sistema_id = s.id
join public.telas  t  on t.sistema_id  = s.id
join (values
    -- ADMIN_GOM
    ('admin_gom','dashboard'),('admin_gom','triagem'),('admin_gom','fila'),('admin_gom','aprovacao'),
    ('admin_gom','empresa'),('admin_gom','campo'),('admin_gom','alertas'),('admin_gom','obras'),
    ('admin_gom','historico'),('admin_gom','relatorios'),('admin_gom','cadastro'),('admin_gom','equipes'),
    ('admin_gom','acompanhar'),('admin_gom','configuracoes'),('admin_gom','escola'),
    -- SECRETARIA
    ('secretaria','dashboard'),('secretaria','triagem'),('secretaria','fila'),('secretaria','aprovacao'),
    ('secretaria','empresa'),('secretaria','campo'),('secretaria','alertas'),('secretaria','obras'),
    ('secretaria','historico'),('secretaria','relatorios'),('secretaria','cadastro'),('secretaria','acompanhar'),
    ('secretaria','escola'),
    -- EMPRESA
    ('empresa','empresa'),
    -- ESCOLA
    ('escola','escola'),('escola','cadastro')
  ) as m(papel, tela) on m.papel = pa.slug and m.tela = t.slug
where s.slug = 'gom'
on conflict (papel_id, tela_id) do update
  set pode_ver=excluded.pode_ver, pode_editar=excluded.pode_editar, pode_exportar=excluded.pode_exportar;
