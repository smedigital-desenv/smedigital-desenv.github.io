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
  // >>> SUBSTITUA pelos valores do projeto central <<<
  url:     'https://SEU-PROJETO-CENTRAL.supabase.co',
  anonKey: 'COLE_AQUI_A_ANON_KEY_DO_PROJETO_CENTRAL',

  // Domínio institucional aceito no login (super admins são exceção no banco).
  dominio: '@educacao.pmrp.sp.gov.br'
};
