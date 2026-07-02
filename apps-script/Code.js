/**
 * SISTEMA DE PRESTAÇÃO DE CONTAS - RIBEIRÃO PRETO
 * Backend: Roteamento, Permissões, Motor de E-mails e Auditoria (LOG)
 */

// --- ROTEAMENTO BLINDADO COM VIP PASS PARA O DEV ---
// --- ROTEAMENTO BLINDADO COM LISTA VIP (DEV) ---
function doGet(e) {
  e = e || { parameter: {} };

  var emailLogado = "";
  try { emailLogado = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(err) {}
  
  var modo = ((e.parameter && e.parameter.modo) || "").toLowerCase().trim();
  var sistema = ((e.parameter && e.parameter.sistema) || "").toLowerCase().trim();
  var verComo = ((e.parameter && e.parameter.vercomo) || "").toLowerCase().trim();
  
  var listaVip = getListaVip_();
  var usuariosPdde = getUsuariosImplantacaoPdde_();
  var isDev = listaVip.indexOf(emailLogado) > -1;
  var isUsuarioPddeEspecial = usuariosPdde.indexOf(emailLogado) > -1;
  
  var emailParaUsar = (isDev && verComo !== "") ? normalizarEmail_(verComo) : emailLogado;
  var perfil = obterPerfilDoUsuario(emailParaUsar);

  // VIP continua com acesso total para teste/desenvolvimento.
  // Usuários especiais do PDDE NÃO viram VIP e NÃO ganham acesso ao sistema atual.
  if (isDev) {
    if (modo === 'adm') perfil = 'ADMIN';
    else if (modo === 'conferente') perfil = (perfil === 'PUBLICO') ? 'CONFERENTE' : perfil;
    else if (modo === 'validador') perfil = 'VALIDADOR';
  }

  var ehAdmin = perfil === 'ADMIN' || perfil === 'ADMIN E CONFERENTE';
  var podeAcessarPrestacao = ehAdmin || isDev;
  var podeAcessarPdde = ehAdmin || isDev || isUsuarioPddeEspecial;
  var podeVerHub = podeAcessarPrestacao || podeAcessarPdde;
  var baseUrl = ScriptApp.getService().getUrl();

  // Hub de sistemas: administradores e usuários liberados veem a escolha antes de acessar.
  if (podeVerHub && !sistema && !modo) {
    var hub = HtmlService.createTemplateFromFile('PortalSistemas');
    hub.emailLogado = emailParaUsar;
    hub.perfilLogado = perfil;
    hub.baseUrl = baseUrl;
    hub.podeAcessarPrestacao = podeAcessarPrestacao;
    hub.podeAcessarPdde = podeAcessarPdde;
    return hub.evaluate()
      .setTitle('Portal de Sistemas')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Novo sistema PDDE. Nesta implantação, acesso liberado para administradores, VIPs e usuários autorizados.
  if (sistema === 'pdde') {
    if (!podeAcessarPdde) {
      return HtmlService.createTemplateFromFile('Publico')
        .evaluate()
        .setTitle('Consulta Pública')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    if (modo === 'conferente') {
      var htmlPddeConf = HtmlService.createTemplateFromFile('PDDEConferente');
      htmlPddeConf.emailLogado = emailParaUsar;
      htmlPddeConf.perfilLogado = perfil;
      htmlPddeConf.baseUrl = baseUrl;
      htmlPddeConf.podeAcessarPrestacao = podeAcessarPrestacao;
      return htmlPddeConf.evaluate()
        .setTitle('PDDE - Conferente')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    var htmlPdde = HtmlService.createTemplateFromFile('PDDE');
    htmlPdde.emailLogado = emailParaUsar;
    htmlPdde.perfilLogado = perfil;
    htmlPdde.baseUrl = baseUrl;
    htmlPdde.podeAcessarPrestacao = podeAcessarPrestacao;
    return htmlPdde.evaluate()
      .setTitle('Sistema PDDE')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Sistema atual: mantém o projeto já existente de prestação de contas.
  if (sistema === 'prestacao' && podeAcessarPrestacao && !modo) {
    modo = 'adm';
  }

  // Usuário não cadastrado cai na consulta pública.
  if (!perfil || perfil === 'PUBLICO') {
    return HtmlService.createTemplateFromFile('Publico')
      .evaluate()
      .setTitle('Consulta Pública')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Roteamento para gestor do sistema atual.
  if (modo === 'adm' && ehAdmin) {
    var html = HtmlService.createTemplateFromFile('Admin'); 
    html.emailLogado = emailParaUsar;
    html.baseUrl = baseUrl;
    html.podeAcessarPdde = podeAcessarPdde;
    return html.evaluate()
      .setTitle('Prestação de Contas')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } 
  
  // Roteamento para conferente / validador do sistema atual.
  var htmlConf = HtmlService.createTemplateFromFile('Conferente'); 
  htmlConf.emailLogado = emailParaUsar; 
  htmlConf.perfilLogado = perfil;
  htmlConf.baseUrl = baseUrl;
  return htmlConf.evaluate()
    .setTitle(perfil === 'VALIDADOR' ? 'Validação de Malotes' : 'Minhas Análises')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function normalizarEmail_(email) {
  return (email || "").toString().toLowerCase().trim();
}

function getListaVip_() {
  // Lista VIP padrão usada nos sistemas: acesso total às telas, modo teste e redirecionamento seguro de e-mails.
  return [
    'usuario@educacao.pmrp.sp.gov.br',
    'usuario@educacao.pmrp.sp.gov.br',
    'usuario@educacao.pmrp.sp.gov.br'
  ];
}

function getUsuariosImplantacaoPdde_() {
  // Usuários liberados somente para o Sistema PDDE.
  // Não entram em modo VIP, não acessam telas restritas do sistema atual e não ativam redirecionamento de e-mails.
  return [
    'usuario@educacao.pmrp.sp.gov.br',
    'usuario@educacao.pmrp.sp.gov.br'
  ];
}

function getUsuariosHub_() {
  return getListaVip_().concat(getUsuariosImplantacaoPdde_());
}

function obterPerfilDoUsuario(email) {
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
    var dados = sheet.getDataRange().getValues();
    var headers = dados[0].map(function(h){ return h.toString().toUpperCase().trim() });
    var colEmail = headers.indexOf("EMAIL");
    var colPerfil = headers.indexOf("PERFIL");
    var colAtivo = headers.indexOf("ATIVO");
    if (colEmail === -1 || colPerfil === -1) return 'PUBLICO';
    for (var i = 1; i < dados.length; i++) { 
      if (dados[i][colEmail].toString().toLowerCase().trim() === email.toLowerCase().trim()) {
        if (colAtivo > -1 && dados[i][colAtivo].toString().toUpperCase().trim() !== "SIM") return 'PUBLICO';
        return dados[i][colPerfil].toString().toUpperCase().trim(); 
      }
    }
  } catch(e) {}

  // Fallback seguro para conferentes que já estão vinculados em CAD_ESCOLAS/ACOMPANHAMENTO,
  // mas não aparecem corretamente na aba USUARIOS. Mantém a tela de conferente funcionando
  // sem liberar acesso administrativo.
  try {
    if (emailTemVinculoConferentePrestacao_(email)) return 'CONFERENTE';
  } catch(e2) {}

  return 'PUBLICO';
}

function emailTemVinculoConferentePrestacao_(email) {
  email = normalizarEmail_(email);
  if (!email) return false;

  var ss = SpreadsheetApp.getActive();
  var abas = ['ACOMPANHAMENTO', 'CAD_ESCOLAS'];
  for (var a = 0; a < abas.length; a++) {
    var sheet = ss.getSheetByName(abas[a]);
    if (!sheet || sheet.getLastRow() < 2) continue;

    var dados = sheet.getDataRange().getValues();
    var headers = dados[0].map(function(h){ return h.toString().trim(); });
    var cols = [];
    ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL_CONFERENTE', 'EMAIL CONFERENTE', 'CONFERENTE'].forEach(function(nome){
      var idx = acharColuna_(headers, [nome]);
      if (idx > -1 && cols.indexOf(idx) === -1) cols.push(idx);
    });

    for (var i = 1; i < dados.length; i++) {
      for (var c = 0; c < cols.length; c++) {
        if (normalizarEmail_(dados[i][cols[c]]) === email) return true;
      }
    }
  }
  return false;
}

function obterAssinaturaUsuario(email) {
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
    var dados = sheet.getDataRange().getValues();
    var headers = dados[0].map(function(h){ return h.toString().toUpperCase().trim() });
    var colEmail = headers.indexOf("EMAIL");
    var colAssinatura = headers.indexOf("ASSINATURA");
    for (var i = 1; i < dados.length; i++) {
      if (colEmail > -1 && dados[i][colEmail].toString().toLowerCase().trim() === email.toLowerCase().trim()) return colAssinatura > -1 ? dados[i][colAssinatura] : "";
    }
  } catch(e) {} return ""; 
}

function getConfigValue(chave) {
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName("CONFIG");
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) { if (data[i][0] === chave) return data[i][1]; }
  } catch(e) {} return "";
}


function registrarLog(usuario, acao, escola, mesAno, detalhes) {
  try {
    var sheetLog = SpreadsheetApp.getActive().getSheetByName("LOG");
    if (!sheetLog) return;
    sheetLog.appendRow([new Date(), usuario, acao, escola, mesAno, detalhes]);
  } catch(e) { console.error("Erro ao registrar log: " + e); }
}


// ===================================================================
// HELPERS DE SEGURANÇA DE DADOS
// - Evitam envio de e-mail para escola errada
// - Evitam uso de linha desatualizada após ordenação da planilha
// - Padronizam busca de colunas com espaço, underline e acentos
// ===================================================================
function normalizarTextoSistema_(valor) {
  return (valor || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[_\-\.\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarChaveEscola_(valor) {
  return normalizarTextoSistema_(valor)
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\bPROFESSOR\b/g, 'PROF')
    .replace(/\bPROFESSORA\b/g, 'PROFA')
    .replace(/\s+/g, ' ')
    .trim();
}

function acharColuna_(headers, aliases, fallbackIndex) {
  headers = headers || [];
  aliases = aliases || [];
  var normHeaders = headers.map(function(h){ return normalizarTextoSistema_(h); });
  var normAliases = aliases.map(function(a){ return normalizarTextoSistema_(a); });

  for (var i = 0; i < normAliases.length; i++) {
    var idx = normHeaders.indexOf(normAliases[i]);
    if (idx > -1) return idx;
  }

  for (var a = 0; a < normAliases.length; a++) {
    for (var h = 0; h < normHeaders.length; h++) {
      if (normHeaders[h] && normHeaders[h].indexOf(normAliases[a]) > -1) return h;
    }
  }

  if (typeof fallbackIndex === 'number' && fallbackIndex >= 0 && fallbackIndex < headers.length) return fallbackIndex;
  return -1;
}

function garantirColuna_(sheet, headers, nomeColuna) {
  headers = headers || [];
  var idx = acharColuna_(headers, [nomeColuna]);
  if (idx > -1) return idx;

  var novaColuna = headers.length + 1;
  sheet.getRange(1, novaColuna).setValue(nomeColuna);
  headers.push(nomeColuna);
  SpreadsheetApp.flush();
  return novaColuna - 1;
}

function formatarDataHoraSistema_(valor) {
  if (!valor) return '';
  try {
    var data = valor instanceof Date ? valor : new Date(valor);
    if (data instanceof Date && !isNaN(data)) {
      return Utilities.formatDate(data, 'GMT-3', 'dd/MM/yyyy HH:mm');
    }
  } catch(e) {}
  return String(valor);
}

function montarMesAnoDaLinha_(row, headers) {
  var colMes = acharColuna_(headers, ['MES', 'MÊS']);
  var colAno = acharColuna_(headers, ['ANO']);
  var mes = colMes > -1 ? row[colMes] : '';
  var ano = colAno > -1 ? row[colAno] : '';
  if (!mes || !ano) return '';
  return String(mes).padStart(2, '0') + '/' + ano;
}

function lerCadastroEscolaPorNome_(nomeEscola) {
  var ss = SpreadsheetApp.getActive();
  var sheetCad = ss.getSheetByName('CAD_ESCOLAS');
  if (!sheetCad || !nomeEscola) return null;

  var dados = sheetCad.getDataRange().getValues();
  if (!dados || dados.length < 2) return null;

  var headers = dados[0].map(function(h){ return h.toString().trim(); });
  var colEscola = acharColuna_(headers, ['ESCOLA', 'ESCOLA NOME', 'UNIDADE ESCOLAR', 'INSTITUICAO', 'INSTITUIÇÃO'], 2);
  var colEmailUnidade = acharColuna_(headers, ['EMAIL UNIDADE', 'EMAIL_UNIDADE', 'E MAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA', 'E MAIL ESCOLA'], 12);
  var colConferenteEmail = acharColuna_(headers, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'E MAIL CONFERENTE']);
  var colConferenteNome = acharColuna_(headers, ['CONFERENTE', 'NOME CONFERENTE', 'RESPONSAVEL CONFERENCIA', 'RESPONSÁVEL CONFERÊNCIA']);
  var colGestor = acharColuna_(headers, ['GESTOR', 'DIRETOR', 'DIRETORA', 'RESPONSAVEL', 'RESPONSÁVEL']);
  var colTelefone = acharColuna_(headers, ['TELEFONE', 'TEL', 'CONTATO'], 11);
  var colPrestacao = acharColuna_(headers, ['PRESTACAO', 'PRESTAÇÃO', 'TIPO PRESTACAO', 'TIPO PRESTAÇÃO'], 5);
  var colTotal = acharColuna_(headers, ['TOTAL', 'VALOR TOTAL']);

  var chaveBusca = normalizarChaveEscola_(nomeEscola);
  for (var i = 1; i < dados.length; i++) {
    var nomeCad = colEscola > -1 ? dados[i][colEscola] : '';
    if (normalizarChaveEscola_(nomeCad) === chaveBusca) {
      return {
        linha: i + 1,
        escola: nomeCad || nomeEscola,
        emailUnidade: colEmailUnidade > -1 ? normalizarEmail_(dados[i][colEmailUnidade]) : '',
        conferenteEmail: colConferenteEmail > -1 ? normalizarEmail_(dados[i][colConferenteEmail]) : '',
        conferenteNome: colConferenteNome > -1 ? (dados[i][colConferenteNome] || '') : '',
        gestor: colGestor > -1 ? (dados[i][colGestor] || '') : '',
        telefone: colTelefone > -1 ? (dados[i][colTelefone] || '') : '',
        prestacao: colPrestacao > -1 ? (dados[i][colPrestacao] || '') : '',
        total: colTotal > -1 ? (dados[i][colTotal] || 0) : 0
      };
    }
  }
  return null;
}

function obterEmailUnidadeSeguro_(nomeEscola, rowData, headers) {
  var cad = lerCadastroEscolaPorNome_(nomeEscola);
  if (cad && cad.emailUnidade) return cad.emailUnidade;

  var colEmailAcomp = acharColuna_(headers, ['EMAIL_UNIDADE', 'EMAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA']);
  if (colEmailAcomp > -1 && rowData && rowData[colEmailAcomp]) return normalizarEmail_(rowData[colEmailAcomp]);
  return '';
}


function montarRastreioEmail_(contexto) {
  contexto = contexto || {};
  var headers = contexto.headers || [];
  var rowData = contexto.rowData || [];
  var cadastro = contexto.cadastro || {};

  var colEmailAcomp = acharColuna_(headers, ['EMAIL_UNIDADE', 'EMAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA']);
  var colConf = acharColuna_(headers, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'CONFERENTE']);
  var colStatus = acharColuna_(headers, ['STATUS']);

  var emailNaLinha = colEmailAcomp > -1 ? normalizarEmail_(rowData[colEmailAcomp]) : '';
  var conferenteNaLinha = colConf > -1 ? normalizarEmail_(rowData[colConf]) : '';
  var statusNaLinha = colStatus > -1 ? String(rowData[colStatus] || '') : '';
  var emailCadastro = cadastro.emailUnidade ? normalizarEmail_(cadastro.emailUnidade) : '';
  var divergenciaEmail = (emailNaLinha && emailCadastro && emailNaLinha !== emailCadastro) ? 'SIM' : 'NÃO';

  return [
    'Resultado: ' + (contexto.resultado || 'não informado'),
    'Tipo: ' + (contexto.tipo || 'PROCESSAMENTO'),
    'Ação: ' + (contexto.acao || '-'),
    'Usuário executor: ' + (contexto.usuario || '-'),
    'Linha ACOMPANHAMENTO usada: ' + (contexto.linhaAcompanhamento || '-'),
    'Linha foi corrigida/relocalizada: ' + (contexto.linhaCorrigida ? 'SIM' : 'NÃO'),
    'Escola na linha: ' + (contexto.escolaLinha || '-'),
    'Mês/Ano: ' + (contexto.mesAno || '-'),
    'Status na linha antes do envio: ' + (statusNaLinha || '-'),
    'Conferente na linha: ' + (conferenteNaLinha || '-'),
    'E-mail na linha ACOMPANHAMENTO: ' + (emailNaLinha || '-'),
    'Linha CAD_ESCOLAS encontrada: ' + (cadastro.linha || '-'),
    'Escola no CAD_ESCOLAS: ' + (cadastro.escola || '-'),
    'E-mail no CAD_ESCOLAS: ' + (emailCadastro || '-'),
    'Divergência entre ACOMPANHAMENTO e CAD_ESCOLAS: ' + divergenciaEmail,
    'E-mail resolvido pelo sistema: ' + (contexto.emailResolvido || '-'),
    'Destinatário final usado no envio: ' + (contexto.destinatarioFinal || '-'),
    'CC configurado: ' + (contexto.cc || '-'),
    'Assunto processado: ' + (contexto.assunto || '-'),
    'Observação: o e-mail resolvido prioriza CAD_ESCOLAS; se houver divergência, verifique o cadastro da escola e depois sincronize/regenere o acompanhamento.'
  ].join(' | ');
}

function resolverLinhaAcompanhamento_(sheet, headers, dadosForm) {
  dadosForm = dadosForm || {};
  var colEscola = acharColuna_(headers, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR']);
  var expectedEscola = dadosForm.escola || dadosForm.escolaNome || '';
  var expectedMesAno = dadosForm.mesAno || '';

  function linhaConfere(row) {
    if (!row) return false;
    if (expectedEscola && colEscola > -1 && normalizarChaveEscola_(row[colEscola]) !== normalizarChaveEscola_(expectedEscola)) return false;
    if (expectedMesAno && montarMesAnoDaLinha_(row, headers) !== expectedMesAno) return false;
    return true;
  }

  var linhaOriginal = parseInt(dadosForm.linha, 10);
  if (linhaOriginal && linhaOriginal >= 2 && linhaOriginal <= sheet.getLastRow()) {
    var rowOriginal = sheet.getRange(linhaOriginal, 1, 1, headers.length).getValues()[0];
    if (!expectedEscola && !expectedMesAno) return { linha: linhaOriginal, rowData: rowOriginal, corrigida: false };
    if (linhaConfere(rowOriginal)) return { linha: linhaOriginal, rowData: rowOriginal, corrigida: false };
  }

  if (!expectedEscola) {
    throw new Error('A linha selecionada mudou após a ordenação da planilha e a escola não foi enviada para validação. Recarregue a tela e tente novamente.');
  }

  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (linhaConfere(dados[i])) {
      return { linha: i + 1, rowData: dados[i], corrigida: true };
    }
  }

  throw new Error('Não encontrei a prestação selecionada na aba ACOMPANHAMENTO. Escola: ' + expectedEscola + (expectedMesAno ? ' · Mês: ' + expectedMesAno : ''));
}

function validarPermissaoRegistro_(emailUsuario, perfil, rowData, headers, acao) {
  var emailAtivo = '';
  try { emailAtivo = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(e) {}
  if (getListaVip_().indexOf(emailAtivo) > -1) return true;

  emailUsuario = normalizarEmail_(emailUsuario || emailAtivo);
  perfil = (perfil || obterPerfilDoUsuario(emailUsuario) || 'PUBLICO').toString().toUpperCase().trim();

  if (perfil === 'ADMIN' || perfil === 'ADMIN E CONFERENTE') return true;

  var colStatus = acharColuna_(headers, ['STATUS']);
  var statusAtual = colStatus > -1 ? (rowData[colStatus] || '').toString().toUpperCase().replace(/\s+/g, '_') : '';

  if (perfil === 'VALIDADOR') {
    return acao === 'RECEBIDO' && (statusAtual === 'PENDENTE_RECEBIMENTO' || statusAtual === '');
  }

  var colConf = acharColuna_(headers, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'CONFERENTE']);
  var emailDaLinha = colConf > -1 ? normalizarEmail_(rowData[colConf]) : '';
  return emailDaLinha && emailDaLinha === emailUsuario;
}

// ===================================================================
// FUNÇÃO: BUSCAR DADOS PARA O PAINEL ADMIN (ATUALIZADA COM DETALHES)
// ===================================================================
function getDadosAcompanhamentoAdmin() {
  var ss = SpreadsheetApp.getActive();
  var sheetAcomp = ss.getSheetByName("ACOMPANHAMENTO");
  var sheetCad = ss.getSheetByName("CAD_ESCOLAS");
  
  var dadosAcomp = sheetAcomp.getDataRange().getValues();
  var headersAcomp = dadosAcomp[0].map(function(h){ return h.toString().toUpperCase().trim()});
  
  var dadosCad = sheetCad ? sheetCad.getDataRange().getValues() : [];
  var headersCad = dadosCad.length > 0 ? dadosCad[0].map(function(h){ return h.toString().toUpperCase().trim()}) : [];
  
  // 1. Mapeia os dados da aba CAD_ESCOLAS para cruzamento rápido
  var mapCad = {};
  var colEscolaCad = headersCad.indexOf("ESCOLA");
  if (colEscolaCad > -1) {
    // Usando os índices exatos das colunas solicitadas (Lembrando que A=0, B=1...)
    var colPrestacao = 5; // Coluna F
    var colTel = 11;      // Coluna L
    var colEmail = 12;    // Coluna M
    
    for (var j = 1; j < dadosCad.length; j++) {
      var esc = dadosCad[j][colEscolaCad].toString().toUpperCase().trim();
      mapCad[esc] = {
        prestacao: dadosCad[j][colPrestacao] || "Não informada",
        telefone: dadosCad[j][colTel] || "Não informado",
        email: dadosCad[j][colEmail] || "Não informado"
      };
    }
  }

  var res = [];
  var colEscola = headersAcomp.indexOf("ESCOLA_NOME");
  var colMes = headersAcomp.indexOf("MES");
  var colAno = headersAcomp.indexOf("ANO");
  var colStatus = headersAcomp.indexOf("STATUS");
  var colConf = headersAcomp.indexOf("CONFERENTE_EMAIL") > -1 ? headersAcomp.indexOf("CONFERENTE_EMAIL") : headersAcomp.indexOf("CONFERENTE");
  var colPrazo = headersAcomp.indexOf("PRAZO_ATE");
  var colHist = headersAcomp.indexOf("HISTORICO_PENDENCIAS");
  var colPend = headersAcomp.indexOf("PENDENCIAS");
  var colCobranca = acharColuna_(headersAcomp, ['COBRANCA_ENVIADA_EM', 'COBRANÇA ENVIADA EM', 'ULTIMA_COBRANCA_EM', 'ÚLTIMA COBRANÇA EM', 'COBRANCA EM']);
  
  // 2. Colunas do ACOMPANHAMENTO solicitadas
  var colValorTotal = 15; // Coluna P
  var colValorAtual = 16; // Coluna Q

  for (var i = 1; i < dadosAcomp.length; i++) {
    if (!dadosAcomp[i][colEscola]) continue;
    var nomeEscola = dadosAcomp[i][colEscola].toString().trim();
    var nomeUpper = nomeEscola.toUpperCase();
    
    // Puxa os dados do cruzamento (se não achar, coloca N/A)
    var infoCad = mapCad[nomeUpper] || { telefone: "-", email: "-", prestacao: "-" };
    
    var prazoVal = "-";
    if (colPrazo > -1 && dadosAcomp[i][colPrazo]) {
      try { prazoVal = Utilities.formatDate(new Date(dadosAcomp[i][colPrazo]), "GMT-3", "dd/MM/yyyy"); } catch(e) {}
    }

    res.push({
      linha: i + 1,
      escola: nomeEscola,
      mesAno: String(dadosAcomp[i][colMes]).padStart(2, '0') + '/' + dadosAcomp[i][colAno],
      status: dadosAcomp[i][colStatus],
      conferente: colConf > -1 ? dadosAcomp[i][colConf] : "-",
      prazo: prazoVal,
      historico: colHist > -1 ? dadosAcomp[i][colHist] : "",
      pendenciaAtual: colPend > -1 ? dadosAcomp[i][colPend] : "",
      cobrancaEnviadaEm: colCobranca > -1 ? formatarDataHoraSistema_(dadosAcomp[i][colCobranca]) : "",
      
      // 🔥 NOVAS INFORMAÇÕES INJETADAS
      telefone: infoCad.telefone,
      emailUnidade: infoCad.email,
      prestacao: infoCad.prestacao,
      valorTotal: dadosAcomp[i][colValorTotal] || 0,
      valorAtual: dadosAcomp[i][colValorAtual] || 0
    });
  }
  return { acompanhamento: res };
}

// --- BUSCA BLINDADA COM DATAS DE DEVOLUÇÃO E PRAZO ---
function getDadosConferente(email) {
 try {
  email = normalizarEmail_(email);
  var perfil = obterPerfilDoUsuario(email);
  var sheet = SpreadsheetApp.getActive().getSheetByName("ACOMPANHAMENTO");
  if (!sheet) return [];

  var dados = sheet.getDataRange().getValues();
  if (!dados || dados.length < 2) return [];

  var headers = dados[0].map(function(h) { return h.toString().trim(); });
  var res = [];

  var colEscola = acharColuna_(headers, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR']);
  var colMes = acharColuna_(headers, ['MES', 'MÊS']);
  var colAno = acharColuna_(headers, ['ANO']);
  var colStatus = acharColuna_(headers, ['STATUS']);
  var colConf = acharColuna_(headers, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'CONFERENTE']);
  var colEmailUnidade = acharColuna_(headers, ['EMAIL_UNIDADE', 'EMAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA']);
  var colPend = acharColuna_(headers, ['PENDENCIAS', 'PENDÊNCIAS']);
  var colHist = acharColuna_(headers, ['HISTORICO_PENDENCIAS', 'HISTÓRICO PENDÊNCIAS', 'HISTORICO DE PENDENCIAS']);
  var colPrazo = acharColuna_(headers, ['PRAZO_ATE', 'PRAZO ATÉ', 'PRAZO ATE']);
  var colDevolvido = acharColuna_(headers, ['DEVOLVIDO_EM', 'DEVOLVIDO EM']);
  var colCobranca = acharColuna_(headers, ['COBRANCA_ENVIADA_EM', 'COBRANÇA ENVIADA EM', 'ULTIMA_COBRANCA_EM', 'ÚLTIMA COBRANÇA EM', 'COBRANCA EM']);

  function formataData(d) {
    if (!d || d === '') return '';
    if (d instanceof Date && !isNaN(d)) {
      return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
    }
    return String(d);
  }

  for (var i = 1; i < dados.length; i++) {
    if (colEscola === -1 || !dados[i][colEscola]) continue;

    var statusAtual = (colStatus > -1 ? (dados[i][colStatus] || 'PENDENTE_RECEBIMENTO') : 'PENDENTE_RECEBIMENTO').toString().toUpperCase().replace(/\s+/g, '_');
    var podeVer = false;

    if (perfil === 'VALIDADOR') {
      podeVer = (statusAtual === 'PENDENTE_RECEBIMENTO' || statusAtual === '');
    } else {
      var emailNaPlanilha = colConf > -1 ? normalizarEmail_(dados[i][colConf]) : '';
      podeVer = emailNaPlanilha !== '' && emailNaPlanilha === email;
    }

    if (podeVer) {
      res.push({
        linha: i + 1,
        escola: dados[i][colEscola],
        mesAno: String(dados[i][colMes]).padStart(2, '0') + '/' + dados[i][colAno],
        status: statusAtual,
        conferenteEmail: colConf > -1 ? normalizarEmail_(dados[i][colConf]) : '',
        emailUnidade: colEmailUnidade > -1 ? normalizarEmail_(dados[i][colEmailUnidade]) : '',
        pendencias: colPend > -1 ? (dados[i][colPend] || '') : '',
        historico: colHist > -1 ? (dados[i][colHist] || '') : '',
        prazo: colPrazo > -1 ? formataData(dados[i][colPrazo]) : '',
        devolvidoEm: colDevolvido > -1 ? formataData(dados[i][colDevolvido]) : '',
        cobrancaEnviadaEm: colCobranca > -1 ? formataData(dados[i][colCobranca]) : '',
        cobrancaEnviadaEmCompleta: colCobranca > -1 ? formatarDataHoraSistema_(dados[i][colCobranca]) : ''
      });
    }
  }
  return res;
 } catch (e) {
   // Nunca deixa a chamada estourar: a tela do conferente exibe um erro claro em vez de travar em "Carregando...".
   try { registrarLog(email || '-', 'ERRO_GET_DADOS_CONFERENTE', 'Sistema Web', '-', 'Falha ao carregar dados do conferente: ' + e.message); } catch (_) {}
   throw new Error('Não foi possível carregar as prestações do conferente. Detalhe técnico: ' + e.message);
 }
}

// ===================================================================
// FUNÇÃO 1: SALVAMENTO COM MODO VIP, HTML NATIVO E SUPORTE A ANEXOS
// ===================================================================
function salvarAnaliseConferente(dadosForm) {
  try {
    dadosForm = dadosForm || {};
    var emailLogado = '';
    try { emailLogado = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(e) {}

    var listaVip = getListaVip_();
    var isTestMode = listaVip.indexOf(emailLogado) > -1;
    var emailUsuario = normalizarEmail_(dadosForm.emailUsuario || emailLogado);
    var perfilUsuario = obterPerfilDoUsuario(emailUsuario);

    var ss = SpreadsheetApp.getActive();
    var sheet = ss.getSheetByName('ACOMPANHAMENTO');
    if (!sheet) throw new Error('Aba ACOMPANHAMENTO não encontrada.');

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h){ return h.toString().trim(); });
    var resolucao = resolverLinhaAcompanhamento_(sheet, headers, dadosForm);
    var linha = resolucao.linha;
    var rowData = resolucao.rowData;
    var agora = new Date();

    if (!validarPermissaoRegistro_(emailUsuario, perfilUsuario, rowData, headers, dadosForm.acao)) {
      throw new Error('Você não tem permissão para processar esta prestação. Recarregue a tela e verifique a listagem do conferente.');
    }

    var colEscola = acharColuna_(headers, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR']);
    var colMes = acharColuna_(headers, ['MES', 'MÊS']);
    var colAno = acharColuna_(headers, ['ANO']);
    var colStatus = acharColuna_(headers, ['STATUS']);
    var colPendencias = acharColuna_(headers, ['PENDENCIAS', 'PENDÊNCIAS']);

    if (colEscola === -1 || colMes === -1 || colAno === -1 || colStatus === -1) {
      throw new Error('A aba ACOMPANHAMENTO precisa ter as colunas ESCOLA_NOME, MES, ANO e STATUS.');
    }

    var nomeEscola = rowData[colEscola] || '';
    var mesStr = String(rowData[colMes]).padStart(2, '0');
    var anoPlanilha = rowData[colAno] || '';
    var mesAnoRef = mesStr + '/' + anoPlanilha;
    var cadastro = lerCadastroEscolaPorNome_(nomeEscola) || {};
    var nomeGestor = cadastro.gestor || '';

    if (colPendencias > -1 && dadosForm.acao !== 'RECEBIDO') {
      if (!isTestMode) sheet.getRange(linha, colPendencias + 1).setValue(dadosForm.pendencias || '');
    }

    var prazoStr = '-';
    if (dadosForm.acao === 'RECEBIDO') {
      var colRecEm = acharColuna_(headers, ['RECEBIDO_EM', 'RECEBIDO EM']);
      if (!isTestMode) {
        if (colRecEm > -1) sheet.getRange(linha, colRecEm + 1).setValue(agora);
        sheet.getRange(linha, colStatus + 1).setValue('RECEBIDO');
        registrarLog(emailUsuario, 'RECEBEU', nomeEscola, mesAnoRef, 'Registrou recebimento.' + (resolucao.corrigida ? ' Linha corrigida automaticamente.' : ''));
      }

    } else if (dadosForm.acao === 'DEVOLVER_COM_PENDENCIAS') {
      var colHist = acharColuna_(headers, ['HISTORICO_PENDENCIAS', 'HISTÓRICO PENDÊNCIAS', 'HISTORICO DE PENDENCIAS']);
      var histAntigo = colHist > -1 ? (rowData[colHist] || '') : '';
      var carimbo = Utilities.formatDate(agora, 'GMT-3', 'dd/MM/yyyy HH:mm');
      var novoReg = '📌 Devolvido em ' + carimbo + ':\n' + (dadosForm.pendencias || '') + '\n---\n' + histAntigo;
      var colCiclo = acharColuna_(headers, ['CICLO']);
      var cicloAtual = colCiclo > -1 ? (parseInt(rowData[colCiclo], 10) || 0) : 0;
      var diasPrazo = parseInt(getConfigValue('DIAS_PRAZO_PADRAO') || 5, 10);
      var dataPrazo = new Date();
      dataPrazo.setDate(dataPrazo.getDate() + diasPrazo);
      prazoStr = Utilities.formatDate(dataPrazo, 'GMT-3', 'dd/MM/yyyy');
      var colPrazo = acharColuna_(headers, ['PRAZO_ATE', 'PRAZO ATÉ', 'PRAZO ATE']);

      if (!isTestMode) {
        if (colHist > -1) sheet.getRange(linha, colHist + 1).setValue(novoReg);
        if (colCiclo > -1) sheet.getRange(linha, colCiclo + 1).setValue(cicloAtual + 1);
        if (colPrazo > -1) sheet.getRange(linha, colPrazo + 1).setValue(dataPrazo);
        sheet.getRange(linha, colStatus + 1).setValue('DEVOLVIDO_COM_PENDENCIAS');
        registrarLog(emailUsuario, 'DEVOLVEU', nomeEscola, mesAnoRef, 'Devolveu com pendências.' + (resolucao.corrigida ? ' Linha corrigida automaticamente.' : ''));
      }

    } else if (dadosForm.acao === 'FINALIZAR_OK') {
      var colFinEm = acharColuna_(headers, ['FINALIZADO_EM', 'FINALIZADO EM']);
      var colSaldo = acharColuna_(headers, ['SALDO ATUAL', 'SALDO_ATUAL']);
      if (!isTestMode) {
        sheet.getRange(linha, colStatus + 1).setValue('FINALIZADO');
        if (colFinEm > -1) sheet.getRange(linha, colFinEm + 1).setValue(agora);
        if (colSaldo > -1) sheet.getRange(linha, colSaldo + 1).setValue(dadosForm.saldoAtual).setNumberFormat('R$ #,##0.00');
        registrarLog(emailUsuario, 'FINALIZOU', nomeEscola, mesAnoRef, 'Finalizou com Saldo: ' + dadosForm.saldoAtual + (resolucao.corrigida ? ' Linha corrigida automaticamente.' : ''));
      }
    } else {
      throw new Error('Ação inválida.');
    }

    var emailEscola = obterEmailUnidadeSeguro_(nomeEscola, rowData, headers);
    var assinatura = obterAssinaturaUsuario(emailUsuario) || getTemplateValue('EMAIL_SIGNATURE') || '';
    assinatura = assinatura.replace(/\n/g, '<br>');
    var pendenciasHTML = (dadosForm.pendencias || '').replace(/\n/g, '<br>');

    var attachments = [];
    if (dadosForm.anexoBase64) {
      try {
        var blob = Utilities.newBlob(Utilities.base64Decode(dadosForm.anexoBase64), dadosForm.anexoMime, dadosForm.anexoNome);
        attachments.push(blob);
      } catch (err) {
        console.error('Erro ao converter anexo: ' + err);
      }
    }

    function processarTemplate(texto) {
      if (!texto) return '';
      if (texto.indexOf('<p>') === -1) texto = texto.replace(/\r?\n/g, '<br><br>');
      return texto.replace(/\{\{ESCOLA\}\}/g, nomeEscola)
                  .replace(/\{\{MES2\}\}/g, mesStr)
                  .replace(/\{\{ANO\}\}/g, anoPlanilha)
                  .replace(/\{\{PENDENCIAS\}\}/g, pendenciasHTML)
                  .replace(/\{\{PRAZO_ATE\}\}/g, prazoStr)
                  .replace(/\{\{GESTOR\}\}/g, nomeGestor)
                  .replace(/\{\{SIGNATURE\}\}/g, assinatura);
    }

    var subject = '', body = '', deveEnviar = false;
    if (dadosForm.acao === 'RECEBIDO') { subject = getTemplateValue('EMAIL_RECEBIMENTO_SUBJECT'); body = getTemplateValue('EMAIL_RECEBIMENTO_BODY'); deveEnviar = true; }
    else if (dadosForm.acao === 'DEVOLVER_COM_PENDENCIAS') { subject = getTemplateValue('EMAIL_DEVOLUCAO_SUBJECT'); body = getTemplateValue('EMAIL_DEVOLUCAO_BODY'); deveEnviar = true; }
    else if (dadosForm.acao === 'FINALIZAR_OK') { subject = getTemplateValue('EMAIL_APROVACAO_SUBJECT'); body = getTemplateValue('EMAIL_APROVACAO_BODY'); deveEnviar = true; }

    var statusEmail = '';
    if (deveEnviar) {
      if (!emailEscola && !isTestMode) throw new Error('E-mail da unidade não encontrado para ' + nomeEscola + '. Verifique a aba CAD_ESCOLAS.');
      var opcoesEmail = { name: getConfigValue('REMETENTE_NOME') || 'Prestação de Contas', cc: getConfigValue('EMAIL_COPIA_GESTAO') };
      if (attachments.length > 0) opcoesEmail.attachments = attachments;

      var assuntoProcessado = processarTemplate(subject);
      var corpoProcessado = processarTemplate(body);
      var destinoOriginal = emailEscola || emailLogado;
      var destinoFinalLog = isTestMode ? (emailLogado + ' [MODO TESTE; original seria: ' + (emailEscola || 'não encontrado') + ']') : destinoOriginal;

      var enviado = safeSendEmail_(destinoOriginal, assuntoProcessado, corpoProcessado, opcoesEmail);
      statusEmail = enviado ? '\n✅ E-mail enviado com sucesso para: ' + destinoFinalLog : '\n❌ Falha no envio do e-mail.';

      var rastreioEmail = montarRastreioEmail_({
        tipo: 'ATUALIZACAO_STATUS',
        acao: dadosForm.acao,
        usuario: emailUsuario,
        linhaAcompanhamento: linha,
        linhaCorrigida: resolucao.corrigida,
        escolaLinha: nomeEscola,
        mesAno: mesAnoRef,
        headers: headers,
        rowData: rowData,
        cadastro: cadastro,
        emailResolvido: emailEscola || '',
        destinatarioFinal: destinoFinalLog,
        cc: opcoesEmail.cc || '',
        assunto: assuntoProcessado,
        resultado: enviado ? 'ENVIADO' : 'FALHA_ENVIO'
      });
      registrarLog(emailUsuario, 'EMAIL_PROCESSAMENTO', nomeEscola, mesAnoRef, rastreioEmail);
    }

    if (isTestMode) return '✅ [MODO TESTE] Ação simulada com sucesso! (Planilha intocada)' + statusEmail;

    sincronizarConferentes();
    ordenarAcompanhamento();
    return 'Sucesso! Dados salvos com validação de escola/linha.' + statusEmail;

  } catch (e) { return 'ERRO NO SERVIDOR: ' + e.message; }
}


// ===================================================================
// FUNÇÃO DE ENVIO COM SUPORTE A ANEXOS E MODO VIP
// ===================================================================
function safeSendEmail_(to, subject, bodyHtml, opts) {
  try {
    if (!to || !subject || !bodyHtml) return false;

    var emailLogado = "";
    try { emailLogado = Session.getActiveUser().getEmail().toLowerCase().trim(); } catch(e) {}
    
    // Lista VIP para redirecionamento de testes
    var listaVip = getListaVip_();

    // CSS para manter a formatação e as quebras de linha
    bodyHtml = "<div style='font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; white-space: pre-wrap;'>" + bodyHtml + "</div>";

    if (listaVip.indexOf(emailLogado) > -1) {
      var destinatarioOriginal = to;
      to = emailLogado; 
      subject = "[TESTE-SISTEMA] - " + subject;
      bodyHtml = "<div style='background:#fff3cd; padding:15px; border:1px solid #ffeeba; color:#856404; margin-bottom:20px; font-weight:bold; border-radius:6px; white-space: normal;'>⚠️ AVISO DE TESTE:<br>Este e-mail seria enviado originalmente para: " + destinatarioOriginal + "</div>" + bodyHtml;
    }

    var plainText = bodyHtml.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/gi, '');

    // Prepara as opções de envio
    var opcoes = { 
      name: opts.name || "Gestão de Prestação de Contas", 
      htmlBody: bodyHtml 
    };
    
    // Configura Cópia (CC) apenas se não for teste
    if (opts && opts.cc && listaVip.indexOf(emailLogado) === -1) {
      opcoes.cc = opts.cc; 
    }
    
    // 🔥 ESSENCIAL: Inclui os anexos se existirem
    if (opts && opts.attachments && opts.attachments.length > 0) {
      opcoes.attachments = opts.attachments;
    }

    MailApp.sendEmail(to, subject, plainText, opcoes);
    return true;
    
  } catch (e) { 
    console.error("Erro no envio: " + e.message);
    return false; 
  }
}


