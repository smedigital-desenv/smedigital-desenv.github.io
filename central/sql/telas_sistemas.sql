-- ============================================================================
-- TELAS DOS SISTEMAS DA REDE — registro no controle de acesso central.
-- Derivado da navegação/rotas reais dos repositórios (passo 3 do plano).
-- Rode no SQL Editor do projeto central DEPOIS do install.sql.
-- Idempotente (on conflict do update). Ajuste nomes/ordem à vontade —
-- ou faça isso pelo painel (Catálogo).
-- Obs.: MAPA já vem no install.sql; aqui ficam os demais sistemas.
-- ============================================================================

-- ───────────────────────── GOM ─────────────────────────
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

-- ───────────────────────── SATE ─────────────────────────
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('painel',        'Painel da Escola',        1),
    ('calendario',    'Calendário',              2),
    ('pedidos',       'Gestão de Pedidos',       3),
    ('veiculos',      'Frota e Motoristas',      4),
    ('frota_datas',   'Disponibilidade de Frota',5),
    ('usuarios',      'Usuários',                6),
    ('programacoes',  'Programações',            7),
    ('agendas',       'Agendas',                 8),
    ('midia',         'Layout / Mídia',          9),
    ('configuracoes', 'Configurações',           10),
    ('reservas',      'Reservas de Frota',       11),
    ('despacho',      'Roteiro e Despacho Diário',12),
    ('frota',         'Gestão da Minha Frota',   13)
  ) as x(slug,nome,ordem)
where s.slug = 'sate'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- ───────────────────────── Roçadas ─────────────────────────
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

-- ───────────────────────── Portfólio MAG (revista) ─────────────────────────
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('secretaria', 'Secretaria',    1),
    ('tema',       'Tema',          2),
    ('revista',    'Revista',       3),
    ('editor',     'Editor',        4),
    ('admin',      'Administração', 5)
  ) as x(slug,nome,ordem)
where s.slug = 'revista'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- ───────────────────────── Validação de Presença ─────────────────────────
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('inscricao',    'Inscrição',               1),
    ('validar',      'Validação de Presença',   2),
    ('dashboard',    'Painel',                  3),
    ('fiscais',      'Fiscais',                 4),
    ('email_config', 'Configuração de E-mail',  5)
  ) as x(slug,nome,ordem)
where s.slug = 'presenca'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- ───────────────────────── Repositório Pedagógico ─────────────────────────
-- ⚠️ PROPOSTA (React/Vite: rotas não acessíveis automaticamente).
--    Confirme/edite os nomes reais — ou cadastre pelo Catálogo.
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s, (values
    ('acervo',     'Acervo',           1),
    ('buscar',     'Buscar',           2),
    ('enviar',     'Enviar Material',  3),
    ('categorias', 'Categorias',       4),
    ('admin',      'Administração',    5)
  ) as x(slug,nome,ordem)
where s.slug = 'repositorio'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;
