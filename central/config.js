/* ============================================================================
   config.js — Configuração do projeto Supabase CENTRAL da rede SME.

   O projeto central é NOVO (criado do zero, modelado no MAPA). Preencha abaixo
   a URL e a anon key do projeto central depois de criá-lo no Supabase.

   A anon key NÃO é segredo: é pública por natureza e a segurança real é feita
   pela RLS no banco. Mesmo assim, mantenha aqui o ÚNICO ponto de configuração
   para não espalhar credenciais pelos arquivos.

   Para apontar para outro projeto sem alterar o git (ex.: homologação), crie um
   central/config.local.js sobrescrevendo window.ACESSO_CFG ANTES de carregar os
   demais scripts; ele está no .gitignore.
   ============================================================================ */
window.ACESSO_CFG = window.ACESSO_CFG || {
  // Projeto Supabase central de DESENVOLVIMENTO (central-dev).
  url:     'https://pvdhepvtoavkyoschkod.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2ZGhlcHZ0b2F2a3lvc2Noa29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTUzNDQsImV4cCI6MjA5Nzk5MTM0NH0.BY6jPR9iDvh2xRlGtaU8vdKWp0NKyC7Amlzx-tytmrk',

  // Domínio institucional aceito no login (super admins são exceção no banco).
  dominio: '@educacao.pmrp.sp.gov.br'
};