// // --- FUNÇÃO ATUALIZADA: ENVIO SEGURO COM LOG DE ERRO REAL ---

// function safeSendEmail_(to, subject, body, opts) {
//  try {
//    var EMAIL_TESTE = "usuario@educacao.pmrp.sp.gov.br"; 
//    var debugInfo = "ATENÇÃO: Ambiente de testes.\nEscola original: " + to + "\nCópia: " + (opts.cc || "Ninguém") + "\n\n==== CORPO ====\n\n";
//    
//    // Verifica se tem assunto e corpo antes de tentar enviar
//    if (!subject || !body) {
//      console.warn("E-mail não enviado: Assunto ou Corpo estão vazios.");
//      return false;
//    }
//
//    GmailApp.sendEmail(EMAIL_TESTE, "[TESTE] " + subject, debugInfo + body, opts);
//    console.log("E-mail de teste enviado com sucesso para: " + EMAIL_TESTE);
//    return true;
//  } catch (e) { 
//    console.error("FALHA CRÍTICA NO ENVIO DE E-MAIL: " + e.message);
//    return false; 
//  }
// }

function gerarMesViaWeb(ano, mes, emailUsuario) {
  var ss = SpreadsheetApp.getActive();
  var sheetEscolas = ss.getSheetByName('CAD_ESCOLAS');
  var sheetAcomp = ss.getSheetByName('ACOMPANHAMENTO');

  if (!sheetEscolas || !sheetAcomp) return 'ERRO: As abas CAD_ESCOLAS ou ACOMPANHAMENTO não foram encontradas na planilha.';

  var dadosEscolas = sheetEscolas.getDataRange().getValues();
  var headEscolas = dadosEscolas[0].map(function(h){ return h.toString().trim(); });

  var idxEscNome = acharColuna_(headEscolas, ['ESCOLA', 'ESCOLA NOME', 'UNIDADE ESCOLAR', 'INSTITUICAO', 'INSTITUIÇÃO'], 2);
  var idxEscEmail = acharColuna_(headEscolas, ['EMAIL UNIDADE', 'EMAIL_UNIDADE', 'E MAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA', 'E MAIL ESCOLA'], 12);
  var idxEscConf = acharColuna_(headEscolas, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'E MAIL CONFERENTE']);

  if (idxEscNome === -1) return "ERRO: A coluna 'ESCOLA' não foi encontrada na aba CAD_ESCOLAS. Verifique o cabeçalho.";

  var mapaEscolasCadastradas = {};
  for (var j = 1; j < dadosEscolas.length; j++) {
     var nEscola = dadosEscolas[j][idxEscNome];
     if (nEscola) {
       mapaEscolasCadastradas[normalizarChaveEscola_(nEscola)] = {
          nome: nEscola,
          confEmail: idxEscConf > -1 ? normalizarEmail_(dadosEscolas[j][idxEscConf]) : '',
          emailUnid: idxEscEmail > -1 ? normalizarEmail_(dadosEscolas[j][idxEscEmail]) : ''
       };
     }
  }

  var dadosAcomp = sheetAcomp.getDataRange().getValues();
  var headAcomp = dadosAcomp[0].map(function(h){ return h.toString().trim(); });

  var idxAcompEsc = acharColuna_(headAcomp, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR']);
  var idxAcompMes = acharColuna_(headAcomp, ['MES', 'MÊS']);
  var idxAcompAno = acharColuna_(headAcomp, ['ANO']);
  var idxAcompStatus = acharColuna_(headAcomp, ['STATUS']);
  var idxAcompConf = acharColuna_(headAcomp, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'CONFERENTE']);
  var idxAcompEmail = acharColuna_(headAcomp, ['EMAIL_UNIDADE', 'EMAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA']);

  if (idxAcompEsc === -1 || idxAcompMes === -1 || idxAcompAno === -1 || idxAcompStatus === -1) {
    return 'ERRO: A aba ACOMPANHAMENTO precisa ter ESCOLA_NOME, MES, ANO e STATUS.';
  }

  var existentesMesAtual = {};
  var qtdAtualizadas = 0;

  for (var i = 1; i < dadosAcomp.length; i++) {
     var rEscola = dadosAcomp[i][idxAcompEsc];
     var rMes = dadosAcomp[i][idxAcompMes];
     var rAno = dadosAcomp[i][idxAcompAno];
     var rStatus = String(dadosAcomp[i][idxAcompStatus] || '').toUpperCase();

     if (!rEscola) continue;
     var escolaKey = normalizarChaveEscola_(rEscola);

     if (Number(rMes) === Number(mes) && Number(rAno) === Number(ano)) existentesMesAtual[escolaKey] = true;

     var dadosAtuaisCadastro = mapaEscolasCadastradas[escolaKey];
     if (dadosAtuaisCadastro && rStatus !== 'FINALIZADO') {
       var precisouAtualizar = false;
       if (idxAcompConf > -1 && dadosAtuaisCadastro.confEmail && normalizarEmail_(dadosAcomp[i][idxAcompConf]) !== dadosAtuaisCadastro.confEmail) {
         sheetAcomp.getRange(i + 1, idxAcompConf + 1).setValue(dadosAtuaisCadastro.confEmail);
         precisouAtualizar = true;
       }
       if (idxAcompEmail > -1 && dadosAtuaisCadastro.emailUnid && normalizarEmail_(dadosAcomp[i][idxAcompEmail]) !== dadosAtuaisCadastro.emailUnid) {
         sheetAcomp.getRange(i + 1, idxAcompEmail + 1).setValue(dadosAtuaisCadastro.emailUnid);
         precisouAtualizar = true;
       }
       if (precisouAtualizar) qtdAtualizadas++;
     }
  }

  var diasPrazoPadrao = getConfigValue('DIAS_PRAZO_PADRAO') || 5;
  var novasLinhas = [];
  var qtdCriadas = 0;

  Object.keys(mapaEscolasCadastradas).forEach(function(escolaKey) {
    var cad = mapaEscolasCadastradas[escolaKey];
    if (!existentesMesAtual[escolaKey]) {
      var novaLinha = new Array(headAcomp.length).fill('');
      if (idxAcompAno > -1) novaLinha[idxAcompAno] = ano;
      if (idxAcompMes > -1) novaLinha[idxAcompMes] = mes;
      if (idxAcompEsc > -1) novaLinha[idxAcompEsc] = cad.nome;
      if (idxAcompConf > -1) novaLinha[idxAcompConf] = cad.confEmail || '';
      if (idxAcompEmail > -1) novaLinha[idxAcompEmail] = cad.emailUnid || '';
      if (idxAcompStatus > -1) novaLinha[idxAcompStatus] = 'PENDENTE_RECEBIMENTO';
      var idxDiasPrazo = acharColuna_(headAcomp, ['DIAS_PRAZO', 'DIAS PRAZO']);
      if (idxDiasPrazo > -1) novaLinha[idxDiasPrazo] = diasPrazoPadrao;
      novasLinhas.push(novaLinha);
      qtdCriadas++;
    }
  });

  if (novasLinhas.length > 0) sheetAcomp.getRange(sheetAcomp.getLastRow() + 1, 1, novasLinhas.length, novasLinhas[0].length).setValues(novasLinhas);

  registrarLog(emailUsuario, 'GEROU_MES_WEB', 'Múltiplas', String(mes).padStart(2, '0') + '/' + ano, 'Geração Web: ' + qtdCriadas + ' criadas, ' + qtdAtualizadas + ' atualizadas. Cabeçalhos validados.');

  sincronizarValoresTotais();
  ordenarAcompanhamento();

  return 'Mês ' + mes + '/' + ano + ' processado!\n\n• Novas prestações: ' + qtdCriadas + '\n• Histórico atualizado: ' + qtdAtualizadas;
}

