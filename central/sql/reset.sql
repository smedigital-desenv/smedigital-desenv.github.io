-- ============================================================================
-- RESET do controle de acesso central (APENAS DESENVOLVIMENTO).
-- Apaga as tabelas/funções do módulo de acesso para reinstalar do zero.
--
-- ⚠️  DESTRUTIVO: remove perfis, escolas, sistemas, telas e todas as
--     liberações. Use só no projeto de DEV (sem dados reais). NÃO rode em
--     produção. Depois deste arquivo, rode novamente o install.sql.
--
-- Por que existe: se já havia uma tabela com um desses nomes (ex.: `perfis`)
-- com outro formato, o `create table if not exists` do install pula a criação
-- e o resto quebra ("column email does not exist"). Resetando, o install
-- recria tudo no formato certo.
-- ============================================================================

drop table if exists public.perfil_tela      cascade;
drop table if exists public.perfil_papeis    cascade;
drop table if exists public.papel_permissoes cascade;
drop table if exists public.papeis           cascade;
drop table if exists public.perfil_escola    cascade;
drop table if exists public.telas            cascade;
drop table if exists public.sistemas         cascade;
drop table if exists public.perfis           cascade;
drop table if exists public.escolas          cascade;

drop function if exists public.minhas_permissoes()                cascade;
drop function if exists public.permissoes_de(text)                cascade;
drop function if exists public.permissoes_json(text)              cascade;
drop function if exists public.tem_permissao(text, text, text)    cascade;
drop function if exists public.is_super_admin()                   cascade;
drop function if exists public.current_perfil_id()                cascade;
drop function if exists public.jwt_email()                        cascade;

-- Pronto. Agora rode o central/sql/install.sql.
