-- ============================================================================
-- PORTFÓLIO MAG (revista) no controle central — PARTE A (determinística).
-- Modelo: tabela usuarios(perfil) — 'secretaria' (admin) vê tudo; demais ('publico')
-- veem secretaria/tema/revista/editor (sem admin). Telas + papeis + papel_permissoes.
-- Rode no SQL Editor do CENTRAL. Idempotente.
-- ============================================================================

-- 1) TELAS
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

-- 2) PAPÉIS
insert into public.papeis (sistema_id, slug, nome)
select s.id, x.slug, x.nome
from public.sistemas s, (values
    ('secretaria', 'Secretaria (admin)'),
    ('publico',    'Público')
  ) as x(slug,nome)
where s.slug = 'revista'
on conflict (sistema_id, slug) do update set nome=excluded.nome;

-- 3) PERMISSÕES DOS PAPÉIS
--    ver/editar = true; exportar só p/ secretaria. 'publico' não acessa 'admin'.
insert into public.papel_permissoes (papel_id, tela_id, pode_ver, pode_editar, pode_exportar)
select pa.id, t.id, true, true, (pa.slug = 'secretaria')
from public.sistemas s
join public.papeis pa on pa.sistema_id = s.id
join public.telas  t  on t.sistema_id  = s.id
join (values
    ('secretaria','secretaria'),('secretaria','tema'),('secretaria','revista'),('secretaria','editor'),('secretaria','admin'),
    ('publico','secretaria'),('publico','tema'),('publico','revista'),('publico','editor')
  ) as m(papel, tela) on m.papel = pa.slug and m.tela = t.slug
where s.slug = 'revista'
on conflict (papel_id, tela_id) do update
  set pode_ver=excluded.pode_ver, pode_editar=excluded.pode_editar, pode_exportar=excluded.pode_exportar;