// ===================================================================
// TEMPLATES DE E-MAIL - CHAVES GARANTIDAS E UPSERT NA PLANILHA
// ===================================================================
function normalizarChaveTemplate_(chave) {
  return (chave || '').toString().toUpperCase().trim();
}

function removerAbaEmailTemplatesBackupSeExistir_() {
  try {
    var ss = SpreadsheetApp.getActive();
    var sheetBackup = ss.getSheetByName('EMAIL_TEMPLATES_BACKUP');
    if (sheetBackup) ss.deleteSheet(sheetBackup);
  } catch(e) {
    console.error('Não foi possível remover EMAIL_TEMPLATES_BACKUP: ' + e.message);
  }
}

function getEmailTemplatesPadrao_() {
  return {
    'EMAIL_RECEBIMENTO_SUBJECT': 'Recebimento da Prestação de Contas - {{ESCOLA}} - {{MES2}}/{{ANO}}',
    'EMAIL_RECEBIMENTO_BODY': 'Olá, Gestão da <strong>{{ESCOLA}}</strong>.<br><br>Confirmamos o recebimento da prestação de contas referente a {{MES2}}/{{ANO}}.<br><br>{{SIGNATURE}}',
    'EMAIL_DEVOLUCAO_SUBJECT': 'Pendências na Prestação de Contas - {{ESCOLA}} - {{MES2}}/{{ANO}}',
    'EMAIL_DEVOLUCAO_BODY': 'Olá, Gestão da <strong>{{ESCOLA}}</strong>.<br><br>Após análise da prestação de contas referente a {{MES2}}/{{ANO}}, foram identificadas as seguintes pendências:<br><br>{{PENDENCIAS}}<br><br>Solicitamos a regularização até {{PRAZO_ATE}}.<br><br>{{SIGNATURE}}',
    'EMAIL_APROVACAO_SUBJECT': 'Prestação de Contas Finalizada - {{ESCOLA}} - {{MES2}}/{{ANO}}',
    'EMAIL_APROVACAO_BODY': 'Olá, Gestão da <strong>{{ESCOLA}}</strong>.<br><br>Informamos que a prestação de contas referente a {{MES2}}/{{ANO}} foi analisada e finalizada.<br><br>{{SIGNATURE}}',
    'EMAIL_COBRANCA_SUBJECT': '⚠️ AVISO DE ATRASO: Prestação de Contas ({{MES2}}/{{ANO}}) - {{ESCOLA}}',
    'EMAIL_COBRANCA_BODY': 'Olá, Gestão da <strong>{{ESCOLA}}</strong>.<br><br>Consta em nosso sistema que a prestação de contas referente a {{MES2}}/{{ANO}} permanece pendente de recebimento.<br><br>Solicitamos o envio ou a regularização da documentação o quanto antes.<br><br>{{SIGNATURE}}',
    'EMAIL_SIGNATURE': 'Equipe de Prestação de Contas'
  };
}

function garantirAbaEmailTemplates_() {
  removerAbaEmailTemplatesBackupSeExistir_();

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('EMAIL_TEMPLATES');
  if (!sheet) {
    sheet = ss.insertSheet('EMAIL_TEMPLATES');
  }

  if (sheet.getMaxColumns() < 5) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 5 - sheet.getMaxColumns());
  }

  if (sheet.getLastRow() < 1 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, 5).setValues([['CHAVE', 'VALOR', 'DESCRICAO', 'ATUALIZADO_EM', 'ATUALIZADO_POR']]);
  } else {
    var headersAtuais = sheet.getRange(1, 1, 1, 5).getValues()[0];
    var headersPadrao = ['CHAVE', 'VALOR', 'DESCRICAO', 'ATUALIZADO_EM', 'ATUALIZADO_POR'];
    var precisaCorrigir = false;
    for (var h = 0; h < headersPadrao.length; h++) {
      if (!headersAtuais[h]) {
        headersAtuais[h] = headersPadrao[h];
        precisaCorrigir = true;
      }
    }
    if (precisaCorrigir) sheet.getRange(1, 1, 1, 5).setValues([headersAtuais]);
  }

  return sheet;
}

function garantirChavesTemplatesEmail_() {
  var sheet = garantirAbaEmailTemplates_();
  var padroes = getEmailTemplatesPadrao_();
  var data = sheet.getDataRange().getValues();
  var existentes = {};

  for (var i = 1; i < data.length; i++) {
    var chave = normalizarChaveTemplate_(data[i][0]);
    if (chave) existentes[chave] = true;
  }

  var novas = [];
  Object.keys(padroes).forEach(function(chave) {
    if (!existentes[chave]) {
      novas.push([chave, padroes[chave], 'Criado automaticamente pelo sistema', new Date(), 'SISTEMA']);
    }
  });

  if (novas.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, novas.length, 5).setValues(novas);
  }

  return sheet;
}

function lerTemplatesEmail_() {
  var sheet = garantirChavesTemplatesEmail_();
  var data = sheet.getDataRange().getValues();
  var templates = {};
  var padroes = getEmailTemplatesPadrao_();

  Object.keys(padroes).forEach(function(chave) { templates[chave] = padroes[chave]; });

  for (var i = 1; i < data.length; i++) {
    var chave = normalizarChaveTemplate_(data[i][0]);
    if (chave) templates[chave] = data[i][1] || '';
  }

  return templates;
}

// Busca template com tolerância a maiúsculas/minúsculas e cria as chaves se estiverem ausentes.
function getTemplateValue(chave) {
  try {
    var templates = lerTemplatesEmail_();
    return templates[normalizarChaveTemplate_(chave)] || '';
  } catch(e) {
    console.error('Erro ao buscar template: ' + chave + ' - ' + e.message);
  }
  return '';
}

function salvarTemplatesWeb(dados) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var emailUsuario = '';
    try { emailUsuario = Session.getActiveUser().getEmail(); } catch(e) {}

    var sheet = garantirChavesTemplatesEmail_();
    var data = sheet.getDataRange().getValues();
    var mapaLinhas = {};

    for (var i = 1; i < data.length; i++) {
      var chaveExistente = normalizarChaveTemplate_(data[i][0]);
      if (chaveExistente && !mapaLinhas[chaveExistente]) mapaLinhas[chaveExistente] = i + 1;
    }

    var atualizados = 0;
    var criados = 0;
    var recebidas = 0;

    Object.keys(dados || {}).forEach(function(chaveOriginal) {
      var chave = normalizarChaveTemplate_(chaveOriginal);
      if (!chave) return;
      recebidas++;

      var valor = dados[chaveOriginal] || '';

      if (mapaLinhas[chave]) {
        var linha = mapaLinhas[chave];
        sheet.getRange(linha, 2).setValue(valor);
        if (sheet.getMaxColumns() >= 4) sheet.getRange(linha, 4).setValue(new Date());
        if (sheet.getMaxColumns() >= 5) sheet.getRange(linha, 5).setValue(emailUsuario || '');
        atualizados++;
      } else {
        sheet.appendRow([chave, valor, 'Criado automaticamente ao salvar pelo painel Admin', new Date(), emailUsuario || '']);
        criados++;
      }
    });

    SpreadsheetApp.flush();

    registrarLog(
      emailUsuario,
      'ATUALIZOU_TEMPLATES',
      'Sistema Web',
      '-',
      'Editou templates de e-mail. Chaves recebidas: ' + recebidas + '. Atualizadas: ' + atualizados + '. Criadas: ' + criados + '. Salvamento direto em EMAIL_TEMPLATES.'
    );

    return 'Templates salvos com sucesso!\n\n• Chaves recebidas: ' + recebidas + '\n• Chaves atualizadas: ' + atualizados + '\n• Chaves criadas automaticamente: ' + criados + '\n\nAs alterações foram gravadas diretamente na aba EMAIL_TEMPLATES.';

  } catch(e) {
    return 'ERRO AO SALVAR TEMPLATES: ' + e.message;
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function inicializarTemplatesEmailWeb() {
  try {
    var sheet = garantirChavesTemplatesEmail_();
    return 'Chaves de e-mail conferidas/criadas com sucesso na aba EMAIL_TEMPLATES. Total de linhas: ' + sheet.getLastRow();
  } catch(e) {
    return 'ERRO AO INICIALIZAR TEMPLATES: ' + e.message;
  }
}

// Carrega os textos para a tela de Admin já com as chaves obrigatórias garantidas.
function getTemplatesWeb() {
  return lerTemplatesEmail_();
}

// ==============================================================================
// GESTÃO DE USUÁRIOS ATUALIZADA (COM NOME, EMAIL E ASSINATURA)
// ==============================================================================

function getUsuariosWeb() {
  var sheet = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().toUpperCase().trim(); });
  var idxNome = headers.indexOf("NOME"), idxEmail = headers.indexOf("EMAIL"), 
      idxPerfil = headers.indexOf("PERFIL"), idxAtivo = headers.indexOf("ATIVO"),
      idxAssinatura = headers.indexOf("ASSINATURA");
  
  var usuarios = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][idxEmail] || data[i][idxNome]) {
      usuarios.push({
        linha: i + 1,
        nome: data[i][idxNome] || "",
        email: data[i][idxEmail] ? data[i][idxEmail].toString().toLowerCase().trim() : "",
        perfil: data[i][idxPerfil] || "",
        ativo: data[i][idxAtivo] || "",
        assinatura: idxAssinatura > -1 ? data[i][idxAssinatura] : ""
      });
    }
  }
  return usuarios;
}

function salvarUsuarioWeb(linha, nome, email, perfil, ativo, assinatura) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if (!sheet) return "ERRO: Aba USUARIOS não encontrada.";
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return h.toString().toUpperCase().trim(); });
  
  if (headers.indexOf("NOME") > -1) sheet.getRange(linha, headers.indexOf("NOME") + 1).setValue(nome);
  if (headers.indexOf("EMAIL") > -1) sheet.getRange(linha, headers.indexOf("EMAIL") + 1).setValue(email.toLowerCase().trim());
  if (headers.indexOf("PERFIL") > -1) sheet.getRange(linha, headers.indexOf("PERFIL") + 1).setValue(perfil);
  if (headers.indexOf("ATIVO") > -1) sheet.getRange(linha, headers.indexOf("ATIVO") + 1).setValue(ativo);
  if (headers.indexOf("ASSINATURA") > -1) sheet.getRange(linha, headers.indexOf("ASSINATURA") + 1).setValue(assinatura);
  
  var emailUsuario = ""; try { emailUsuario = Session.getActiveUser().getEmail(); } catch(e){}
  registrarLog(emailUsuario, "EDITOU_USUARIO", "Sistema Web", "-", "Alterou dados do usuário " + email);
  
  return "Dados do usuário salvos com sucesso!";
}

// --- ADICIONAR USUÁRIO ATUALIZADO ---
function adicionarUsuarioWeb(nome, email, perfil, ativo, assinatura) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().toUpperCase().trim(); });
  var colEmail = headers.indexOf("EMAIL");
  
  for (var i = 1; i < data.length; i++) {
    if (colEmail > -1 && data[i][colEmail].toString().toLowerCase() === email.toLowerCase()) {
      return "AVISO: Este e-mail já está cadastrado.";
    }
  }
  
  var novaLinha = new Array(headers.length).fill("");
  if (headers.indexOf("NOME") > -1) novaLinha[headers.indexOf("NOME")] = nome;
  if (headers.indexOf("EMAIL") > -1) novaLinha[headers.indexOf("EMAIL")] = email.toLowerCase().trim();
  if (headers.indexOf("PERFIL") > -1) novaLinha[headers.indexOf("PERFIL")] = perfil;
  if (headers.indexOf("ATIVO") > -1) novaLinha[headers.indexOf("ATIVO")] = ativo || "SIM";
  if (headers.indexOf("ASSINATURA") > -1) novaLinha[headers.indexOf("ASSINATURA")] = assinatura || "";

  sheet.appendRow(novaLinha);
  
  var executor = ""; try { executor = Session.getActiveUser().getEmail(); } catch(e){}
  registrarLog(executor, "ADICIONOU_USUARIO", "Sistema Web", "-", "Adicionou " + email + " como " + perfil);

  return "Usuário adicionado com sucesso!";
}

function excluirUsuarioWeb(linha) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  sheet.deleteRow(linha);
  return "Usuário removido com sucesso!";
}

function getConfigGeralWeb() {
  var sheet = SpreadsheetApp.getActive().getSheetByName("CONFIG");
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var configs = {};
  for (var i = 1; i < data.length; i++) {
    var chave = data[i][0];
    if (chave) configs[chave] = data[i][1];
  }
  return configs;
}

function salvarConfigGeralWeb(dados) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("CONFIG");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var chave = data[i][0];
    if (dados.hasOwnProperty(chave)) sheet.getRange(i + 1, 2).setValue(dados[chave]);
  }
  return "Configurações salvas!";
}

function getEscolasCadastradasWeb() {
  var sheet = SpreadsheetApp.getActive().getSheetByName("CAD_ESCOLAS");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().toUpperCase().trim(); });
  var idxEscola = headers.indexOf("ESCOLA"), idxEmailUnid = headers.indexOf("EMAIL UNIDADE"), idxConfEmail = headers.indexOf("CONFERENTE_EMAIL"); 
  
  var escolas = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][idxEscola]) {
      escolas.push({
        linha: i + 1, nome: data[i][idxEscola], emailUnidade: idxEmailUnid > -1 ? data[i][idxEmailUnid] : "",
        conferenteEmail: idxConfEmail > -1 && data[i][idxConfEmail] ? data[i][idxConfEmail].toString().toLowerCase().trim() : ""
      });
    }
  }
  return escolas.sort((a, b) => a.nome.localeCompare(b.nome));
}

function salvarVinculoEscolaWeb(linha, nomeConferente, conferenteEmail) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("CAD_ESCOLAS");
  if (!sheet) return "ERRO: Aba CAD_ESCOLAS não encontrada.";
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return h.toString().toUpperCase().trim(); });
  
  var nomeEscola = "";
  if (headers.indexOf("ESCOLA") > -1) {
    nomeEscola = sheet.getRange(linha, headers.indexOf("ESCOLA") + 1).getValue();
  }
  
  if (headers.indexOf("CONFERENTE") > -1) sheet.getRange(linha, headers.indexOf("CONFERENTE") + 1).setValue(nomeConferente);
  if (headers.indexOf("CONFERENTE_EMAIL") > -1) sheet.getRange(linha, headers.indexOf("CONFERENTE_EMAIL") + 1).setValue(conferenteEmail);
  
  // MÁGICA: Sincronização em tempo real com as tarefas abertas
  try {
    if (nomeEscola && conferenteEmail) {
      var sheetAcomp = SpreadsheetApp.getActive().getSheetByName("ACOMPANHAMENTO");
      if (sheetAcomp) {
        var dadosA = sheetAcomp.getDataRange().getValues();
        var headA = dadosA[0].map(function(h){ return h.toString().toUpperCase().trim(); });
        var idxEscolaA = headA.indexOf("ESCOLA_NOME");
        var idxStatusA = headA.indexOf("STATUS");
        var idxConfA = headA.indexOf("CONFERENTE_EMAIL");
        
        if (idxEscolaA > -1 && idxConfA > -1) {
          for (var i = 1; i < dadosA.length; i++) {
            // Se for a mesma escola e a prestação ainda não foi finalizada, atualiza o dono
            if (dadosA[i][idxEscolaA] == nomeEscola && dadosA[i][idxStatusA] !== "FINALIZADO") {
               sheetAcomp.getRange(i + 1, idxConfA + 1).setValue(conferenteEmail);
            }
          }
        }
      }
    }
  } catch(e) {}
  
  return "Conferente vinculado com sucesso! O sistema também atualizou as prestações abertas desta unidade.";
}

function getDadosEscolasEUsuarios() { return { usuarios: getUsuariosWeb(), escolas: getEscolasCadastradasWeb() }; }

function autorizarEmail() {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), "Teste de Autorização", "Se você recebeu isso, o sistema de e-mails está autorizado!");
}

// --- FUNÇÃO DE VARREDURA AJUSTADA PARA OS NOMES REAIS DAS COLUNAS ---
function sincronizarValoresTotais() {
  var ss = SpreadsheetApp.getActive();
  var sheetAcomp = ss.getSheetByName("ACOMPANHAMENTO");
  var sheetCad = ss.getSheetByName("CAD_ESCOLAS");

  if (!sheetAcomp || !sheetCad) return;

  var dadosA = sheetAcomp.getDataRange().getValues();
  var headA = dadosA[0].map(function(h){ return h.toString().toUpperCase().trim()});
  
  // Na aba ACOMPANHAMENTO chama-se "VALOR TOTAL"
  var colEscolaA = headA.indexOf("ESCOLA_NOME"); 
  var colValorTotalA = headA.indexOf("VALOR TOTAL"); 

  var dadosC = sheetCad.getDataRange().getValues();
  var headC = dadosC[0].map(function(h){ return h.toString().toUpperCase().trim()});
  
  // Na aba CAD_ESCOLAS chama-se apenas "TOTAL"
  var colEscolaC = headC.indexOf("ESCOLA"); 
  var colValorTotalC = headC.indexOf("TOTAL"); 

  // Validação de erro específica para te ajudar
  if (colEscolaA === -1) { console.error("ERRO: 'ESCOLA_NOME' não encontrado em ACOMPANHAMENTO"); return; }
  if (colValorTotalA === -1) { console.error("ERRO: 'VALOR TOTAL' não encontrado em ACOMPANHAMENTO"); return; }
  if (colEscolaC === -1) { console.error("ERRO: 'ESCOLA' não encontrado em CAD_ESCOLAS"); return; }
  if (colValorTotalC === -1) { console.error("ERRO: 'TOTAL' não encontrado em CAD_ESCOLAS"); return; }

  // 1. Cria o dicionário de busca rápida
  var mapaValores = {};
  for (var j = 1; j < dadosC.length; j++) {
    var nomeEscolaCad = dadosC[j][colEscolaC].toString().toUpperCase().trim();
    var valorCad = dadosC[j][colValorTotalC];
    if (nomeEscolaCad !== "") {
      mapaValores[nomeEscolaCad] = valorCad;
    }
  }

  // 2. Varre o acompanhamento preenchendo/corrigindo
  for (var i = 1; i < dadosA.length; i++) {
    var nomeAcomp = dadosA[i][colEscolaA].toString().toUpperCase().trim();
    var valorAtual = dadosA[i][colValorTotalA];
    var valorCorreto = mapaValores[nomeAcomp];

    if (nomeAcomp !== "" && valorCorreto !== undefined) {
      if (valorAtual !== valorCorreto) {
        sheetAcomp.getRange(i + 1, colValorTotalA + 1)
                  .setValue(valorCorreto)
                  .setNumberFormat('R$ #,##0.00');
      }
    }
  }
  console.log("Sincronização concluída com sucesso!");
}

// --- FUNÇÃO COM "GOD MODE" (API + AUTO-RESIZE COLUNAS A-F) ---
function ordenarAcompanhamento() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName("ACOMPANHAMENTO");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  var maxCols = sheet.getMaxColumns();
  var maxRows = sheet.getMaxRows();

  // =========================================================
  // 1. ORDENAÇÃO NATIVA
  // =========================================================
  if (lastRow > 1) {
    var headers = sheet.getRange(1, 1, 1, maxCols).getValues()[0].map(function(h){ return h.toString().toUpperCase().trim()});
    var colMes = headers.indexOf("MES") + 1;
    var colConf = headers.indexOf("CONFERENTE") + 1;
    if (colConf <= 0) colConf = headers.indexOf("CONFERENTE_EMAIL") + 1;
    var colEscola = headers.indexOf("ESCOLA_NOME") + 1;

    var rangeDados = sheet.getRange(2, 1, lastRow - 1, maxCols);
    var criterios = [];
    if (colMes > 0) criterios.push({column: colMes, ascending: true});
    if (colConf > 0) criterios.push({column: colConf, ascending: true});
    if (colEscola > 0) criterios.push({column: colEscola, ascending: true});

    if (criterios.length > 0) rangeDados.sort(criterios);
  }
  
  SpreadsheetApp.flush(); 

  // =========================================================
  // 2. AJUSTE DE COLUNAS (A até F)
  // =========================================================
  // Este comando ajusta a largura das colunas 1 (A) até a 6 (F) automaticamente
  sheet.autoResizeColumns(1, 6);

  // =========================================================
  // 3. FORMATAÇÃO BÁSICA DE TEXTO
  // =========================================================
  var rangeTotal = sheet.getRange(1, 1, maxRows, maxCols);
  rangeTotal.setWrap(false);
  rangeTotal.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  rangeTotal.setVerticalAlignment("middle");
  
  SpreadsheetApp.flush();

  // =========================================================
  // 4. API AVANÇADA (Trava a Altura das Linhas em 23px)
  // =========================================================
  try {
    var sheetId = sheet.getSheetId();
    var requests = [{
      "updateDimensionProperties": {
        "range": {
          "sheetId": sheetId,
          "dimension": "ROWS",
          "startIndex": 1, 
          "endIndex": maxRows 
        },
        "properties": {
          "pixelSize": 23
        },
        "fields": "pixelSize"
      }
    }];
    
    Sheets.Spreadsheets.batchUpdate({'requests': requests}, ss.getId());
    console.log("Colunas A-F ajustadas e Linhas cravadas em 23px!");

  } catch (e) {
    console.error("Erro no ajuste final: " + e.message);
    sheet.setRowHeights(2, maxRows - 1, 23); 
  }
}

// ===================================================================
// FUNÇÃO: SINCRONIZAR CONFERENTES (CAD_ESCOLAS -> ACOMPANHAMENTO)
// ===================================================================
function sincronizarConferentes() {
  var ss = SpreadsheetApp.getActive();
  var sheetAcomp = ss.getSheetByName('ACOMPANHAMENTO');
  var sheetCad = ss.getSheetByName('CAD_ESCOLAS');
  if (!sheetAcomp || !sheetCad) return;

  var dadosA = sheetAcomp.getDataRange().getValues();
  if (!dadosA || dadosA.length < 2) return;
  var headA = dadosA[0].map(function(h){ return h.toString().trim(); });

  var colEscolaA = acharColuna_(headA, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR']);
  var colStatusA = acharColuna_(headA, ['STATUS']);
  var colConfA = acharColuna_(headA, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'CONFERENTE']);
  var colEmailUnidA = acharColuna_(headA, ['EMAIL_UNIDADE', 'EMAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA']);
  if (colEscolaA === -1 || colConfA === -1) return;

  var dadosC = sheetCad.getDataRange().getValues();
  if (!dadosC || dadosC.length < 2) return;
  var headC = dadosC[0].map(function(h){ return h.toString().trim(); });
  var colEscolaC = acharColuna_(headC, ['ESCOLA', 'ESCOLA NOME', 'UNIDADE ESCOLAR', 'INSTITUICAO', 'INSTITUIÇÃO'], 2);
  var colConfEmailC = acharColuna_(headC, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL CONFERENTE', 'E MAIL CONFERENTE']);
  var colEmailUnidC = acharColuna_(headC, ['EMAIL UNIDADE', 'EMAIL_UNIDADE', 'E MAIL UNIDADE', 'EMAIL DA UNIDADE', 'EMAIL ESCOLA', 'E MAIL ESCOLA'], 12);

  var mapa = {};
  for (var c = 1; c < dadosC.length; c++) {
    var chave = colEscolaC > -1 ? normalizarChaveEscola_(dadosC[c][colEscolaC]) : '';
    if (!chave) continue;
    mapa[chave] = {
      conferenteEmail: colConfEmailC > -1 ? normalizarEmail_(dadosC[c][colConfEmailC]) : '',
      emailUnidade: colEmailUnidC > -1 ? normalizarEmail_(dadosC[c][colEmailUnidC]) : ''
    };
  }

  var novosConferentes = [];
  var novosEmailsUnidade = [];
  for (var i = 1; i < dadosA.length; i++) {
    var status = colStatusA > -1 ? String(dadosA[i][colStatusA] || '').toUpperCase().trim() : '';
    var finalizado = status === 'FINALIZADO';
    var chaveA = normalizarChaveEscola_(dadosA[i][colEscolaA]);
    var cad = mapa[chaveA];

    var confAtual = dadosA[i][colConfA];
    var emailUnidAtual = colEmailUnidA > -1 ? dadosA[i][colEmailUnidA] : '';

    novosConferentes.push([(!finalizado && cad && cad.conferenteEmail) ? cad.conferenteEmail : confAtual]);
    if (colEmailUnidA > -1) novosEmailsUnidade.push([(!finalizado && cad && cad.emailUnidade) ? cad.emailUnidade : emailUnidAtual]);
  }

  if (novosConferentes.length) sheetAcomp.getRange(2, colConfA + 1, novosConferentes.length, 1).setValues(novosConferentes);
  if (colEmailUnidA > -1 && novosEmailsUnidade.length) sheetAcomp.getRange(2, colEmailUnidA + 1, novosEmailsUnidade.length, 1).setValues(novosEmailsUnidade);
}

// ===================================================================
// FUNÇÃO: ENVIAR E-MAIL DE COBRANÇA (INTEGRADA COM TEMPLATE DINÂMICO)
// ===================================================================
function enviarCobrancaBackend(dadosForm) {
  var lock = LockService.getDocumentLock();
  var lockObtido = false;

  try {
    dadosForm = dadosForm || {};
    var emailLogado = '';
    try { emailLogado = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(e) {}

    var listaVip = getListaVip_();
    var isTestMode = listaVip.indexOf(emailLogado) > -1;
    var emailUsuario = normalizarEmail_(dadosForm.emailUsuario || emailLogado);
    var perfilUsuario = obterPerfilDoUsuario(emailUsuario);

    var ss = SpreadsheetApp.getActive();
    var sheetAcomp = ss.getSheetByName('ACOMPANHAMENTO');
    if (!sheetAcomp) throw new Error('Aba ACOMPANHAMENTO não encontrada.');

    lock.waitLock(30000);
    lockObtido = true;

    var headers = sheetAcomp.getRange(1, 1, 1, sheetAcomp.getLastColumn()).getValues()[0].map(function(h){ return h.toString().trim(); });
    var colCobranca = garantirColuna_(sheetAcomp, headers, 'COBRANCA_ENVIADA_EM');

    // Recarrega a linha após garantir a existência da coluna de controle.
    var resolucao = resolverLinhaAcompanhamento_(sheetAcomp, headers, dadosForm);
    var linha = resolucao.linha;
    var rowData = resolucao.rowData;

    if (!validarPermissaoRegistro_(emailUsuario, perfilUsuario, rowData, headers, 'COBRAR')) {
      throw new Error('Você não tem permissão para enviar cobrança desta unidade. Recarregue a tela e verifique a listagem.');
    }

    var colEscola = acharColuna_(headers, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR']);
    var colMes = acharColuna_(headers, ['MES', 'MÊS']);
    var colAno = acharColuna_(headers, ['ANO']);
    var colStatus = acharColuna_(headers, ['STATUS']);
    var statusAtual = colStatus > -1 ? String(rowData[colStatus] || '').toUpperCase().replace(/\s+/g, '_') : '';
    if (statusAtual !== 'PENDENTE_RECEBIMENTO' && statusAtual !== '') {
      throw new Error('O botão de cobrança só pode ser usado quando o status está PENDENTE_RECEBIMENTO. Status atual: ' + statusAtual);
    }

    var cobrancaJaEnviada = rowData[colCobranca];
    var dataCobrancaAnterior = cobrancaJaEnviada ? formatarDataHoraSistema_(cobrancaJaEnviada) : '';
    var confirmouNovaCobranca = dadosForm.confirmarNovaCobranca === true || String(dadosForm.confirmarNovaCobranca || '').toUpperCase() === 'SIM';

    if (cobrancaJaEnviada && !confirmouNovaCobranca) {
      throw new Error('Esta prestação já recebeu cobrança em ' + dataCobrancaAnterior + '. Para reenviar, confirme a nova cobrança na tela.');
    }

    var nomeEscola = rowData[colEscola] || '';
    var mesStr = String(rowData[colMes]).padStart(2, '0');
    var anoPlanilha = rowData[colAno] || '';
    var cadastro = lerCadastroEscolaPorNome_(nomeEscola) || {};
    var emailEscola = obterEmailUnidadeSeguro_(nomeEscola, rowData, headers);
    var nomeGestor = cadastro.gestor || '';

    if (!emailEscola && !isTestMode) throw new Error('E-mail da unidade não encontrado na aba CAD_ESCOLAS para ' + nomeEscola + '.');

    var assinatura = obterAssinaturaUsuario(emailUsuario) || getTemplateValue('EMAIL_SIGNATURE') || '';
    assinatura = assinatura.replace(/\n/g, '<br>');

    function processarTemplate(texto) {
      if (!texto) return '';
      if (texto.indexOf('<p>') === -1) texto = texto.replace(/\r?\n/g, '<br><br>');
      return texto.replace(/\{\{ESCOLA\}\}/g, nomeEscola)
                  .replace(/\{\{MES2\}\}/g, mesStr)
                  .replace(/\{\{ANO\}\}/g, anoPlanilha)
                  .replace(/\{\{GESTOR\}\}/g, nomeGestor)
                  .replace(/\{\{SIGNATURE\}\}/g, assinatura);
    }

    var subjectTemplate = getTemplateValue('EMAIL_COBRANCA_SUBJECT') || '⚠️ AVISO DE ATRASO: Prestação de Contas ({{MES2}}/{{ANO}}) - {{ESCOLA}}';
    var bodyTemplate = getTemplateValue('EMAIL_COBRANCA_BODY') || 'Olá, Gestão da <strong>{{ESCOLA}}</strong>.<br><br>Consta em nosso sistema que a prestação de contas de {{MES2}}/{{ANO}} está PENDENTE.<br><br>{{SIGNATURE}}';

    var assunto = processarTemplate(subjectTemplate);
    var corpoHtml = processarTemplate(bodyTemplate);
    var destinoOriginalCobranca = emailEscola || emailLogado;
    var destinoFinalCobrancaLog = isTestMode ? (emailLogado + ' [MODO TESTE; original seria: ' + (emailEscola || 'não encontrado') + ']') : destinoOriginalCobranca;

    var enviado = safeSendEmail_(destinoOriginalCobranca, assunto, corpoHtml, { name: getConfigValue('REMETENTE_NOME') || 'Prestação de Contas' });
    var statusEmail = enviado ? '\n✅ E-mail de cobrança disparado para: ' + destinoFinalCobrancaLog : '\n❌ Falha no envio do e-mail.';

    var rastreioCobranca = montarRastreioEmail_({
      tipo: cobrancaJaEnviada ? 'REENVIO_COBRANCA_PENDENTE_RECEBIMENTO' : 'COBRANCA_PENDENTE_RECEBIMENTO',
      acao: cobrancaJaEnviada ? 'COBRANCA_EMAIL_REENVIADA' : 'COBRANCA_EMAIL',
      usuario: emailUsuario,
      linhaAcompanhamento: linha,
      linhaCorrigida: resolucao.corrigida,
      escolaLinha: nomeEscola,
      mesAno: mesStr + '/' + anoPlanilha,
      headers: headers,
      rowData: rowData,
      cadastro: cadastro,
      emailResolvido: emailEscola || '',
      destinatarioFinal: destinoFinalCobrancaLog,
      cc: '',
      assunto: assunto,
      resultado: enviado ? 'ENVIADO' : 'FALHA_ENVIO',
      cobrancaAnterior: dataCobrancaAnterior || 'NÃO HAVIA COBRANÇA ANTERIOR',
      reenvioConfirmado: cobrancaJaEnviada ? 'SIM' : 'NÃO'
    });

    if (!enviado) {
      registrarLog(emailUsuario, 'COBRANCA_EMAIL_FALHA', nomeEscola, mesStr + '/' + anoPlanilha, rastreioCobranca);
      throw new Error('O e-mail de cobrança não foi enviado. Nenhuma data de cobrança foi gravada.');
    }

    var agora = new Date();
    var carimbo = Utilities.formatDate(agora, 'GMT-3', 'dd/MM/yyyy HH:mm');

    var colHist = acharColuna_(headers, ['HISTORICO_PENDENCIAS', 'HISTÓRICO PENDÊNCIAS', 'HISTORICO DE PENDENCIAS']);
    if (!isTestMode) {
      sheetAcomp.getRange(linha, colCobranca + 1).setValue(agora).setNumberFormat('dd/MM/yyyy HH:mm');
      if (colHist > -1) {
        var histAntigo = rowData[colHist] || '';
        var prefixoCobranca = cobrancaJaEnviada ? '⚠️ Nova cobrança de envio reenviada em ' : '⚠️ Cobrança de envio disparada em ';
        var detalheAnterior = cobrancaJaEnviada ? '\nCobrança anterior registrada em: ' + dataCobrancaAnterior : '';
        var novoReg = prefixoCobranca + carimbo + detalheAnterior + '\nDestinatário final: ' + destinoFinalCobrancaLog + '\nE-mail resolvido da unidade: ' + (emailEscola || 'não encontrado') + '\n---\n' + histAntigo;
        sheetAcomp.getRange(linha, colHist + 1).setValue(novoReg);
      }
    }

    registrarLog(emailUsuario, cobrancaJaEnviada ? 'COBRANCA_EMAIL_REENVIADA' : 'COBRANCA_EMAIL', nomeEscola, mesStr + '/' + anoPlanilha, (cobrancaJaEnviada ? 'Reenviada em: ' : 'Enviada em: ') + carimbo + (dataCobrancaAnterior ? ' | Cobrança anterior: ' + dataCobrancaAnterior : '') + ' | ' + rastreioCobranca + (isTestMode ? ' | MODO TESTE sem gravação de data.' : ''));

    if (isTestMode) return '✅ [MODO TESTE] E-mail simulado com sucesso!' + statusEmail + '\nℹ️ Em modo teste, a data não foi gravada para não bloquear novos testes.';
    return (cobrancaJaEnviada ? 'Nova cobrança reenviada com segurança!' : 'Cobrança efetuada com segurança!') + statusEmail + (dataCobrancaAnterior ? '\n📅 Cobrança anterior: ' + dataCobrancaAnterior : '') + '\n📅 Data registrada: ' + carimbo;

  } catch (e) {
    return 'ERRO NO SERVIDOR: ' + e.message;
  } finally {
    if (lockObtido) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}

// ===================================================================
// PDDE - PERSISTÊNCIA DO ÚLTIMO RELATÓRIO PROCESSADO
// Mantém os painéis/gráficos salvos no sistema e substitui somente
// quando uma nova planilha for processada na tela PDDE.
// ===================================================================
function usuarioPodeAcessarPdde_(email) {
  email = normalizarEmail_(email);
  var perfil = obterPerfilDoUsuario(email);
  return getListaVip_().indexOf(email) > -1 ||
         getUsuariosImplantacaoPdde_().indexOf(email) > -1 ||
         perfil === 'ADMIN' ||
         perfil === 'ADMIN E CONFERENTE';
}

function getPddeEstadoSheet_() {
  var ss = SpreadsheetApp.getActive();
  var nome = '_PDDE_ESTADO_SISTEMA';
  var sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
    sheet.hideSheet();
  }
  return sheet;
}

function salvarEstadoPddeWeb(payload) {
  var email = '';
  try { email = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(e) {}
  if (!usuarioPodeAcessarPdde_(email)) throw new Error('Usuário sem permissão para salvar o estado do PDDE.');
  if (!payload || !payload.bruto || !payload.agregado) throw new Error('Payload do PDDE inválido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var sheet = getPddeEstadoSheet_();
    sheet.clear();

    var salvoEm = new Date();
    var pacote = {
      versao: 1,
      salvoEm: salvoEm.toISOString(),
      salvoPor: email,
      nomeArquivo: payload.nomeArquivo || '',
      payload: payload
    };

    var json = JSON.stringify(pacote);
    var tamanhoChunk = 45000; // abaixo do limite máximo de caracteres por célula
    var chunks = [];
    for (var i = 0; i < json.length; i += tamanhoChunk) {
      chunks.push([Math.floor(i / tamanhoChunk) + 1, json.substring(i, i + tamanhoChunk)]);
    }

    sheet.getRange(1, 1, 1, 5).setValues([['TIPO', 'VALOR', 'SALVO_EM', 'SALVO_POR', 'NOME_ARQUIVO']]);
    sheet.getRange(2, 1, 1, 5).setValues([['META', chunks.length, salvoEm, email, payload.nomeArquivo || '']]);
    sheet.getRange(3, 1, 1, 2).setValues([['CHUNK_INDEX', 'JSON_CHUNK']]);
    if (chunks.length) sheet.getRange(4, 1, chunks.length, 2).setValues(chunks);
    sheet.autoResizeColumns(1, 5);
    sheet.hideSheet();

    return {
      ok: true,
      salvoEm: salvoEm.toISOString(),
      salvoPor: email,
      nomeArquivo: payload.nomeArquivo || '',
      chunks: chunks.length
    };
  } finally {
    lock.releaseLock();
  }
}

function getEstadoPddeWeb() {
  var email = '';
  try { email = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(e) {}
  if (!usuarioPodeAcessarPdde_(email)) return { ok: false, vazio: true, mensagem: 'Usuário sem permissão para carregar o PDDE.' };

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('_PDDE_ESTADO_SISTEMA');
  if (!sheet || sheet.getLastRow() < 4) return { ok: true, vazio: true };

  var lastRow = sheet.getLastRow();
  var chunks = sheet.getRange(4, 1, lastRow - 3, 2).getValues()
    .filter(function(r){ return r[0] && r[1]; })
    .sort(function(a, b){ return Number(a[0]) - Number(b[0]); })
    .map(function(r){ return String(r[1]); });

  if (!chunks.length) return { ok: true, vazio: true };

  try {
    var pacote = JSON.parse(chunks.join(''));
    return {
      ok: true,
      vazio: false,
      salvoEm: pacote.salvoEm || '',
      salvoPor: pacote.salvoPor || '',
      nomeArquivo: pacote.nomeArquivo || '',
      payload: pacote.payload || {}
    };
  } catch(e) {
    return { ok: false, vazio: true, mensagem: 'Estado salvo do PDDE está corrompido: ' + e.message };
  }
}


// ===================================================================
// PDDE - TELA DO CONFERENTE
// Estrutura inicial no mesmo padrão operacional da tela de conferente da
// Prestação de Contas. Por enquanto fica em modo implantação/leitura,
// porque o modelo definitivo da planilha mensal de conferência PDDE ainda
// será fechado. Quando o modelo vier, usaremos esta mesma tela para salvar
// recebimento, devolução, pendências, histórico e finalização mensal.
// ===================================================================
function getDadosPddeConferenteWeb(email) {
  email = normalizarEmail_(email);
  if (!usuarioPodeAcessarPdde_(email)) {
    return { ok: false, mensagem: 'Usuário sem permissão para acessar a conferência PDDE.' };
  }

  var estado = getEstadoPddeWeb();
  if (!estado || estado.vazio || !estado.payload) {
    return {
      ok: true,
      vazio: true,
      modoImplantacao: true,
      mensagem: 'Ainda não existe relatório PDDE salvo. Primeiro processe a planilha no painel PDDE.'
    };
  }

  var agregado = estado.payload.agregado || [];
  var campos = estado.payload.camposNumericos || [];
  var totalCampoPrincipal = campos.indexOf('Total') > -1 ? 'Total' : (campos[campos.length - 1] || '');
  var acoesMapa = {};

  var linhas = agregado.slice(0, 1200).map(function(l, idx){
    var acao = l['Ação'] || l['Recurso'] || 'PDDE';
    var instituicao = l['Instituição'] || l['Escola'] || l['Unidade'] || '';
    if (acao) acoesMapa[acao] = true;
    return {
      id: Utilities.base64EncodeWebSafe(String(acao) + '|' + String(instituicao) + '|' + idx),
      linhaVirtual: idx + 1,
      acao: acao,
      recurso: acao,
      instituicao: instituicao,
      escola: instituicao,
      mesAno: 'Implantação',
      status: 'PENDENTE_CONFERENCIA',
      pendencias: '',
      historico: '',
      prazo: '',
      recebidoEm: '',
      devolvidoEm: '',
      finalizadoEm: '',
      total: totalCampoPrincipal ? (Number(l[totalCampoPrincipal]) || 0) : 0,
      campoTotal: totalCampoPrincipal,
      linhasOrigem: (l['__linhasOrigem'] || []).join(', '),
      bruto: l
    };
  });

  return {
    ok: true,
    vazio: false,
    modoImplantacao: true,
    mensagem: 'Tela de conferência PDDE criada no padrão da conferência mensal. O fluxo ainda está em modo leitura até definirmos a planilha mensal definitiva do PDDE.',
    nomeArquivo: estado.nomeArquivo || '',
    salvoEm: estado.salvoEm || '',
    salvoPor: estado.salvoPor || '',
    acoes: Object.keys(acoesMapa).sort(),
    totalInstituicoes: linhas.length,
    campoTotal: totalCampoPrincipal,
    linhas: linhas
  };
}

// ===================================================================
// RELATÓRIO GERENCIAL DE CONFERENTES - PRESTAÇÃO DE CONTAS
// ===================================================================
function getRelatorioGerencialConferentesWeb(filtros) {
  filtros = filtros || {};
  var email = '';
  try { email = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(e) {}
  var perfil = obterPerfilDoUsuario(email);
  var isVip = getListaVip_().indexOf(email) > -1;
  if (!isVip && perfil !== 'ADMIN' && perfil !== 'ADMIN E CONFERENTE') {
    throw new Error('Usuário sem permissão para gerar o relatório gerencial de conferentes.');
  }

  var filtroConf = filtros.conferente && filtros.conferente !== 'ALL' ? normalizarEmail_(filtros.conferente) : 'ALL';
  var filtroMes = filtros.mesAno && filtros.mesAno !== 'ALL' ? String(filtros.mesAno).trim() : 'ALL';
  var filtroSituacao = filtros.situacao && filtros.situacao !== 'ALL' ? String(filtros.situacao).toUpperCase().trim() : 'ALL';
  var filtroEscola = filtros.escola ? normalizarTextoSistema_(filtros.escola) : '';

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('ACOMPANHAMENTO');
  if (!sheet) throw new Error('Aba ACOMPANHAMENTO não encontrada.');

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { geradoEm: formatarDataHoraSistema_(new Date()), filtros: filtros, resumoConferente: [], resumoConferenteMes: [], detalhe: [] };

  var headers = data[0].map(function(h){ return h.toString().trim(); });
  var colEscola = acharColuna_(headers, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR']);
  var colMes = acharColuna_(headers, ['MES', 'MÊS']);
  var colAno = acharColuna_(headers, ['ANO']);
  var colStatus = acharColuna_(headers, ['STATUS']);
  var colConf = acharColuna_(headers, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL_CONFERENTE', 'CONFERENTE']);
  var colPrazo = acharColuna_(headers, ['PRAZO_ATE', 'PRAZO ATÉ', 'PRAZO']);
  var colRecebido = acharColuna_(headers, ['RECEBIDO_EM', 'RECEBIDO EM']);
  var colDevolvido = acharColuna_(headers, ['DEVOLVIDO_EM', 'DEVOLVIDO EM']);
  var colFinalizado = acharColuna_(headers, ['FINALIZADO_EM', 'FINALIZADO EM']);
  var colCobranca = acharColuna_(headers, ['COBRANCA_ENVIADA_EM', 'COBRANÇA ENVIADA EM']);

  var hoje = new Date();
  var detalhe = [];
  var mapaConf = {};
  var mapaConfMes = {};

  function statusNorm(row) {
    return (colStatus > -1 ? String(row[colStatus] || '') : '').toUpperCase().replace(/\s+/g, '_') || 'PENDENTE_RECEBIMENTO';
  }

  function classificarSituacaoGerencial_(st) {
    st = (st || 'PENDENTE_RECEBIMENTO').toString().toUpperCase().replace(/\s+/g, '_');
    if (st === 'FINALIZADO') return { codigo: 'CONFERIDO', texto: 'Conferido / finalizado' };
    if (st === 'RECEBIDO') return { codigo: 'PENDENTE_CONFERENCIA', texto: 'Pendente de conferência pelo conferente' };
    if (st.indexOf('DEVOLVIDO') > -1) return { codigo: 'PENDENTE_RETORNO', texto: 'Pendente de retorno pela entidade' };
    return { codigo: 'PENDENTE_ENTREGA', texto: 'Pendente de entrega pela entidade' };
  }

  function dataLinha(row) {
    var candidatos = [colFinalizado, colDevolvido, colRecebido, colCobranca, colPrazo];
    for (var i = 0; i < candidatos.length; i++) {
      var idx = candidatos[i];
      if (idx > -1) {
        var d = parseDataRelatorioGerencial_(row[idx]);
        if (d) return d;
      }
    }
    return null;
  }

  function criarAgg(conf, mesAno) {
    return {
      'Conferente': conf || '-',
      'Mês/Ano': mesAno || 'Sem mês',
      'Total atribuído': 0,
      'Conferências feitas': 0,
      'Conferências não finalizadas': 0,
      'Pendente de entrega pela entidade': 0,
      'Pendente de conferência pelo conferente': 0,
      'Pendente de retorno pela entidade': 0,
      'Finalizado': 0,
      'Maior tempo parado (dias)': 0,
      'Média tempo parado (dias)': 0,
      '_somaDias': 0,
      '_qtdDias': 0
    };
  }

  function passaFiltros_(conf, mesAno, escola, situacao) {
    if (filtroConf !== 'ALL' && conf !== filtroConf) return false;
    if (filtroMes !== 'ALL' && mesAno !== filtroMes) return false;
    if (filtroEscola && normalizarTextoSistema_(escola).indexOf(filtroEscola) === -1) return false;
    if (filtroSituacao !== 'ALL') {
      if (filtroSituacao === 'NAO_FINALIZADO') {
        if (situacao.codigo === 'CONFERIDO') return false;
      } else if (situacao.codigo !== filtroSituacao) return false;
    }
    return true;
  }

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (colEscola > -1 && !row[colEscola]) continue;

    var escola = colEscola > -1 ? row[colEscola] : '';
    var mesAno = (colMes > -1 && colAno > -1) ? String(row[colMes]).padStart(2, '0') + '/' + row[colAno] : 'Sem mês';
    var conf = colConf > -1 ? normalizarEmail_(row[colConf] || '-') : '-';
    var st = statusNorm(row);
    var situacao = classificarSituacaoGerencial_(st);

    if (!passaFiltros_(conf, mesAno, escola, situacao)) continue;

    var dataUltima = dataLinha(row);
    var finalizado = st === 'FINALIZADO';
    var diasParado = (!finalizado && dataUltima) ? Math.max(0, Math.floor((zerarHoraRelatorio_(hoje) - zerarHoraRelatorio_(dataUltima)) / 86400000)) : 0;

    var item = {
      'Conferente': conf || '-',
      'Mês/Ano': mesAno,
      'Escola': escola,
      'Situação gerencial': situacao.texto,
      'Status original': st.replace(/_/g, ' '),
      'Dias parado': diasParado,
      'Última movimentação usada': dataUltima ? formatarDataHoraSistema_(dataUltima) : '',
      'Prazo': colPrazo > -1 ? formatarDataHoraSistema_(row[colPrazo]) : '',
      'Recebido em': colRecebido > -1 ? formatarDataHoraSistema_(row[colRecebido]) : '',
      'Devolvido em': colDevolvido > -1 ? formatarDataHoraSistema_(row[colDevolvido]) : '',
      'Finalizado em': colFinalizado > -1 ? formatarDataHoraSistema_(row[colFinalizado]) : '',
      'Cobrança enviada em': colCobranca > -1 ? formatarDataHoraSistema_(row[colCobranca]) : '',
      'Linha ACOMPANHAMENTO': i + 1
    };
    detalhe.push(item);

    var kConf = conf || '-';
    var kConfMes = kConf + '||' + mesAno;
    if (!mapaConf[kConf]) mapaConf[kConf] = criarAgg(kConf, 'Todos');
    if (!mapaConfMes[kConfMes]) mapaConfMes[kConfMes] = criarAgg(kConf, mesAno);

    [mapaConf[kConf], mapaConfMes[kConfMes]].forEach(function(agg){
      agg['Total atribuído']++;
      if (finalizado) agg['Conferências feitas']++;
      else agg['Conferências não finalizadas']++;
      if (situacao.codigo === 'PENDENTE_ENTREGA') agg['Pendente de entrega pela entidade']++;
      else if (situacao.codigo === 'PENDENTE_CONFERENCIA') agg['Pendente de conferência pelo conferente']++;
      else if (situacao.codigo === 'PENDENTE_RETORNO') agg['Pendente de retorno pela entidade']++;
      else if (situacao.codigo === 'CONFERIDO') agg['Finalizado']++;
      if (!finalizado) {
        agg['Maior tempo parado (dias)'] = Math.max(agg['Maior tempo parado (dias)'], diasParado);
        agg._somaDias += diasParado;
        agg._qtdDias++;
      }
    });
  }

  function finalizarAgg(mapa) {
    return Object.keys(mapa).map(function(k){
      var a = mapa[k];
      a['Média tempo parado (dias)'] = a._qtdDias ? Math.round((a._somaDias / a._qtdDias) * 10) / 10 : 0;
      delete a._somaDias;
      delete a._qtdDias;
      return a;
    }).sort(function(a,b){
      var c = String(a['Conferente']).localeCompare(String(b['Conferente']), 'pt-BR');
      if (c !== 0) return c;
      return String(a['Mês/Ano']).localeCompare(String(b['Mês/Ano']), 'pt-BR');
    });
  }

  detalhe.sort(function(a,b){
    var c = String(a['Conferente']).localeCompare(String(b['Conferente']), 'pt-BR');
    if (c !== 0) return c;
    var m = String(a['Mês/Ano']).localeCompare(String(b['Mês/Ano']), 'pt-BR');
    if (m !== 0) return m;
    return (Number(b['Dias parado']) || 0) - (Number(a['Dias parado']) || 0);
  });

  registrarLog(email, 'GEROU_RELATORIO_GERENCIAL_CONFERENTES', 'Sistema Web', '-', 'Gerou relatório gerencial filtrado com ' + detalhe.length + ' linhas. Filtros: ' + JSON.stringify(filtros));

  return {
    geradoEm: formatarDataHoraSistema_(new Date()),
    filtros: filtros,
    resumoConferente: finalizarAgg(mapaConf),
    resumoConferenteMes: finalizarAgg(mapaConfMes),
    detalhe: detalhe
  };
}

function parseDataRelatorioGerencial_(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) return valor;
  try {
    var d = new Date(valor);
    if (d instanceof Date && !isNaN(d)) return d;
  } catch(e) {}
  return null;
}

function zerarHoraRelatorio_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ===================================================================
// RELATÓRIO GERENCIAL DINÂMICO - V30
// Funções robustas para filtros, prévia e geração do XLSX.
// ===================================================================

function getEmailsRelatorioGerencialPrestacao_() {
  // Usuários autorizados a gerar o relatório gerencial da Prestação de Contas sem virar VIP.
  return [
    'usuario@educacao.pmrp.sp.gov.br'
  ];
}

function validarPermissaoRelatorioGerencialV30_() {
  var email = '';
  try { email = normalizarEmail_(Session.getActiveUser().getEmail()); } catch(e) {}
  var perfil = obterPerfilDoUsuario(email);
  var isVip = getListaVip_().indexOf(email) > -1;
  var isAutorizadoRelatorio = getEmailsRelatorioGerencialPrestacao_().indexOf(email) > -1;
  if (!isVip && !isAutorizadoRelatorio && perfil !== 'ADMIN' && perfil !== 'ADMIN E CONFERENTE') {
    throw new Error('Usuário sem permissão para gerar o relatório gerencial de conferentes. Usuário detectado: ' + (email || 'não identificado'));
  }
  return email;
}

function mesAnoRelatorioGerencialV30_(row, colMes, colAno) {
  var mes = colMes > -1 ? row[colMes] : '';
  var ano = colAno > -1 ? row[colAno] : '';
  if (mes instanceof Date && !isNaN(mes)) {
    return Utilities.formatDate(mes, 'GMT-3', 'MM/yyyy');
  }
  if (ano instanceof Date && !isNaN(ano)) {
    ano = Utilities.formatDate(ano, 'GMT-3', 'yyyy');
  }
  mes = String(mes || '').trim();
  ano = String(ano || '').trim();
  if (!mes && !ano) return 'Sem mês';
  if (!mes) return 'Sem mês';
  var nMes = parseInt(mes, 10);
  if (!isNaN(nMes)) mes = String(nMes).padStart(2, '0');
  else mes = mes.padStart(2, '0');
  return ano ? (mes + '/' + ano) : mes;
}

function chaveMesRelatorioGerencialV30_(mesAno) {
  var m = String(mesAno || '');
  var p = m.split('/');
  if (p.length === 2) return p[1] + '-' + p[0].padStart(2, '0');
  return m;
}

function classificarSituacaoGerencialV30_(status) {
  var st = (status || 'PENDENTE_RECEBIMENTO').toString().toUpperCase().replace(/\s+/g, '_');
  if (st === 'FINALIZADO') return { codigo: 'CONFERIDO', texto: 'Conferido / finalizado' };
  if (st === 'RECEBIDO') return { codigo: 'PENDENTE_CONFERENCIA', texto: 'Pendente de conferência pelo conferente' };
  if (st.indexOf('DEVOLVIDO') > -1) return { codigo: 'PENDENTE_RETORNO', texto: 'Pendente de retorno pela entidade' };
  return { codigo: 'PENDENTE_ENTREGA', texto: 'Pendente de entrega pela entidade' };
}

function parseDataRelatorioGerencialV30_(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) return valor;
  try {
    var d = new Date(valor);
    if (d instanceof Date && !isNaN(d)) return d;
  } catch(e) {}
  return null;
}

function zerarHoraRelatorioGerencialV30_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function lerBaseRelatorioGerencialConferentesV30_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('ACOMPANHAMENTO');
  if (!sheet) throw new Error('Aba ACOMPANHAMENTO não encontrada.');
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0].map(function(h){ return h.toString().trim(); });
  var colEscola = acharColuna_(headers, ['ESCOLA_NOME', 'ESCOLA NOME', 'ESCOLA', 'UNIDADE ESCOLAR', 'INSTITUIÇÃO']);
  var colMes = acharColuna_(headers, ['MES', 'MÊS', 'MÊS REFERÊNCIA']);
  var colAno = acharColuna_(headers, ['ANO', 'ANO REFERÊNCIA']);
  var colStatus = acharColuna_(headers, ['STATUS', 'SITUAÇÃO']);
  var colConf = acharColuna_(headers, ['CONFERENTE_EMAIL', 'CONFERENTE EMAIL', 'EMAIL_CONFERENTE', 'EMAIL DO CONFERENTE', 'CONFERENTE']);
  var colPrazo = acharColuna_(headers, ['PRAZO_ATE', 'PRAZO ATÉ', 'PRAZO']);
  var colRecebido = acharColuna_(headers, ['RECEBIDO_EM', 'RECEBIDO EM']);
  var colDevolvido = acharColuna_(headers, ['DEVOLVIDO_EM', 'DEVOLVIDO EM']);
  var colFinalizado = acharColuna_(headers, ['FINALIZADO_EM', 'FINALIZADO EM']);
  var colCobranca = acharColuna_(headers, ['COBRANCA_ENVIADA_EM', 'COBRANÇA ENVIADA EM', 'ULTIMA_COBRANCA_EM', 'ÚLTIMA COBRANÇA EM', 'COBRANCA EM']);

  if (colEscola === -1) throw new Error('Não encontrei a coluna de escola/unidade na aba ACOMPANHAMENTO.');

  var hoje = new Date();
  var registros = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var escola = row[colEscola] ? String(row[colEscola]).trim() : '';
    if (!escola) continue;

    var mesAno = mesAnoRelatorioGerencialV30_(row, colMes, colAno);
    var conf = colConf > -1 ? normalizarEmail_(row[colConf] || '-') : '-';
    if (!conf) conf = '-';
    var st = colStatus > -1 ? String(row[colStatus] || '').toUpperCase().replace(/\s+/g, '_') : '';
    if (!st) st = 'PENDENTE_RECEBIMENTO';
    var situacao = classificarSituacaoGerencialV30_(st);
    var candidatos = [colFinalizado, colDevolvido, colRecebido, colCobranca, colPrazo];
    var dataUltima = null;
    for (var c = 0; c < candidatos.length; c++) {
      var idx = candidatos[c];
      if (idx > -1) {
        dataUltima = parseDataRelatorioGerencialV30_(row[idx]);
        if (dataUltima) break;
      }
    }
    var finalizado = st === 'FINALIZADO';
    var diasParado = (!finalizado && dataUltima) ? Math.max(0, Math.floor((zerarHoraRelatorioGerencialV30_(hoje) - zerarHoraRelatorioGerencialV30_(dataUltima)) / 86400000)) : 0;

    registros.push({
      conferente: conf,
      mesAno: mesAno,
      escola: escola,
      situacaoCodigo: situacao.codigo,
      situacaoTexto: situacao.texto,
      statusOriginal: st.replace(/_/g, ' '),
      diasParado: diasParado,
      dataUltima: dataUltima,
      prazo: colPrazo > -1 ? row[colPrazo] : '',
      recebidoEm: colRecebido > -1 ? row[colRecebido] : '',
      devolvidoEm: colDevolvido > -1 ? row[colDevolvido] : '',
      finalizadoEm: colFinalizado > -1 ? row[colFinalizado] : '',
      cobrancaEm: colCobranca > -1 ? row[colCobranca] : '',
      linha: i + 1
    });
  }
  return registros;
}

function passaFiltrosRelatorioGerencialV30_(r, filtros) {
  filtros = filtros || {};
  var filtroConf = filtros.conferente && filtros.conferente !== 'ALL' ? normalizarEmail_(filtros.conferente) : 'ALL';
  var filtroMes = filtros.mesAno && filtros.mesAno !== 'ALL' ? String(filtros.mesAno).trim() : 'ALL';
  var filtroSituacao = filtros.situacao && filtros.situacao !== 'ALL' ? String(filtros.situacao).toUpperCase().trim() : 'ALL';
  var filtroEscola = filtros.escola ? normalizarTextoSistema_(filtros.escola) : '';

  if (filtroConf !== 'ALL' && r.conferente !== filtroConf) return false;
  if (filtroMes !== 'ALL' && r.mesAno !== filtroMes) return false;
  if (filtroEscola && normalizarTextoSistema_(r.escola).indexOf(filtroEscola) === -1) return false;
  if (filtroSituacao !== 'ALL') {
    if (filtroSituacao === 'NAO_FINALIZADO') {
      if (r.situacaoCodigo === 'CONFERIDO') return false;
    } else if (r.situacaoCodigo !== filtroSituacao) return false;
  }
  return true;
}

function contarSituacoesRelatorioGerencialV30_(registros) {
  var cont = { PENDENTE_ENTREGA: 0, PENDENTE_CONFERENCIA: 0, PENDENTE_RETORNO: 0, CONFERIDO: 0 };
  (registros || []).forEach(function(r){ cont[r.situacaoCodigo] = (cont[r.situacaoCodigo] || 0) + 1; });
  return cont;
}


function montarPreviewRelatorioGerencialV31_(registros, limite) {
  limite = limite || 200;
  return (registros || []).slice(0, limite).map(function(r){
    return {
      conferente: r.conferente || '-',
      mesAno: r.mesAno || '',
      escola: r.escola || '',
      situacao: r.situacaoTexto || '',
      status: r.statusOriginal || '',
      diasParado: Number(r.diasParado || 0),
      ultimaMovimentacao: r.dataUltima ? formatarDataHoraSistema_(r.dataUltima) : '',
      prazo: formatarDataHoraSistema_(r.prazo),
      linha: r.linha || ''
    };
  });
}

function getMetadadosRelatorioGerencialConferentesWeb(filtros) {
  validarPermissaoRelatorioGerencialV30_();
  filtros = filtros || {};
  var todos = lerBaseRelatorioGerencialConferentesV30_();
  var filtrados = todos.filter(function(r){ return passaFiltrosRelatorioGerencialV30_(r, filtros); });

  var mapaConf = {}, mapaMes = {};
  todos.forEach(function(r){
    if (r.conferente && r.conferente !== '-') mapaConf[r.conferente] = true;
    if (r.mesAno && r.mesAno !== 'Sem mês') mapaMes[r.mesAno] = true;
  });
  var conferentes = Object.keys(mapaConf).sort().map(function(c){ return { valor: c, texto: c }; });
  var meses = Object.keys(mapaMes).sort(function(a,b){ return chaveMesRelatorioGerencialV30_(a).localeCompare(chaveMesRelatorioGerencialV30_(b)); }).map(function(m){ return { valor: m, texto: m }; });

  return {
    conferentes: conferentes,
    meses: meses,
    contadores: contarSituacoesRelatorioGerencialV30_(filtrados),
    total: filtrados.length,
    preview: montarPreviewRelatorioGerencialV31_(filtrados, 200),
    previewLimite: 200
  };
}

function getPreviewRelatorioGerencialConferentesWeb(filtros) {
  validarPermissaoRelatorioGerencialV30_();
  filtros = filtros || {};
  var filtrados = lerBaseRelatorioGerencialConferentesV30_().filter(function(r){ return passaFiltrosRelatorioGerencialV30_(r, filtros); });
  return {
    contadores: contarSituacoesRelatorioGerencialV30_(filtrados),
    total: filtrados.length,
    preview: montarPreviewRelatorioGerencialV31_(filtrados, 200),
    previewLimite: 200
  };
}

function criarAggRelatorioGerencialV30_(conf, mesAno) {
  return {
    'Conferente': conf || '-',
    'Mês/Ano': mesAno || 'Sem mês',
    'Total atribuído': 0,
    'Conferências feitas': 0,
    'Conferências não finalizadas': 0,
    'Pendente de entrega pela entidade': 0,
    'Pendente de conferência pelo conferente': 0,
    'Pendente de retorno pela entidade': 0,
    'Finalizado': 0,
    'Maior tempo parado (dias)': 0,
    'Média tempo parado (dias)': 0,
    '_somaDias': 0,
    '_qtdDias': 0
  };
}

function getRelatorioGerencialConferentesWeb(filtros) {
  var email = validarPermissaoRelatorioGerencialV30_();
  filtros = filtros || {};
  var registros = lerBaseRelatorioGerencialConferentesV30_().filter(function(r){ return passaFiltrosRelatorioGerencialV30_(r, filtros); });
  var mapaConf = {}, mapaConfMes = {}, detalhe = [];

  registros.forEach(function(r){
    var finalizado = r.situacaoCodigo === 'CONFERIDO';
    detalhe.push({
      'Conferente': r.conferente || '-',
      'Mês/Ano': r.mesAno,
      'Escola': r.escola,
      'Situação gerencial': r.situacaoTexto,
      'Status original': r.statusOriginal,
      'Dias parado': r.diasParado,
      'Última movimentação usada': r.dataUltima ? formatarDataHoraSistema_(r.dataUltima) : '',
      'Prazo': formatarDataHoraSistema_(r.prazo),
      'Recebido em': formatarDataHoraSistema_(r.recebidoEm),
      'Devolvido em': formatarDataHoraSistema_(r.devolvidoEm),
      'Finalizado em': formatarDataHoraSistema_(r.finalizadoEm),
      'Cobrança enviada em': formatarDataHoraSistema_(r.cobrancaEm),
      'Linha ACOMPANHAMENTO': r.linha
    });

    var kConf = r.conferente || '-';
    var kConfMes = kConf + '||' + r.mesAno;
    if (!mapaConf[kConf]) mapaConf[kConf] = criarAggRelatorioGerencialV30_(kConf, 'Todos');
    if (!mapaConfMes[kConfMes]) mapaConfMes[kConfMes] = criarAggRelatorioGerencialV30_(kConf, r.mesAno);

    [mapaConf[kConf], mapaConfMes[kConfMes]].forEach(function(agg){
      agg['Total atribuído']++;
      if (finalizado) agg['Conferências feitas']++;
      else agg['Conferências não finalizadas']++;
      if (r.situacaoCodigo === 'PENDENTE_ENTREGA') agg['Pendente de entrega pela entidade']++;
      else if (r.situacaoCodigo === 'PENDENTE_CONFERENCIA') agg['Pendente de conferência pelo conferente']++;
      else if (r.situacaoCodigo === 'PENDENTE_RETORNO') agg['Pendente de retorno pela entidade']++;
      else if (r.situacaoCodigo === 'CONFERIDO') agg['Finalizado']++;
      if (!finalizado) {
        agg['Maior tempo parado (dias)'] = Math.max(agg['Maior tempo parado (dias)'], Number(r.diasParado) || 0);
        agg._somaDias += Number(r.diasParado) || 0;
        agg._qtdDias++;
      }
    });
  });

  function finalizarAgg(mapa) {
    return Object.keys(mapa).map(function(k){
      var a = mapa[k];
      a['Média tempo parado (dias)'] = a._qtdDias ? Math.round((a._somaDias / a._qtdDias) * 10) / 10 : 0;
      delete a._somaDias;
      delete a._qtdDias;
      return a;
    }).sort(function(a,b){
      var c = String(a['Conferente']).localeCompare(String(b['Conferente']), 'pt-BR');
      if (c !== 0) return c;
      return chaveMesRelatorioGerencialV30_(a['Mês/Ano']).localeCompare(chaveMesRelatorioGerencialV30_(b['Mês/Ano']));
    });
  }

  detalhe.sort(function(a,b){
    var c = String(a['Conferente']).localeCompare(String(b['Conferente']), 'pt-BR');
    if (c !== 0) return c;
    var m = chaveMesRelatorioGerencialV30_(a['Mês/Ano']).localeCompare(chaveMesRelatorioGerencialV30_(b['Mês/Ano']));
    if (m !== 0) return m;
    return (Number(b['Dias parado']) || 0) - (Number(a['Dias parado']) || 0);
  });

  registrarLog(email, 'GEROU_RELATORIO_GERENCIAL_CONFERENTES', 'Sistema Web', '-', 'Gerou relatório gerencial dinâmico com ' + detalhe.length + ' linha(s). Filtros: ' + JSON.stringify(filtros));

  return {
    geradoEm: formatarDataHoraSistema_(new Date()),
    filtros: filtros,
    resumoConferente: finalizarAgg(mapaConf),
    resumoConferenteMes: finalizarAgg(mapaConfMes),
    detalhe: detalhe
  };
}
