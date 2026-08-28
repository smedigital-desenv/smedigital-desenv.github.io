/* ============================================================================
   admin.js — Painel de Administração de acessos (CENTRAL da rede SME).
   Visível SOMENTE para super administradores.

   Usa window.AcessoSME (acesso-sme.js) para autenticar e window.ACESSO_SB
   (cliente Supabase autenticado) para ler/gravar as tabelas sob RLS.
   ============================================================================ */
(function () {
  var SB;            // cliente Supabase autenticado
  var EU;            // perfil do super admin logado
  var cachePerfis = [];
  var cacheSistemas = [];

  // ---- util ----------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Papéis: ordem fixa, cor e rótulo curto (fallback p/ papéis de outros sistemas).
  var PAPEL_ORDEM = { admin_gom: 1, admin: 1, secretaria: 2, empresa: 3, escola: 4, leitor: 5, visualizador: 6 };
  var PAPEL_COR   = { admin_gom: '#7c3aed', admin: '#7c3aed', secretaria: '#0369a1', empresa: '#b45309', escola: '#047857', leitor: '#0891b2', visualizador: '#0e7490' };
  var PAPEL_LABEL = { admin_gom: 'Admin', admin: 'Admin', secretaria: 'Secretaria', empresa: 'Empresa', escola: 'Escola', leitor: 'Leitor', visualizador: 'Visualizador' };
  // Papéis inerentemente só-leitura: editar/exportar ficam bloqueados na UI.
  var PAPEIS_SO_LEITURA = { visualizador: true, leitor: true };
  function ordemPapel(slug) { return PAPEL_ORDEM[slug] != null ? PAPEL_ORDEM[slug] : 99; }
  function corPapel(slug) { return PAPEL_COR[slug] || '#475569'; }
  function labelPapel(pp) { return PAPEL_LABEL[pp.slug] || pp.nome || pp.slug; }

  var toastT;
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast-box show' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast-box'; }, 2600);
  }
  function erro(e) { console.error(e); toast((e && e.message) || 'Erro inesperado', true); }

  // ---- boot ----------------------------------------------------------------
  document.addEventListener('acesso-pronto', async function (ev) {
    var api = ev.detail;
    SB = window.ACESSO_SB;
    EU = api.perfil;

    // GATE: só super admin entra no painel.
    if (!EU || !EU.is_super_admin) {
      document.documentElement.innerHTML =
        '<body style="font-family:Inter,sans-serif;background:#f0f4f8;min-height:100vh;display:grid;place-items:center;margin:0;padding:1rem">' +
        '<div style="background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.12);max-width:440px;padding:2.2rem;text-align:center">' +
        '<div style="font-size:2.4rem;color:#b45309"><i class="bi bi-shield-lock"></i></div>' +
        '<h4 style="font-weight:900;color:#002b5e;margin:.6rem 0">Área restrita</h4>' +
        '<p style="color:#475569;font-size:.9rem">Este painel é exclusivo para administradores da rede.</p>' +
        '<a href="../index.html" class="btn btn-primary btn-sm">Voltar ao portal</a></div></body>';
      return;
    }

    $('me-nome').textContent = EU.nome || 'Administrador';
    $('me-email').textContent = EU.email || '';
    $('boot').classList.add('hidden');
    $('app').classList.remove('hidden');

    bindNav();
    await Promise.all([carregarPerfis(), carregarSistemas(), carregarAcessos()]);
    initAcessos();
    initUsuarios();
    initEscolas();
    initCatalogo();
    initLanding();
    initSimular();
    initUso();
    initHistorico();
  });

  // ---- navegação entre seções ---------------------------------------------
  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        document.querySelectorAll('.nav-item').forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        var sec = item.getAttribute('data-sec');
        if (sec === 'historico') carregarHistorico();
        if (sec === 'uso') carregarUso();
        ['acessos', 'usuarios', 'escolas', 'catalogo', 'landing', 'simular', 'uso', 'historico'].forEach(function (s) {
          $('sec-' + s).classList.toggle('hidden', s !== sec);
        });
      });
    });
  }

  // ---- dados base ----------------------------------------------------------
  async function carregarPerfis() {
    // Tenta com is_viewer; se a coluna ainda não existe (SQL não rodado), usa o
    // conjunto antigo — o painel continua funcionando.
    var r = await SB.from('perfis').select('id,email,nome,tipo,is_super_admin,is_viewer,ativo').order('nome');
    if (r.error) r = await SB.from('perfis').select('id,email,nome,tipo,is_super_admin,ativo').order('nome');
    if (r.error) return erro(r.error);
    cachePerfis = r.data || [];
  }
  async function carregarSistemas() {
    var r = await SB.from('sistemas').select('id,slug,nome,url,icone,cor,ordem,ativo').order('ordem');
    if (r.error) return erro(r.error);
    cacheSistemas = r.data || [];
  }

  // Mapa perfil_id -> Set(sistema_id) a partir de perfil_papeis (papel por
  // sistema) e perfil_tela (liberação direta). Usado para filtrar/mostrar quem
  // acessa cada sistema. Super admin acessa todos (tratado à parte).
  var cacheAcessoPerfil = {};
  async function carregarAcessos() {
    cacheAcessoPerfil = {};
    function add(pid, sid) {
      if (pid == null || sid == null) return;
      (cacheAcessoPerfil[pid] = cacheAcessoPerfil[pid] || new Set()).add(Number(sid));
    }
    var rp = await SB.from('perfil_papeis').select('perfil_id, papeis(sistema_id)');
    if (rp.error) { console.warn('[admin] perfil_papeis:', rp.error.message); }
    else (rp.data || []).forEach(function (x) { add(x.perfil_id, x.papeis && x.papeis.sistema_id); });

    var rt = await SB.from('perfil_tela').select('perfil_id, telas(sistema_id)');
    if (rt.error) { console.warn('[admin] perfil_tela:', rt.error.message); }
    else (rt.data || []).forEach(function (x) { add(x.perfil_id, x.telas && x.telas.sistema_id); });
  }

  // Regra única de "esta pessoa alcança este sistema?" — a aba Usuários e o
  // relatório de uso leem daqui. Duplicá-la faria as duas telas discordarem
  // sobre quem deveria estar acessando, que é justamente a conta do relatório.
  function perfilAlcancaSistema(p, sisId) {
    if (p.is_super_admin) return true;                    // super admin acessa todos
    var set = cacheAcessoPerfil[p.id];
    return !!(set && set.has(Number(sisId)));
  }

  function sistemasDoPerfil(p) {
    if (p.is_super_admin) return cacheSistemas.slice();
    var set = cacheAcessoPerfil[p.id];
    if (!set) return [];
    return cacheSistemas.filter(function (s) { return set.has(Number(s.id)); });
  }
  function badgesSistemas(p) {
    if (p.is_super_admin) return '<span class="pill super">todos</span>';
    var sis = sistemasDoPerfil(p);
    if (!sis.length) return '<span class="muted">—</span>';
    return sis.map(function (s) { return '<span class="pill tipo">' + esc(s.slug) + '</span>'; }).join(' ');
  }
  function optsPerfis(sel, includeBlank) {
    sel.innerHTML = (includeBlank ? '<option value="">— selecione —</option>' : '');
    cachePerfis.forEach(function (p) {
      var o = el('option', { value: p.id }, esc(p.nome || p.email) + ' · ' + esc(p.email));
      sel.appendChild(o);
    });
  }
  function optsSistemas(sel) {
    sel.innerHTML = '';
    cacheSistemas.forEach(function (s) {
      sel.appendChild(el('option', { value: s.id }, esc(s.nome) + ' (' + esc(s.slug) + ')'));
    });
  }

  /* ==========================================================================
     SEÇÃO 1 — ACESSOS POR TELA (perfil_tela)
     ========================================================================== */
  function initAcessos() {
    optsSistemas($('ac-sistema'));
    optsPerfis($('ac-perfil'), true);     // <select> oculto = fonte do id selecionado
    initPerfilCombo();
    $('ac-sistema').addEventListener('change', function () {
      if (window.__acComboRefresh) window.__acComboRefresh();
      renderMatriz();
    });
    $('ac-reload').addEventListener('click', renderMatriz);
    $('ac-salvar').addEventListener('click', salvarAcessos);
    renderMatriz();
  }

  // Campo de busca (type-to-search) do usuário — substitui o <select> gigante.
  function initPerfilCombo() {
    var inp = $('ac-perfil-busca');
    var list = $('ac-perfil-list');
    var soChk = $('ac-perfil-so-sistema');
    if (!inp || !list) return;
    var atuais = [];

    function baseFiltrada() {
      var soSis = soChk && soChk.checked;
      var sisId = $('ac-sistema').value;
      return cachePerfis.filter(function (p) {
        if (soSis && sisId) {
          if (p.is_super_admin) return true;
          var set = cacheAcessoPerfil[p.id];
          if (!set || !set.has(Number(sisId))) return false;
        }
        return true;
      });
    }
    function fechar() { list.style.display = 'none'; inp.setAttribute('aria-expanded', 'false'); }
    function selecionar(p) {
      $('ac-perfil').value = p ? p.id : '';
      inp.value = p ? (p.nome || p.email) : '';
      fechar();
      renderMatriz();
    }
    function render() {
      var q = (inp.value || '').toLowerCase().trim();
      var base = baseFiltrada().filter(function (p) {
        return !q || (p.nome || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
      });
      atuais = base.slice(0, 50);
      list.innerHTML = '';
      if (!atuais.length) {
        list.appendChild(el('div', { class: 'combo-item muted' }, 'Nenhum usuário encontrado.'));
      } else {
        atuais.forEach(function (p) {
          var it = el('div', { class: 'combo-item' }, '<b>' + esc(p.nome || p.email) + '</b><small>' + esc(p.email) + '</small>');
          it.addEventListener('mousedown', function (e) { e.preventDefault(); selecionar(p); });
          list.appendChild(it);
        });
        if (base.length > atuais.length) {
          list.appendChild(el('div', { class: 'combo-item muted' }, 'Mostrando 50 de ' + base.length + '. Refine a busca…'));
        }
      }
      list.style.display = 'block';
      inp.setAttribute('aria-expanded', 'true');
    }

    inp.addEventListener('input', function () { $('ac-perfil').value = ''; render(); });
    inp.addEventListener('focus', render);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') fechar();
      else if (e.key === 'Enter') { e.preventDefault(); if (atuais.length) selecionar(atuais[0]); }
    });
    document.addEventListener('click', function (e) {
      if (e.target !== inp && !list.contains(e.target)) fechar();
    });
    if (soChk) soChk.addEventListener('change', function () { if (list.style.display === 'block') render(); });

    window.__acComboRefresh = function () { if (list.style.display === 'block') render(); };
  }

  async function renderMatriz() {
    var sistemaId = $('ac-sistema').value;
    var perfilId = $('ac-perfil').value;
    var box = $('ac-tabela');
    $('ac-salvar').disabled = true;
    $('ac-ctx').textContent = '';

    if (!perfilId) { box.innerHTML = '<div class="empty">Selecione um usuário para liberar telas.</div>'; return; }
    box.innerHTML = '<div class="loading">Carregando telas…</div>';

    var perfil = cachePerfis.find(function (p) { return String(p.id) === String(perfilId); });
    var sistema = cacheSistemas.find(function (s) { return String(s.id) === String(sistemaId); });
    $('ac-ctx').textContent = perfil ? ('— ' + (perfil.nome || perfil.email) + ' em ' + sistema.nome) : '';

    var rt = await SB.from('telas').select('id,slug,nome,ordem').eq('sistema_id', sistemaId).order('ordem');
    if (rt.error) return erro(rt.error);
    var telas = rt.data || [];

    if (perfil && perfil.is_super_admin) {
      box.innerHTML = '<div class="empty"><i class="bi bi-stars"></i> Este usuário é <b>super admin</b>: já tem acesso a tudo, não precisa liberar tela a tela.</div>';
      return;
    }
    if (perfil && perfil.is_viewer) {
      box.innerHTML = '<div class="empty"><i class="bi bi-eye"></i> Este usuário é <b>visualizador</b>: vê todas as telas (somente leitura), não precisa liberar tela a tela.</div>';
      return;
    }
    if (!telas.length) {
      box.innerHTML = '<div class="empty">Este sistema ainda não tem telas. Cadastre no <b>Catálogo</b>.</div>';
      return;
    }

    var rp = await SB.from('perfil_tela').select('tela_id,pode_ver,pode_editar,pode_exportar').eq('perfil_id', perfilId);
    if (rp.error) return erro(rp.error);
    var atual = {};
    (rp.data || []).forEach(function (x) { atual[x.tela_id] = x; });

    // Papéis do sistema + o que cada papel libera — para as badges por tela e
    // os atalhos "Liberar como papel" (Secretaria / Empresa / Escola / Admin).
    var permsByPapel = {}, telaBadges = {}, papeis = [];
    var rpa = await SB.from('papeis').select('id,slug,nome').eq('sistema_id', sistemaId).order('id');
    if (!rpa.error) papeis = (rpa.data || []).sort(function (a, b) {
      return (ordemPapel(a.slug) - ordemPapel(b.slug)) || String(a.nome || '').localeCompare(String(b.nome || ''));
    });
    if (papeis.length) {
      var papelById = {}; papeis.forEach(function (p) { papelById[p.id] = p; });
      var rpp = await SB.from('papel_permissoes').select('papel_id,tela_id,pode_ver,pode_editar,pode_exportar')
        .in('papel_id', papeis.map(function (p) { return p.id; }));
      if (!rpp.error) (rpp.data || []).forEach(function (x) {
        (permsByPapel[x.papel_id] = permsByPapel[x.papel_id] || {})[x.tela_id] = x;
        if (x.pode_ver) (telaBadges[x.tela_id] = telaBadges[x.tela_id] || []).push(papelById[x.papel_id]);
      });
    }

    // Papel deste usuário NESTE sistema (perfil_papeis). É ele que define as
    // telas padrão — e é ele que CONTINUA valendo quando uma tela nova entra no
    // papel depois. Por isso a matriz abaixo não copia o papel para
    // perfil_tela: copiar congelaria o estado de hoje, e a pessoa deixaria de
    // receber o que o papel ganhasse amanhã.
    var papelAtual = '';
    if (papeis.length) {
      var rap = await SB.from('perfil_papeis').select('papel_id').eq('perfil_id', perfilId)
        .in('papel_id', papeis.map(function (p) { return p.id; }));
      if (!rap.error && rap.data && rap.data.length) papelAtual = rap.data[0].papel_id;
    }
    var heranca = permsByPapel[papelAtual] || {};
    var papelObj = papeis.filter(function (p) { return String(p.id) === String(papelAtual); })[0];

    // Papel escolhido mas nenhuma tela marcada nele: a matriz sairia toda em
    // branco e pareceria falta de permissão da pessoa, que é o defeito que
    // esta tela existe para não ter. Quem precisa de conserto é o PAPEL.
    if (papelObj && !Object.keys(heranca).length) {
      console.warn('[admin] o papel', papelObj.slug, 'não tem tela marcada neste sistema —',
        'Catálogo › Papéis é onde se corrige.');
    }

    var papelBox = el('div', { class: 'mb-3', style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:.7rem .9rem' });
    if (papeis.length) {
      papelBox.appendChild(el('div', { class: 'muted', style: 'font-size:.85rem;margin-bottom:.4rem' },
        '<i class="bi bi-person-badge"></i> Papel deste usuário no sistema (define o perfil e as telas padrão):'));
      var selP = el('select', { class: 'form-select form-select-sm', style: 'max-width:300px' });
      selP.appendChild(el('option', { value: '' }, '— nenhum —'));
      papeis.forEach(function (pa) { selP.appendChild(el('option', { value: pa.id }, esc(pa.nome))); });
      selP.value = papelAtual ? String(papelAtual) : '';
      selP.addEventListener('change', function () { salvarPapelSistema(perfilId, papeis, selP.value); });
      papelBox.appendChild(selP);
    }

    // Explica de onde vem o acesso — sem isto a matriz parece vazia para quem
    // recebe tudo pelo papel, que foi exatamente o que confundiu na rede.
    var aviso = el('div', { class: 'mb-3', style: 'border-radius:10px;padding:.6rem .8rem;font-size:.85rem;' +
      (papelObj ? 'background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a'
                : 'background:#fffbeb;border:1px solid #fcd34d;color:#92400e') },
      papelObj
        ? '<i class="bi bi-info-circle"></i> As marcações <b>cinzas</b> vêm do papel <b>' + esc(papelObj.nome) +
          '</b> e se ajustam sozinhas: se uma tela nova entrar nesse papel, esta pessoa passa a vê-la sem ninguém mexer aqui. ' +
          'Crie <b>exceção</b> só para abrir ou fechar uma tela desta pessoa em particular — a exceção vence o papel, inclusive para negar.'
        : '<i class="bi bi-exclamation-triangle"></i> Esta pessoa <b>não tem papel neste sistema</b>, então não herda tela nenhuma. ' +
          'Escolha um papel acima: é o caminho que se ajusta sozinho. Exceção individual serve para caso isolado, não para dar acesso padrão.');

    // Um botão só, para o usuário inteiro. Antes havia um por linha, e a coluna
    // extra empurrava a tabela para o lado — ficava mais difícil ler QUAIS
    // telas a pessoa tem, que é a pergunta que se faz aqui o tempo todo.
    var toolbar = el('div', { class: 'mb-3 d-flex flex-wrap align-items-center gap-2' });
    var btModo = el('button', { class: 'btn btn-sm', type: 'button', id: 'ac-modo' });
    btModo.addEventListener('click', function () {
      alternarModoExcecao(!acExcecao);
    });
    toolbar.appendChild(btModo);
    toolbar.appendChild(el('span', { class: 'muted', id: 'ac-modo-txt', style: 'font-size:.85rem' }));

    var tbl = el('table');
    tbl.innerHTML =
      '<thead><tr><th>Tela</th><th class="chk-col">Ver</th><th class="chk-col">Editar</th>' +
      '<th class="chk-col">Exportar</th></tr></thead>';
    var tb = el('tbody');
    telas.forEach(function (t) {
      var a = atual[t.id] || null;
      var her = heranca[t.id] || null;
      var tr = el('tr');
      tr.dataset.modo = a ? 'excecao' : 'heranca';
      tr.dataset.her = JSON.stringify(her
        ? { v: !!her.pode_ver, e: !!her.pode_editar, x: !!her.pode_exportar }
        : { v: false, e: false, x: false });

      var badges = (telaBadges[t.id] || []).slice()
        .sort(function (a, b) { return ordemPapel(a.slug) - ordemPapel(b.slug); })
        .map(function (pp) { var c = corPapel(pp.slug); return '<span class="pill" style="background:' + c + '1a;color:' + c + ';border:1px solid ' + c + '55;font-weight:700">' + esc(labelPapel(pp)) + '</span>'; }).join(' ');
      tr.appendChild(el('td', null, '<b>' + esc(t.nome) + '</b><br><span class="muted">' + esc(t.slug) + '</span>'
        + (badges ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">' + badges + '</div>' : '')));

      ['ver', 'editar', 'exportar'].forEach(function (acao) {
        var td = el('td', { class: 'chk-col' });
        var chk = el('input', { type: 'checkbox', class: 'form-check-input', 'data-tela': t.id, 'data-acao': acao });
        if (a && a['pode_' + acao]) chk.checked = true;
        chk.addEventListener('change', function () { onChkChange(tr); });
        td.appendChild(chk); tr.appendChild(td);
      });

      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = '';
    if (papeis.length) box.appendChild(papelBox);
    box.appendChild(aviso);
    box.appendChild(toolbar);
    box.appendChild(tbl);

    // Já existe exceção gravada? Então o usuário está em modo exceção.
    alternarModoExcecao(Object.keys(atual).length > 0);
    $('ac-salvar').disabled = false;
  }

  // Troca o papel do usuário NESTE sistema: remove os papéis atuais dele nas
  // roles deste sistema e grava o novo (perfil_papeis). Sem escola (escola_id null).
  async function salvarPapelSistema(perfilId, papeisSistema, novoPapelId) {
    perfilId = Number(perfilId);
    var ids = papeisSistema.map(function (p) { return p.id; });
    try {
      var d = await SB.from('perfil_papeis').delete().eq('perfil_id', perfilId).in('papel_id', ids);
      if (d.error) throw d.error;
      if (novoPapelId) {
        var ins = await SB.from('perfil_papeis').insert({ perfil_id: perfilId, papel_id: Number(novoPapelId) });
        if (ins.error) throw ins.error;
      }
      await carregarAcessos();                 // atualiza filtro/coluna de sistemas
      if (typeof renderUsuarios === 'function') renderUsuarios();
      toast('Papel atualizado. (o usuário vê na próxima entrada)');
    } catch (e) { erro(e); }
  }

  // Painel de ACESSOS do usuário: papel por sistema, tudo numa tela só.
  // Reaproveita salvarPapelSistema() para gravar cada mudança.
  async function abrirAcessosUsuario(p) {
    $('acu-nome').textContent = p.nome || p.email;
    var body = $('acu-body');
    body.innerHTML = '<div class="loading">Carregando…</div>';
    bootstrap.Modal.getOrCreateInstance($('modalAcessosUsuario')).show();

    // Papéis de TODOS os sistemas + os papéis atuais do usuário (2 consultas).
    var rpa = await SB.from('papeis').select('id,slug,nome,sistema_id').order('id');
    if (rpa.error) { body.innerHTML = ''; return erro(rpa.error); }
    var porSistema = {}, papelById = {};
    (rpa.data || []).forEach(function (pa) {
      (porSistema[pa.sistema_id] = porSistema[pa.sistema_id] || []).push(pa);
      papelById[pa.id] = pa;
    });
    var rpp = await SB.from('perfil_papeis').select('papel_id').eq('perfil_id', p.id);
    if (rpp.error) { body.innerHTML = ''; return erro(rpp.error); }
    var atualPorSistema = {};   // sistema_id -> papel_id atual do usuário
    (rpp.data || []).forEach(function (x) { var pa = papelById[x.papel_id]; if (pa) atualPorSistema[pa.sistema_id] = x.papel_id; });

    body.innerHTML = '';
    if (p.is_super_admin) body.appendChild(el('div', { class: 'mb-2', style: 'background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:.5rem .7rem;font-size:.85rem' },
      '<i class="bi bi-stars"></i> <b>Super admin</b>: já acessa todos os sistemas — os papéis abaixo são ignorados.'));
    else if (p.is_viewer) body.appendChild(el('div', { class: 'mb-2', style: 'background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:.5rem .7rem;font-size:.85rem' },
      '<i class="bi bi-eye"></i> <b>Visualizador</b>: vê tudo (só leitura) — os papéis abaixo são ignorados.'));

    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Sistema</th><th style="width:280px">Papel</th></tr></thead>';
    var tb = el('tbody');
    cacheSistemas.forEach(function (s) {
      var paps = (porSistema[s.id] || []).slice().sort(function (a, b) { return ordemPapel(a.slug) - ordemPapel(b.slug); });
      var tr = el('tr');
      tr.appendChild(el('td', null, '<i class="bi ' + esc(s.icone || 'bi-app') + '" style="color:' + esc(s.cor || '#64748b') + '"></i> <b>' + esc(s.nome) + '</b>'));
      var td = el('td');
      if (!paps.length) {
        td.innerHTML = '<span class="muted" style="font-size:.82rem">— sem papéis cadastrados (Catálogo → Papéis) —</span>';
      } else {
        var sel = el('select', { class: 'form-select form-select-sm' });
        sel.appendChild(el('option', { value: '' }, '— sem acesso —'));
        paps.forEach(function (pa) { sel.appendChild(el('option', { value: pa.id }, esc(pa.nome))); });
        sel.value = atualPorSistema[s.id] ? String(atualPorSistema[s.id]) : '';
        sel.addEventListener('change', function () {
          salvarPapelSistema(p.id, paps, sel.value);
          atualPorSistema[s.id] = sel.value ? Number(sel.value) : undefined;
        });
        td.appendChild(sel);
      }
      tr.appendChild(td); tb.appendChild(tr);
    });
    tbl.appendChild(tb); body.appendChild(tbl);
  }

  /* Cada linha da matriz vive em um de dois modos:

       heranca  — não existe linha em `perfil_tela`. Vale o papel, e vai
                  continuar valendo: tela nova no papel chega sozinha.
       excecao  — existe linha em `perfil_tela`. Ela DECIDE — concede ou nega —
                  e para de acompanhar o papel.

     Copiar o papel para exceções seria o jeito fácil de "marcar tudo", e é
     justamente o que quebra o ajuste automático. Por isso não existe mais o
     atalho que fazia isso. */
  var acExcecao = false;   // modo do usuário inteiro, não de uma linha

  function pintarLinha(tr) {
    var herdando = tr.dataset.modo !== 'excecao';
    var her = { v: false, e: false, x: false };
    try { her = JSON.parse(tr.dataset.her || 'null') || her; } catch (e) { /* mantém o padrão */ }

    var ver = tr.querySelector('[data-acao="ver"]');
    // Ao voltar a seguir o papel, os checkboxes mostram de novo o que o papel
    // dá — senão ficariam exibindo o rascunho da exceção que acabou de sair.
    if (herdando) {
      ver.checked = her.v;
      tr.querySelector('[data-acao="editar"]').checked = her.e;
      tr.querySelector('[data-acao="exportar"]').checked = her.x;
    }
    ver.disabled = herdando;
    tr.style.background = herdando ? '' : '#fffbeb';
    syncRow(tr);
  }

  // Alterna o usuário inteiro entre "segue o papel" e "exceção".
  function alternarModoExcecao(ligar) {
    acExcecao = !!ligar;
    document.querySelectorAll('#ac-tabela tbody tr').forEach(function (tr) {
      tr.dataset.modo = acExcecao ? 'excecao' : 'heranca';
      pintarLinha(tr);
    });
    var bt = $('ac-modo'), txt = $('ac-modo-txt');
    if (bt) {
      bt.className = 'btn btn-sm ' + (acExcecao ? 'btn-light' : 'btn-roxo');
      bt.innerHTML = acExcecao
        ? '<i class="bi bi-arrow-counterclockwise"></i> Voltar a seguir o papel'
        : '<i class="bi bi-pencil"></i> Ajustar só este usuário';
    }
    if (txt) {
      txt.innerHTML = acExcecao
        ? '<b style="color:#92400e">Este usuário deixa de acompanhar o papel.</b> ' +
          'Desmarque para negar uma tela; tela nova no papel não chega mais até ele.'
        : 'As marcações vêm do papel e se ajustam sozinhas quando ele muda.';
    }
    var salvar = $('ac-salvar');
    if (salvar) salvar.disabled = false;
  }

  // editar/exportar dependem de "ver"
  function onChkChange(tr) {
    var ver = tr.querySelector('[data-acao="ver"]');
    if (!ver.checked) {
      tr.querySelector('[data-acao="editar"]').checked = false;
      tr.querySelector('[data-acao="exportar"]').checked = false;
    }
    if (tr.dataset && tr.dataset.modo) pintarLinha(tr); else syncRow(tr);
  }
  function syncRow(tr) {
    var ed = tr.querySelector('[data-acao="editar"]');
    var ex = tr.querySelector('[data-acao="exportar"]');
    // Papel só-leitura: editar/exportar sempre desmarcados e desabilitados.
    if (tr.dataset && tr.dataset.soLeitura === '1') {
      ed.checked = false; ex.checked = false; ed.disabled = true; ex.disabled = true;
      return;
    }
    // Linha herdada: mostra o que o papel dá, mas ninguém edita aqui.
    if (tr.dataset && tr.dataset.modo === 'heranca') {
      ed.disabled = true; ex.disabled = true;
      return;
    }
    var ver = tr.querySelector('[data-acao="ver"]').checked;
    ed.disabled = !ver;
    ex.disabled = !ver;
  }

  async function salvarAcessos() {
    var perfilId = Number($('ac-perfil').value);
    if (!perfilId) return;
    var btn = $('ac-salvar'); btn.disabled = true;

    var upserts = [], deletes = [];
    document.querySelectorAll('#ac-tabela tbody tr').forEach(function (tr) {
      var ver = tr.querySelector('[data-acao="ver"]');
      if (!ver) return;
      var telaId = Number(ver.getAttribute('data-tela'));
      if (tr.dataset.modo === 'excecao') {
        // `pode_ver: false` é uma NEGAÇÃO explícita e precisa virar linha: sob a
        // cadeia de precedência ela vence o papel. Apagar aqui devolveria a
        // pessoa ao papel, que é o oposto do que se pediu.
        upserts.push({
          perfil_id: perfilId, tela_id: telaId,
          pode_ver: ver.checked,
          pode_editar: ver.checked && tr.querySelector('[data-acao="editar"]').checked,
          pode_exportar: ver.checked && tr.querySelector('[data-acao="exportar"]').checked
        });
      } else {
        deletes.push(telaId);   // sem exceção: volta a seguir o papel
      }
    });

    try {
      if (upserts.length) {
        var u = await SB.from('perfil_tela').upsert(upserts, { onConflict: 'perfil_id,tela_id' });
        if (u.error) throw u.error;
      }
      if (deletes.length) {
        var d = await SB.from('perfil_tela').delete().eq('perfil_id', perfilId).in('tela_id', deletes);
        if (d.error) throw d.error;
      }
      var n = upserts.length;
      toast(n ? (n === 1 ? '1 exceção gravada. O resto segue o papel.'
                         : n + ' exceções gravadas. O resto segue o papel.')
              : 'Sem exceções: tudo segue o papel.');
      renderMatriz();
    } catch (e) { erro(e); }
    btn.disabled = false;
  }

  /* ==========================================================================
     SEÇÃO 2 — USUÁRIOS (perfis)
     ========================================================================== */
  function initUsuarios() {
    var selSis = $('us-sistema');
    if (selSis) {
      cacheSistemas.forEach(function (s) {
        selSis.appendChild(el('option', { value: s.id }, esc(s.nome)));
      });
      selSis.addEventListener('change', renderUsuarios);
    }
    $('us-busca').addEventListener('input', renderUsuarios);
    $('nu-salvar').addEventListener('click', salvarUsuario);
    var bNovo = $('us-novo');
    if (bNovo) bNovo.addEventListener('click', function () { abrirModalUsuario(null); });
    renderUsuarios();
  }

  var editandoId = null;
  function abrirModalUsuario(p) {
    editandoId = p ? p.id : null;
    $('modalUserTitle').textContent = p ? 'Editar usuário' : 'Novo usuário';
    $('nu-email').value = p ? (p.email || '') : '';
    $('nu-nome').value = p ? (p.nome || '') : '';
    $('nu-tipo').value = p ? (p.tipo || 'escola') : 'escola';
    $('nu-super').checked = p ? !!p.is_super_admin : false;
    if ($('nu-viewer')) $('nu-viewer').checked = p ? !!p.is_viewer : false;
    bootstrap.Modal.getOrCreateInstance($('modalUser')).show();
  }

  function renderUsuarios() {
    var q = ($('us-busca').value || '').toLowerCase().trim();
    var sisId = ($('us-sistema') && $('us-sistema').value) || '';
    var lista = cachePerfis.filter(function (p) {
      if (q && !((p.nome || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))) return false;
      if (sisId && !perfilAlcancaSistema(p, sisId)) return false;
      return true;
    });
    var box = $('us-tabela');

    // Contexto do filtro (quantos e qual sistema)
    var ctx = $('us-ctx');
    if (ctx) {
      var sisNome = sisId ? (cacheSistemas.find(function (s) { return String(s.id) === String(sisId); }) || {}).nome : '';
      ctx.textContent = sisId
        ? (lista.length + ' usuário(s) com acesso a ' + (sisNome || ''))
        : (lista.length + ' usuário(s)');
    }

    if (!lista.length) { box.innerHTML = '<div class="empty">Nenhum usuário.</div>'; return; }

    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Nome / E-mail</th><th>Sistemas</th><th>Tipo</th><th>Status</th><th>Super / Visual.</th><th></th></tr></thead>';
    var tb = el('tbody');
    lista.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(el('td', null, '<b>' + esc(p.nome || '—') + '</b><br><span class="muted">' + esc(p.email) + '</span>'));
      tr.appendChild(el('td', null, badgesSistemas(p)));
      var tdTipo = el('td');
      var selT = el('select', { class: 'form-select form-select-sm', style: 'min-width:118px' });
      ['secretaria', 'escola', 'externo'].forEach(function (tp) { selT.appendChild(el('option', { value: tp }, tp)); });
      selT.value = p.tipo || 'escola';
      selT.addEventListener('change', function () { patchPerfil(p, { tipo: selT.value }); });
      tdTipo.appendChild(selT);
      tr.appendChild(tdTipo);
      tr.appendChild(el('td', null, p.ativo ? '<span class="pill on">ativo</span>' : '<span class="pill off">inativo</span>'));
      var flags = '';
      if (p.is_super_admin) flags += '<span class="pill super">super</span> ';
      if (p.is_viewer) flags += '<span class="pill" style="background:#0891b21a;color:#0891b2;border:1px solid #0891b255;font-weight:700">visualizador</span>';
      tr.appendChild(el('td', null, flags || '<span class="muted">—</span>'));

      var acts = el('td');
      var bAtivo = el('button', { class: 'btn btn-sm btn-light', title: p.ativo ? 'Desativar' : 'Ativar' },
        '<i class="bi ' + (p.ativo ? 'bi-toggle-on text-success' : 'bi-toggle-off text-muted') + '"></i>');
      bAtivo.addEventListener('click', function () { patchPerfil(p, { ativo: !p.ativo }); });
      var bSuper = el('button', { class: 'btn btn-sm btn-light ms-1', title: 'Alternar super admin' },
        '<i class="bi bi-shield' + (p.is_super_admin ? '-fill text-primary' : '') + '"></i>');
      bSuper.addEventListener('click', function () {
        if (p.email === EU.email && p.is_super_admin) { toast('Você não pode remover seu próprio super admin.', true); return; }
        patchPerfil(p, { is_super_admin: !p.is_super_admin });
      });
      var bAcessos = el('button', { class: 'btn btn-sm btn-light ms-1', title: 'Acessos aos sistemas' }, '<i class="bi bi-key"></i>');
      bAcessos.addEventListener('click', function () { abrirAcessosUsuario(p); });
      var bEdit = el('button', { class: 'btn btn-sm btn-light ms-1', title: 'Editar' }, '<i class="bi bi-pencil"></i>');
      bEdit.addEventListener('click', function () { abrirModalUsuario(p); });
      var bDel = el('button', { class: 'btn btn-sm btn-light ms-1', title: 'Excluir' }, '<i class="bi bi-trash text-danger"></i>');
      bDel.addEventListener('click', function () { excluirUsuario(p); });
      acts.appendChild(bAtivo); acts.appendChild(bSuper); acts.appendChild(bAcessos); acts.appendChild(bEdit); acts.appendChild(bDel);
      tr.appendChild(acts);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = ''; box.appendChild(tbl);
  }

  async function patchPerfil(p, patch) {
    var r = await SB.from('perfis').update(patch).eq('id', p.id);
    if (r.error) return erro(r.error);
    Object.assign(p, patch);
    renderUsuarios();
    toast('Usuário atualizado.');
  }

  var RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  async function salvarUsuario() {
    var email = ($('nu-email').value || '').trim().toLowerCase();

    // O preenchimento automático do navegador troca os dois campos quando
    // acha que sabe melhor. Em vez de só recusar, aponta o que houve e
    // desfaz a troca — sem salvar, para a pessoa conferir antes.
    if (!RE_EMAIL.test(email) && RE_EMAIL.test(($('nu-nome').value || '').trim())) {
      var trocado = $('nu-nome').value.trim();
      $('nu-nome').value = $('nu-email').value.trim();
      $('nu-email').value = trocado;
      $('nu-email').focus();
      toast('Os campos estavam trocados — desfiz. Confira e salve.', true);
      return;
    }
    if (!RE_EMAIL.test(email)) { toast('Informe um e-mail válido.', true); return; }
    var dados = {
      email: email,
      nome: ($('nu-nome').value || '').trim() || null,
      tipo: $('nu-tipo').value,
      is_super_admin: $('nu-super').checked
    };
    if ($('nu-viewer')) dados.is_viewer = $('nu-viewer').checked;
    try {
      if (editandoId) {
        var up = await SB.from('perfis').update(dados).eq('id', editandoId).select().single();
        if (up.error) throw up.error;
        var i = cachePerfis.findIndex(function (x) { return x.id === editandoId; });
        if (i >= 0) cachePerfis[i] = up.data;
      } else {
        dados.ativo = true;
        var ins = await SB.from('perfis').insert(dados).select().single();
        if (ins.error) throw ins.error;
        cachePerfis.push(ins.data);
      }
      cachePerfis.sort(function (a, b) { return (a.nome || a.email).localeCompare(b.nome || b.email); });
      renderUsuarios();
      optsPerfis($('ac-perfil'), true);
      optsPerfis($('vc-perfil'), true);
      bootstrap.Modal.getInstance($('modalUser')).hide();
      toast(editandoId ? 'Usuário atualizado.' : 'Usuário cadastrado.');
      editandoId = null;
    } catch (e) { erro(e); }
  }

  async function excluirUsuario(p) {
    if (p.email === EU.email) { toast('Você não pode excluir a si mesmo.', true); return; }
    if (!confirm('Excluir o usuário "' + (p.nome || p.email) + '"?\n\nRemove o acesso dele (papéis, telas e vínculos de escola). A conta Google/Auth não é afetada.')) return;
    var r = await SB.from('perfis').delete().eq('id', p.id);
    if (r.error) return erro(r.error);
    cachePerfis = cachePerfis.filter(function (x) { return x.id !== p.id; });
    delete cacheAcessoPerfil[p.id];
    renderUsuarios();
    optsPerfis($('ac-perfil'), true);
    optsPerfis($('vc-perfil'), true);
    toast('Usuário excluído.');
  }

  /* ==========================================================================
     SEÇÃO 3 — ESCOLAS + VÍNCULOS
     ========================================================================== */
  var cacheEscolas = [];
  function initEscolas() {
    optsPerfis($('vc-perfil'), true);
    $('ne-salvar').addEventListener('click', salvarNovaEscola);
    $('vc-perfil').addEventListener('change', renderVinculos);
    carregarEscolas();
  }

  async function carregarEscolas() {
    var r = await SB.from('escolas').select('id,codigo_inep,nome,email_institucional,ativo').order('nome');
    if (r.error) return erro(r.error);
    cacheEscolas = r.data || [];
    renderEscolas();
  }

  function renderEscolas() {
    var box = $('es-tabela');
    if (!cacheEscolas.length) { box.innerHTML = '<div class="empty">Nenhuma escola cadastrada.</div>'; return; }
    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Escola</th><th>INEP</th><th>Status</th></tr></thead>';
    var tb = el('tbody');
    cacheEscolas.forEach(function (e) {
      var tr = el('tr');
      tr.appendChild(el('td', null, '<b>' + esc(e.nome) + '</b>' + (e.email_institucional ? '<br><span class="muted">' + esc(e.email_institucional) + '</span>' : '')));
      tr.appendChild(el('td', null, esc(e.codigo_inep || '—')));
      tr.appendChild(el('td', null, e.ativo ? '<span class="pill on">ativa</span>' : '<span class="pill off">inativa</span>'));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = ''; box.appendChild(tbl);
  }

  async function salvarNovaEscola() {
    var nome = ($('ne-nome').value || '').trim();
    if (!nome) { toast('Informe o nome da escola.', true); return; }
    var nova = {
      nome: nome,
      codigo_inep: ($('ne-inep').value || '').trim() || null,
      email_institucional: ($('ne-email').value || '').trim() || null,
      ativo: true
    };
    var r = await SB.from('escolas').insert(nova).select().single();
    if (r.error) return erro(r.error);
    cacheEscolas.push(r.data);
    cacheEscolas.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    renderEscolas();
    if ($('vc-perfil').value) renderVinculos();
    $('ne-nome').value = ''; $('ne-inep').value = ''; $('ne-email').value = '';
    bootstrap.Modal.getInstance($('modalEscola')).hide();
    toast('Escola cadastrada.');
  }

  async function renderVinculos() {
    var perfilId = $('vc-perfil').value;
    var area = $('vc-area');
    if (!perfilId) { area.innerHTML = '<div class="empty">Selecione um usuário.</div>'; return; }
    area.innerHTML = '<div class="loading">Carregando…</div>';

    var r = await SB.from('perfil_escola').select('escola_id,vinculo').eq('perfil_id', perfilId);
    if (r.error) return erro(r.error);
    var vinc = {};
    (r.data || []).forEach(function (x) { vinc[x.escola_id] = x.vinculo || ''; });

    if (!cacheEscolas.length) { area.innerHTML = '<div class="empty">Cadastre escolas primeiro.</div>'; return; }
    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Escola</th><th>Vínculo</th><th class="chk-col">Vincular</th></tr></thead>';
    var tb = el('tbody');
    cacheEscolas.forEach(function (e) {
      var tem = Object.prototype.hasOwnProperty.call(vinc, e.id);
      var tr = el('tr');
      tr.appendChild(el('td', null, esc(e.nome)));
      var tdV = el('td');
      var inp = el('input', { class: 'form-control form-control-sm', placeholder: 'gestor, coordenador…' });
      inp.value = vinc[e.id] || '';
      inp.disabled = !tem;
      tdV.appendChild(inp); tr.appendChild(tdV);
      var tdC = el('td', { class: 'chk-col' });
      var chk = el('input', { type: 'checkbox', class: 'form-check-input' });
      chk.checked = tem;
      chk.addEventListener('change', function () { inp.disabled = !chk.checked; });
      tdC.appendChild(chk); tr.appendChild(tdC);
      tr._escola = e; tr._chk = chk; tr._inp = inp;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    area.innerHTML = '';
    area.appendChild(tbl);
    var btn = el('button', { class: 'btn btn-roxo mt-3' }, '<i class="bi bi-check-lg"></i> Salvar vínculos');
    btn.addEventListener('click', function () { salvarVinculos(perfilId, tb); });
    area.appendChild(btn);
  }

  async function salvarVinculos(perfilId, tbody) {
    perfilId = Number(perfilId);
    var upserts = [], deletes = [];
    tbody.querySelectorAll('tr').forEach(function (tr) {
      if (tr._chk.checked) upserts.push({ perfil_id: perfilId, escola_id: tr._escola.id, vinculo: tr._inp.value.trim() || null });
      else deletes.push(tr._escola.id);
    });
    try {
      if (upserts.length) {
        var u = await SB.from('perfil_escola').upsert(upserts, { onConflict: 'perfil_id,escola_id' });
        if (u.error) throw u.error;
      }
      if (deletes.length) {
        var d = await SB.from('perfil_escola').delete().eq('perfil_id', perfilId).in('escola_id', deletes);
        if (d.error) throw d.error;
      }
      toast('Vínculos salvos.');
    } catch (e) { erro(e); }
  }

  /* ==========================================================================
     SEÇÃO 4 — CATÁLOGO (sistemas + telas)
     ========================================================================== */
  var catSistemaId = null;
  function initCatalogo() {
    $('ns-salvar').addEventListener('click', salvarNovoSistema);
    $('t-add').addEventListener('click', adicionarTela);
    $('pa-add').addEventListener('click', adicionarPapel);
    renderCatSistemas();
    renderCatPapeis();
  }

  // ---- Catálogo: PAPÉIS do sistema (papeis + papel_permissoes) --------------
  async function renderCatPapeis() {
    var box = $('cat-papeis');
    $('cat-papel-ctx').textContent = '';
    $('cat-papel-telas').innerHTML = '';
    if (!catSistemaId) { box.innerHTML = '<div class="empty">Selecione um sistema.</div>'; return; }
    var sis = cacheSistemas.find(function (s) { return String(s.id) === String(catSistemaId); });
    $('cat-papel-ctx').textContent = sis ? ('— ' + sis.nome) : '';
    box.innerHTML = '<div class="loading">Carregando…</div>';
    var r = await SB.from('papeis').select('id,slug,nome').eq('sistema_id', catSistemaId).order('id');
    if (r.error) return erro(r.error);
    var papeis = (r.data || []).sort(function (a, b) {
      return (ordemPapel(a.slug) - ordemPapel(b.slug)) || String(a.nome || '').localeCompare(String(b.nome || ''));
    });
    if (!papeis.length) { box.innerHTML = '<div class="empty">Nenhum papel. Adicione acima (ex.: secretaria, empresa, escola).</div>'; return; }
    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Papel</th><th>Slug</th><th></th></tr></thead>';
    var tb = el('tbody');
    papeis.forEach(function (pa) {
      var c = corPapel(pa.slug);
      var tr = el('tr');
      tr.appendChild(el('td', null, '<span class="pill" style="background:' + c + '1a;color:' + c + ';border:1px solid ' + c + '55;font-weight:700">' + esc(pa.nome) + '</span>'));
      tr.appendChild(el('td', null, '<span class="muted">' + esc(pa.slug) + '</span>'));
      var td = el('td');
      var bEdit = el('button', { class: 'btn btn-sm btn-light', title: 'Editar telas do papel' }, '<i class="bi bi-toggles"></i> Telas');
      bEdit.addEventListener('click', function () { renderPapelTelas(pa); });
      var bDel = el('button', { class: 'btn btn-sm btn-light ms-1', title: 'Excluir papel' }, '<i class="bi bi-trash text-danger"></i>');
      bDel.addEventListener('click', function () { excluirPapel(pa); });
      td.appendChild(bEdit); td.appendChild(bDel); tr.appendChild(td);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = ''; box.appendChild(tbl);
  }

  async function adicionarPapel() {
    if (!catSistemaId) { toast('Selecione um sistema primeiro.', true); return; }
    var slug = ($('pa-slug').value || '').trim().toLowerCase();
    var nome = ($('pa-nome').value || '').trim();
    if (!slug || !nome) { toast('Informe slug e nome do papel.', true); return; }
    var r = await SB.from('papeis').insert({ sistema_id: catSistemaId, slug: slug, nome: nome });
    if (r.error) return erro(r.error);
    $('pa-slug').value = ''; $('pa-nome').value = '';
    renderCatPapeis();
    toast('Papel adicionado.');
  }

  async function excluirPapel(pa) {
    if (!confirm('Excluir o papel "' + pa.nome + '"?\nAs telas dele (papel_permissoes) e as atribuições a usuários serão removidas.')) return;
    var r = await SB.from('papeis').delete().eq('id', pa.id);
    if (r.error) return erro(r.error);
    renderCatPapeis();
    toast('Papel excluído.');
  }

  async function renderPapelTelas(pa) {
    var box = $('cat-papel-telas');
    box.innerHTML = '<div class="loading">Carregando telas…</div>';
    var rt = await SB.from('telas').select('id,slug,nome,ordem').eq('sistema_id', catSistemaId).order('ordem');
    if (rt.error) return erro(rt.error);
    var telas = rt.data || [];
    if (!telas.length) { box.innerHTML = '<div class="empty">Cadastre telas deste sistema primeiro (acima).</div>'; return; }
    var rp = await SB.from('papel_permissoes').select('tela_id,pode_ver,pode_editar,pode_exportar').eq('papel_id', pa.id);
    if (rp.error) return erro(rp.error);
    var atual = {}; (rp.data || []).forEach(function (x) { atual[x.tela_id] = x; });

    var c = corPapel(pa.slug);
    var soLeitura = !!PAPEIS_SO_LEITURA[pa.slug];   // visualizador/leitor: sem editar/exportar
    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Tela</th><th class="chk-col">Ver</th><th class="chk-col">Editar</th><th class="chk-col">Exportar</th></tr></thead>';
    var tb = el('tbody');
    telas.forEach(function (t) {
      var a = atual[t.id] || {};
      var tr = el('tr');
      if (soLeitura) tr.dataset.soLeitura = '1';
      tr.appendChild(el('td', null, '<b>' + esc(t.nome) + '</b><br><span class="muted">' + esc(t.slug) + '</span>'));
      ['ver', 'editar', 'exportar'].forEach(function (acao) {
        var td = el('td', { class: 'chk-col' });
        var chk = el('input', { type: 'checkbox', class: 'form-check-input', 'data-tela': t.id, 'data-acao': acao });
        if (a['pode_' + acao] && !(soLeitura && acao !== 'ver')) chk.checked = true;
        chk.addEventListener('change', function () { onChkChange(tr); });
        td.appendChild(chk); tr.appendChild(td);
      });
      tb.appendChild(tr); syncRow(tr);
    });
    tbl.appendChild(tb);
    // Quantas pessoas serao afetadas. Marcar uma caixa aqui mexe em todo mundo
    // que tem este papel — quem edita precisa ver o tamanho disso antes.
    var quantos = 0;
    var rq = await SB.from('perfil_papeis').select('perfil_id', { count: 'exact', head: true }).eq('papel_id', pa.id);
    if (!rq.error && typeof rq.count === 'number') quantos = rq.count;

    var head = el('div', { class: 'mb-2' },
      '<b style="color:' + c + '">Telas do papel: ' + esc(pa.nome) + '</b> '
      + '<span class="muted">(' + esc(pa.slug) + ')</span><br>'
      + '<span class="muted" style="font-size:.85rem">'
      + '<i class="bi bi-people-fill"></i> Vale <b>imediatamente</b> para '
      + (quantos === 1 ? '<b>1 pessoa</b>' : '<b>' + quantos + ' pessoas</b>')
      + ' com este papel. Para abrir exceção a alguém, use o <i class="bi bi-key"></i> em <b>Usuários</b>.'
      + '</span>');
    var save = el('button', { class: 'btn btn-roxo mt-2' }, '<i class="bi bi-check-lg"></i> Salvar telas do papel');
    save.addEventListener('click', function () { salvarPapelTelas(pa, tb); });
    box.innerHTML = ''; box.appendChild(head); box.appendChild(tbl);
    if (soLeitura) box.appendChild(el('div', { class: 'muted', style: 'font-size:.82rem;margin:6px 0 0' },
      '<i class="bi bi-eye"></i> Papel só-leitura: “Editar” e “Exportar” ficam bloqueados.'));
    box.appendChild(save);
  }

  async function salvarPapelTelas(pa, tbody) {
    var soLeitura = !!PAPEIS_SO_LEITURA[pa.slug];   // força editar/exportar = false
    var upserts = [], deletes = [];
    tbody.querySelectorAll('tr').forEach(function (tr) {
      var telaId = Number(tr.querySelector('[data-acao="ver"]').getAttribute('data-tela'));
      var ver = tr.querySelector('[data-acao="ver"]').checked;
      if (ver) {
        upserts.push({
          papel_id: pa.id, tela_id: telaId, pode_ver: true,
          pode_editar: soLeitura ? false : tr.querySelector('[data-acao="editar"]').checked,
          pode_exportar: soLeitura ? false : tr.querySelector('[data-acao="exportar"]').checked
        });
      } else { deletes.push(telaId); }
    });
    try {
      if (upserts.length) {
        var u = await SB.from('papel_permissoes').upsert(upserts, { onConflict: 'papel_id,tela_id' });
        if (u.error) throw u.error;
      }
      if (deletes.length) {
        var d = await SB.from('papel_permissoes').delete().eq('papel_id', pa.id).in('tela_id', deletes);
        if (d.error) throw d.error;
      }
      toast('Telas do papel salvas — já valendo para todos que têm este papel.');
    } catch (e) { erro(e); }
  }

  function renderCatSistemas() {
    var box = $('cat-sistemas');
    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Sistema</th><th>Slug</th><th>Status</th></tr></thead>';
    var tb = el('tbody');
    cacheSistemas.forEach(function (s) {
      var tr = el('tr', { style: 'cursor:pointer' });
      if (String(s.id) === String(catSistemaId)) tr.style.background = '#eef2ff';
      tr.appendChild(el('td', null, '<i class="bi ' + esc(s.icone || 'bi-app') + '" style="color:' + esc(s.cor || '#64748b') + '"></i> <b>' + esc(s.nome) + '</b>'));
      tr.appendChild(el('td', null, '<span class="muted">' + esc(s.slug) + '</span>'));
      tr.appendChild(el('td', null, s.ativo ? '<span class="pill on">ativo</span>' : '<span class="pill off">inativo</span>'));
      tr.addEventListener('click', function () { catSistemaId = s.id; renderCatSistemas(); renderCatTelas(); renderCatPapeis(); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = ''; box.appendChild(tbl);
  }

  async function renderCatTelas() {
    var sis = cacheSistemas.find(function (s) { return String(s.id) === String(catSistemaId); });
    $('cat-ctx').textContent = sis ? ('— ' + sis.nome) : '';
    var box = $('cat-telas');
    if (!catSistemaId) { box.innerHTML = '<div class="empty">Selecione um sistema.</div>'; return; }
    box.innerHTML = '<div class="loading">Carregando…</div>';
    var r = await SB.from('telas').select('id,slug,nome,ordem').eq('sistema_id', catSistemaId).order('ordem');
    if (r.error) return erro(r.error);
    var telas = r.data || [];
    if (!telas.length) { box.innerHTML = '<div class="empty">Nenhuma tela. Adicione acima.</div>'; return; }
    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Ordem</th><th>Nome</th><th>Slug</th><th></th></tr></thead>';
    var tb = el('tbody');
    telas.forEach(function (t) {
      var tr = el('tr');
      tr.appendChild(el('td', null, esc(t.ordem)));
      tr.appendChild(el('td', null, '<b>' + esc(t.nome) + '</b>'));
      tr.appendChild(el('td', null, '<span class="muted">' + esc(t.slug) + '</span>'));
      var td = el('td');
      var b = el('button', { class: 'btn btn-sm btn-light', title: 'Excluir tela' }, '<i class="bi bi-trash text-danger"></i>');
      b.addEventListener('click', function () { excluirTela(t); });
      td.appendChild(b); tr.appendChild(td);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = ''; box.appendChild(tbl);
  }

  async function adicionarTela() {
    if (!catSistemaId) { toast('Selecione um sistema primeiro.', true); return; }
    var slug = ($('t-slug').value || '').trim().toLowerCase();
    var nome = ($('t-nome').value || '').trim();
    if (!slug || !nome) { toast('Informe slug e nome da tela.', true); return; }
    var nova = { sistema_id: catSistemaId, slug: slug, nome: nome, ordem: Number($('t-ordem').value) || 0 };
    var r = await SB.from('telas').insert(nova);
    if (r.error) return erro(r.error);
    $('t-slug').value = ''; $('t-nome').value = ''; $('t-ordem').value = '0';
    renderCatTelas();
    toast('Tela adicionada.');
  }

  async function excluirTela(t) {
    if (!confirm('Excluir a tela "' + t.nome + '"? As liberações dela serão removidas.')) return;
    var r = await SB.from('telas').delete().eq('id', t.id);
    if (r.error) return erro(r.error);
    renderCatTelas();
    toast('Tela excluída.');
  }

  async function salvarNovoSistema() {
    var slug = ($('ns-slug').value || '').trim().toLowerCase();
    var nome = ($('ns-nome').value || '').trim();
    if (!slug || !nome) { toast('Informe slug e nome.', true); return; }
    var novo = {
      slug: slug, nome: nome,
      url: ($('ns-url').value || '').trim() || null,
      icone: ($('ns-icone').value || '').trim() || null,
      cor: ($('ns-cor').value || '').trim() || null,
      ordem: Number($('ns-ordem').value) || 0,
      ativo: true
    };
    var r = await SB.from('sistemas').insert(novo).select().single();
    if (r.error) return erro(r.error);
    cacheSistemas.push(r.data);
    cacheSistemas.sort(function (a, b) { return a.ordem - b.ordem; });
    optsSistemas($('ac-sistema'));
    renderCatSistemas();
    ['ns-slug', 'ns-nome', 'ns-url', 'ns-icone', 'ns-cor'].forEach(function (id) { $(id).value = ''; });
    $('ns-ordem').value = '0';
    bootstrap.Modal.getInstance($('modalSistema')).hide();
    toast('Sistema cadastrado.');
  }

  /* ==========================================================================
     SEÇÃO 5 — TELAS DE ACESSO (sistema_landing): textos/cor/imagem do login
     ========================================================================== */
  var ldSistemaId = null;      // sistema selecionado
  var cacheLanding = {};       // sistema_id -> registro de sistema_landing
  var landingOk = true;        // vira false se a tabela ainda não existir

  function initLanding() {
    carregarLanding();
  }

  async function carregarLanding() {
    cacheLanding = {};
    var r = await SB.from('sistema_landing').select('*');
    if (r.error) {
      // tabela ainda não criada — mostra aviso, não quebra o painel
      landingOk = false;
      console.warn('[admin] sistema_landing:', r.error.message);
    } else {
      landingOk = true;
      (r.data || []).forEach(function (x) { cacheLanding[x.sistema_id] = x; });
    }
    renderLdSistemas();
  }

  function renderLdSistemas() {
    var box = $('ld-sistemas');
    if (!box) return;
    if (!landingOk) {
      box.innerHTML = '<div class="empty" style="text-align:left"><i class="bi bi-exclamation-triangle text-warning"></i> A tabela <span class="code">sistema_landing</span> ainda não existe. Rode <span class="code">central/sql/sistema_landing.sql</span> no Supabase e recarregue.</div>';
      $('ld-form').innerHTML = '<div class="empty">Indisponível até rodar o SQL.</div>';
      return;
    }
    var tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Sistema</th><th>Login</th></tr></thead>';
    var tb = el('tbody');
    cacheSistemas.forEach(function (s) {
      var tr = el('tr', { style: 'cursor:pointer' });
      if (String(s.id) === String(ldSistemaId)) tr.style.background = '#eef2ff';
      tr.appendChild(el('td', null, '<i class="bi ' + esc(s.icone || 'bi-app') + '" style="color:' + esc(s.cor || '#64748b') + '"></i> <b>' + esc(s.nome) + '</b><br><span class="muted">' + esc(s.slug) + '</span>'));
      var tem = !!cacheLanding[s.id];
      tr.appendChild(el('td', null, tem ? '<span class="pill on">personalizado</span>' : '<span class="pill off">padrão</span>'));
      tr.addEventListener('click', function () { ldSistemaId = s.id; renderLdSistemas(); renderLandingForm(); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = ''; box.appendChild(tbl);
  }

  function renderLandingForm() {
    var box = $('ld-form');
    var sis = cacheSistemas.find(function (s) { return String(s.id) === String(ldSistemaId); });
    $('ld-ctx').textContent = sis ? ('— ' + sis.nome) : '';
    if (!sis) { box.innerHTML = '<div class="empty">Selecione um sistema à esquerda.</div>'; return; }
    var d = cacheLanding[sis.id] || {};
    var feats = [];
    try { feats = Array.isArray(d.features) ? d.features : (d.features ? JSON.parse(d.features) : []); } catch (e) { feats = []; }
    var featsTxt = feats.map(function (f) {
      return [(f.icon || ''), (f.titulo || ''), (f.desc || '')].join(' | ');
    }).join('\n');

    box.innerHTML =
      '<div class="row g-3">' +
        '<div class="col-md-6"><label class="lbl">Marca (nome curto)</label><input id="ld-marca" class="form-control" placeholder="ex.: GOM" /></div>' +
        '<div class="col-md-6"><label class="lbl">Linha de apoio</label><input id="ld-sub" class="form-control" placeholder="ex.: Obras e Manutenção · SME" /></div>' +
        '<div class="col-12"><label class="lbl">Título (headline)</label><input id="ld-titulo" class="form-control" placeholder="ex.: A manutenção das escolas, sob controle." /></div>' +
        '<div class="col-12"><label class="lbl">Parágrafo</label><textarea id="ld-tagline" class="form-control" rows="2" placeholder="Frase curta e discreta sobre o sistema."></textarea></div>' +
        '<div class="col-md-6"><label class="lbl">Texto do botão / card (CTA)</label><input id="ld-cta" class="form-control" placeholder="ex.: Entrar no GOM" /></div>' +
        '<div class="col-md-3"><label class="lbl">Cor de destaque</label><input id="ld-cor" type="color" class="form-control form-control-color" style="width:100%" /></div>' +
        '<div class="col-md-3 d-flex align-items-end"><div class="form-check"><input id="ld-empresa" class="form-check-input" type="checkbox" /><label class="form-check-label" for="ld-empresa">Opção empresa/fornecedor</label></div></div>' +
        '<div class="col-12"><label class="lbl">Imagem / logo (URL — opcional)</label><input id="ld-imagem" class="form-control" placeholder="https://…" /></div>' +
        '<div class="col-12"><label class="lbl">Destaques (um por linha: <span class="code">icone | título | descrição</span>)</label>' +
          '<textarea id="ld-features" class="form-control" rows="5" placeholder="bi-journal-plus | Chamados | Abra e acompanhe as solicitações."></textarea>' +
          '<div class="muted" style="font-size:.8rem;margin-top:4px">Ícones: nomes do Bootstrap Icons (ex.: <span class="code">bi-shield-lock</span>). Deixe em branco para nenhum destaque.</div>' +
        '</div>' +
      '</div>' +
      '<div class="d-flex justify-content-between align-items-center mt-3">' +
        '<span class="muted" style="font-size:.85rem"><i class="bi bi-eye"></i> Conteúdo público (aparece deslogado). Não coloque informação interna.</span>' +
        '<div><button id="ld-preview" class="btn btn-light me-1"><i class="bi bi-box-arrow-up-right"></i> Ver login</button>' +
        '<button id="ld-salvar" class="btn btn-azul"><i class="bi bi-check-lg"></i> Salvar</button></div>' +
      '</div>';

    $('ld-marca').value = d.marca || '';
    $('ld-sub').value = d.sub || '';
    $('ld-titulo').value = d.titulo || '';
    $('ld-tagline').value = d.tagline || '';
    $('ld-cta').value = d.cta || '';
    $('ld-cor').value = /^#[0-9a-fA-F]{6}$/.test(d.cor || '') ? d.cor : (sis.cor && /^#[0-9a-fA-F]{6}$/.test(sis.cor) ? sis.cor : '#4f46e5');
    $('ld-empresa').checked = !!d.mostra_empresa;
    $('ld-imagem').value = d.imagem_url || '';
    $('ld-features').value = featsTxt;

    $('ld-salvar').addEventListener('click', function () { salvarLanding(sis); });
    $('ld-preview').addEventListener('click', function () {
      window.open('login.html?next=' + encodeURIComponent((sis.url || '/') ), '_blank');
    });
  }

  function parseFeatures(txt) {
    return (txt || '').split('\n').map(function (ln) {
      var t = ln.trim();
      if (!t) return null;
      var parts = t.split('|').map(function (x) { return x.trim(); });
      return { icon: parts[0] || '', titulo: parts[1] || '', desc: parts[2] || '' };
    }).filter(Boolean);
  }

  async function salvarLanding(sis) {
    var reg = {
      sistema_id: sis.id,
      slug: sis.slug,
      marca: ($('ld-marca').value || '').trim() || null,
      sub: ($('ld-sub').value || '').trim() || null,
      titulo: ($('ld-titulo').value || '').trim() || null,
      tagline: ($('ld-tagline').value || '').trim() || null,
      cta: ($('ld-cta').value || '').trim() || null,
      cor: ($('ld-cor').value || '').trim() || null,
      imagem_url: ($('ld-imagem').value || '').trim() || null,
      features: parseFeatures($('ld-features').value),
      mostra_empresa: $('ld-empresa').checked
    };
    var btn = $('ld-salvar'); if (btn) btn.disabled = true;
    try {
      var r = await SB.from('sistema_landing').upsert(reg, { onConflict: 'sistema_id' }).select().single();
      if (r.error) throw r.error;
      cacheLanding[sis.id] = r.data;
      renderLdSistemas();
      toast('Tela de acesso salva. (aparece no login deste sistema)');
    } catch (e) { erro(e); }
    if (btn) btn.disabled = false;
  }

  /* ==========================================================================
     SEÇÃO 6 — VER COMO (permissoes_de)
     ========================================================================== */
  function initSimular() {
    $('sm-ver').addEventListener('click', consultarSimulacao);
    $('sm-email').addEventListener('keydown', function (e) { if (e.key === 'Enter') consultarSimulacao(); });
  }

  async function consultarSimulacao() {
    var email = ($('sm-email').value || '').trim().toLowerCase();
    var out = $('sm-result');
    if (!email) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="loading">Consultando…</div>';
    var r = await SB.rpc('permissoes_de', { p_email: email });
    if (r.error) { out.innerHTML = ''; return erro(r.error); }
    var d = r.data;
    if (!d || !d.autorizado) {
      out.innerHTML = '<div class="empty"><i class="bi bi-x-circle"></i> Não autorizado' +
        (d && d.motivo ? ' (' + esc(d.motivo) + ')' : '') + '. Verifique se o e-mail está cadastrado e ativo.</div>';
      return;
    }
    var h = '<div class="panel" style="margin:0">';
    h += '<div><b>' + esc(d.perfil.nome || d.perfil.email) + '</b> · ' + esc(d.perfil.email) +
      ' <span class="pill tipo">' + esc(d.perfil.tipo) + '</span>' +
      (d.perfil.is_super_admin ? ' <span class="pill super">super</span>' : '') + '</div>';
    if (d.escolas && d.escolas.length) {
      h += '<div class="mt-2 muted"><i class="bi bi-building"></i> ' +
        d.escolas.map(function (e) { return esc(e.nome) + (e.vinculo ? ' (' + esc(e.vinculo) + ')' : ''); }).join(' · ') + '</div>';
    }
    h += '<div class="tree mt-2">';
    if (!d.sistemas || !d.sistemas.length) {
      h += '<div class="empty">Sem sistemas liberados.</div>';
    } else {
      d.sistemas.forEach(function (s) {
        h += '<div class="sis"><i class="bi ' + esc(s.icone || 'bi-app') + '"></i> ' + esc(s.nome) + '</div>';
        var telas = s.telas || {};
        var keys = Object.keys(telas);
        if (!keys.length) { h += '<div class="tela muted">(nenhuma tela)</div>'; }
        keys.forEach(function (slug) {
          var t = telas[slug];
          var acoes = ['ver', 'editar', 'exportar'].filter(function (a) { return t[a]; });
          h += '<div class="tela">' + esc(t.nome || slug) + ' — <span class="acoes">' + acoes.join(', ') + '</span></div>';
        });
      });
    }
    h += '</div>';
    var btn = '<a href="login.html" class="btn btn-sm btn-light mt-2" onclick="sessionStorage.setItem(\'ACESSO_SIMULA\',\'' +
      esc(email) + '\')"><i class="bi bi-incognito"></i> Abrir portal simulando este usuário</a>';
    h += btn + '</div>';
    out.innerHTML = h;
  }

  /* ==========================================================================
     SEÇÃO 7 — HISTÓRICO (permissoes_log)

     A tabela é escrita por trigger no banco e é somente leitura para todo
     mundo, inclusive para este painel. Se ela ainda não existir, a seção
     explica o que falta em vez de estourar um erro sem sentido.
     ========================================================================== */
  var TABELA_LABEL = {
    perfil_tela:      'Exceção individual',
    papel_permissoes: 'Permissão de papel',
    perfil_papeis:    'Papel do usuário',
    perfil_escola:    'Vínculo de escola',
    perfis:           'Cadastro do usuário'
  };
  var ACAO_LABEL = { INSERT: 'criou', UPDATE: 'alterou', DELETE: 'removeu' };
  var ACAO_COR   = { INSERT: '#047857', UPDATE: '#0369a1', DELETE: '#b91c1c' };

  var cacheHistorico = [];
  var mapaTelas = null, mapaPapeis = null, mapaEscolas = null;

  function initHistorico() {
    $('hi-reload').addEventListener('click', carregarHistorico);
    $('hi-limite').addEventListener('change', carregarHistorico);
    $('hi-tabela').addEventListener('change', renderHistorico);
    $('hi-busca').addEventListener('input', renderHistorico);
  }

  // Nomes legíveis para os ids que aparecem dentro do jsonb do registro.
  async function carregarDicionarios() {
    if (mapaTelas) return;
    mapaTelas = {}; mapaPapeis = {}; mapaEscolas = {};
    var r = await Promise.all([
      SB.from('telas').select('id,nome,slug'),
      SB.from('papeis').select('id,nome,slug'),
      SB.from('escolas').select('id,nome')
    ]);
    (r[0].data || []).forEach(function (t) { mapaTelas[t.id] = t.nome || t.slug; });
    (r[1].data || []).forEach(function (p) { mapaPapeis[p.id] = p.nome || p.slug; });
    (r[2].data || []).forEach(function (e) { mapaEscolas[e.id] = e.nome; });
  }

  async function carregarHistorico() {
    var area = $('hi-tabela-area');
    area.innerHTML = '<div class="loading">Carregando…</div>';
    await carregarDicionarios();
    var lim = parseInt($('hi-limite').value, 10) || 100;
    var r = await SB.from('permissoes_log')
      .select('id,quando,quem_email,acao,tabela,alvo,antes,depois')
      .order('quando', { ascending: false })
      .limit(lim);
    if (r.error) {
      // 42P01 = tabela inexistente; PGRST205 = PostgREST não achou no schema.
      var faltando = /permissoes_log/.test(r.error.message || '') ||
                     r.error.code === '42P01' || r.error.code === 'PGRST205';
      area.innerHTML = faltando
        ? '<div class="empty"><i class="bi bi-clock-history"></i> O registro de alterações ainda não foi criado no banco.' +
          '<br><span class="muted">Falta rodar o script de auditoria no Supabase do central. Até lá, nada é gravado — e o que aconteceu antes disso não tem como ser recuperado.</span></div>'
        : '<div class="empty">Não foi possível ler o histórico.</div>';
      if (!faltando) erro(r.error);
      cacheHistorico = [];
      return;
    }
    cacheHistorico = r.data || [];
    renderHistorico();
  }

  // Traduz uma linha do jsonb em texto curto: só os campos que importam.
  function descreverLinha(tabela, obj) {
    if (!obj) return '';
    var p = [];
    function add(txt) { if (txt) p.push(txt); }
    if (obj.tela_id != null)   add('tela: ' + (mapaTelas[obj.tela_id] || '#' + obj.tela_id));
    if (obj.papel_id != null)  add('papel: ' + (mapaPapeis[obj.papel_id] || '#' + obj.papel_id));
    if (obj.escola_id != null) add('escola: ' + (mapaEscolas[obj.escola_id] || '#' + obj.escola_id));
    if (obj.vinculo)           add('vínculo: ' + obj.vinculo);
    ['pode_ver', 'pode_editar', 'pode_exportar'].forEach(function (k) {
      if (obj[k] != null) add(k.replace('pode_', '') + '=' + (obj[k] ? 'sim' : 'não'));
    });
    if (tabela === 'perfis') {
      ['tipo', 'ativo', 'is_super_admin', 'is_viewer'].forEach(function (k) {
        if (obj[k] != null) add(k + '=' + (typeof obj[k] === 'boolean' ? (obj[k] ? 'sim' : 'não') : obj[k]));
      });
    }
    return p.join(' · ');
  }

  // No UPDATE só interessa o que mudou — o resto é ruído.
  function descreverMudanca(r) {
    if (r.acao === 'INSERT') return descreverLinha(r.tabela, r.depois);
    if (r.acao === 'DELETE') return descreverLinha(r.tabela, r.antes);
    var a = r.antes || {}, d = r.depois || {}, out = [];
    Object.keys(d).forEach(function (k) {
      if (k === 'id' || k === 'criado_em' || k === 'atualizado_em') return;
      if (JSON.stringify(a[k]) === JSON.stringify(d[k])) return;
      function v(x) { return x == null ? '—' : (typeof x === 'boolean' ? (x ? 'sim' : 'não') : String(x)); }
      out.push(k + ': ' + v(a[k]) + ' → ' + v(d[k]));
    });
    return out.join(' · ') || '(sem diferença registrada)';
  }

  function renderHistorico() {
    var area = $('hi-tabela-area');
    var q = ($('hi-busca').value || '').trim().toLowerCase();
    var tb = $('hi-tabela').value;
    var lista = cacheHistorico.filter(function (r) {
      if (tb && r.tabela !== tb) return false;
      if (!q) return true;
      return (String(r.quem_email || '') + ' ' + String(r.alvo || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!lista.length) {
      area.innerHTML = '<div class="empty">Nenhuma alteração registrada' + (q || tb ? ' com esse filtro' : ' ainda') + '.</div>';
      return;
    }
    var h = '<div class="table-responsive"><table class="table table-sm align-middle">' +
      '<thead><tr><th style="white-space:nowrap">Quando</th><th>Quem</th><th>O quê</th><th>Sobre</th><th>Detalhe</th></tr></thead><tbody>';
    lista.forEach(function (r) {
      var dt = new Date(r.quando);
      h += '<tr>' +
        '<td class="muted" style="white-space:nowrap;font-size:.82rem">' + esc(dt.toLocaleString('pt-BR')) + '</td>' +
        '<td style="font-size:.85rem">' + esc(r.quem_email || '—') + '</td>' +
        '<td style="font-size:.85rem"><b style="color:' + (ACAO_COR[r.acao] || '#475569') + '">' +
          esc(ACAO_LABEL[r.acao] || r.acao) + '</b> ' + esc(TABELA_LABEL[r.tabela] || r.tabela) + '</td>' +
        '<td style="font-size:.85rem">' + esc(r.alvo || '—') + '</td>' +
        '<td class="code">' + esc(descreverMudanca(r)) + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="muted mt-2" style="font-size:.8rem">' + lista.length + ' de ' + cacheHistorico.length +
      ' registros carregados. O registro é gravado pelo próprio banco e não pode ser apagado por este painel.</div>';
    area.innerHTML = h;
  }
  /* ==========================================================================
     SEÇÃO 8 — USO (quem acessa e quem não acessa)

     Lê `acesso_uso`, gravada pela RPC `registrar_acesso()` que o
     `acesso-sme.js` dispara uma vez por sessão do navegador, em qualquer
     sistema da rede. A tabela é somente leitura (e só para super admin);
     escrever nela é privilégio da função `SECURITY DEFINER`.

     ⚠️ O relatório tem DOIS lados, e o segundo é o que interessa: quem tem
     acesso liberado e NÃO usa. Por isso a lista não sai de `acesso_uso` — sai
     de `perfis`, com o uso costurado por fora. Listar só quem tem registro
     mostraria apenas quem já acessa, que é a pergunta fácil.

     ⚠️ O registro NÃO é retroativo. Quem usou o sistema antes de a função
     existir aparece como "nunca acessou" até entrar de novo. O rodapé diz
     desde quando há registro, senão o relatório mente com cara de dado.
     ========================================================================== */
  var cacheUso = null;        // linhas cruas de acesso_uso
  var usoPorPerfil = {};      // perfil_id -> { sistema_id: linha }
  var usoIndisponivel = null; // mensagem, quando a tabela ainda não existe

  function initUso() {
    var sel = $('uso-sistema');
    cacheSistemas.filter(function (s) { return s.ativo !== false; }).forEach(function (s) {
      sel.appendChild(el('option', { value: s.id }, esc(s.nome)));
    });
    ['uso-sistema', 'uso-periodo', 'uso-status'].forEach(function (id) {
      $(id).addEventListener('change', renderUso);
    });
    $('uso-inativos').addEventListener('change', renderUso);
    $('uso-busca').addEventListener('input', renderUso);
    $('uso-reload').addEventListener('click', function () { cacheUso = null; carregarUso(); });
    $('uso-csv').addEventListener('click', baixarUsoCsv);
  }

  // ⚠️ Paginado: o PostgREST corta em 1.000 linhas e NÃO avisa. Com uma linha
  // por pessoa × sistema, a rede passa desse teto sem ninguém perceber — e o
  // sintoma seria gente ativa aparecendo como "nunca acessou". A ordenação é
  // obrigatória, senão as páginas se repetem e perdem linhas.
  async function buscarUsoPaginado() {
    var out = [], passo = 1000, de = 0;
    for (;;) {
      var r = await SB.from('acesso_uso')
        .select('perfil_id,sistema_id,primeiro_acesso,ultimo_acesso,acessos')
        .order('perfil_id', { ascending: true }).order('sistema_id', { ascending: true })
        .range(de, de + passo - 1);
      if (r.error) return { error: r.error };
      var d = r.data || [];
      out = out.concat(d);
      if (d.length < passo) break;
      de += passo;
    }
    return { data: out };
  }

  async function carregarUso() {
    if (cacheUso) return renderUso();
    $('uso-tabela-area').innerHTML = '<div class="loading">Carregando…</div>';
    var r = await buscarUsoPaginado();
    if (r.error) {
      // 42P01 = tabela inexistente; PGRST205 = PostgREST não a achou no schema.
      var faltando = /acesso_uso/.test(r.error.message || '') ||
                     r.error.code === '42P01' || r.error.code === 'PGRST205';
      usoIndisponivel = faltando
        ? '<div class="empty"><i class="bi bi-activity"></i> O registro de uso ainda não foi criado no banco.' +
          '<br><span class="muted">Falta rodar o script de <b>RELATORIO-ACESSO.md</b> no Supabase do central. Até lá nada é gravado — e o uso anterior a isso não tem como ser recuperado.</span></div>'
        : '<div class="empty">Não foi possível ler o registro de uso.</div>';
      if (!faltando) erro(r.error);
      cacheUso = [];
      usoPorPerfil = {};
      return renderUso();
    }
    usoIndisponivel = null;
    cacheUso = r.data || [];
    usoPorPerfil = {};
    cacheUso.forEach(function (u) {
      (usoPorPerfil[u.perfil_id] = usoPorPerfil[u.perfil_id] || {})[Number(u.sistema_id)] = u;
    });
    renderUso();
  }

  function corteUso() {
    var dias = parseInt($('uso-periodo').value, 10) || 0;
    return dias ? Date.now() - dias * 86400000 : null;
  }

  // Uma linha do relatório por pessoa, já com o recorte de sistema aplicado:
  // com um sistema escolhido, só o uso DAQUELE sistema conta.
  function linhasUso() {
    var sisId = $('uso-sistema').value;
    var corte = corteUso();
    var incluirInativos = $('uso-inativos').checked;
    var sistemasAtivos = cacheSistemas.filter(function (s) { return s.ativo !== false; });

    return cachePerfis.filter(function (p) {
      if (!incluirInativos && p.ativo === false) return false;
      if (sisId) return perfilAlcancaSistema(p, sisId);
      // Sem recorte: quem não alcança sistema NENHUM não é caso de uso — é
      // cadastro sem permissão, e o lugar disso é a aba Usuários.
      return sistemasAtivos.some(function (s) { return perfilAlcancaSistema(p, s.id); });
    }).map(function (p) {
      var regs = usoPorPerfil[p.id] || {};
      var alcanca = sisId ? [Number(sisId)]
        : sistemasAtivos.filter(function (s) { return perfilAlcancaSistema(p, s.id); })
                        .map(function (s) { return Number(s.id); });
      var ultimo = null, acessos = 0, usados = [];
      alcanca.forEach(function (id) {
        var u = regs[id]; if (!u) return;
        var t = Date.parse(u.ultimo_acesso);
        if (!isNaN(t) && (ultimo === null || t > ultimo)) ultimo = t;
        acessos += Number(u.acessos || 0);
        usados.push(id);
      });
      var status = ultimo === null ? 'nunca' : (corte === null || ultimo >= corte ? 'ativo' : 'parado');
      return {
        perfil: p, ultimo: ultimo, acessos: acessos, status: status,
        alcanca: alcanca, usados: usados
      };
    });
  }

  function rotuloStatus(st) {
    if (st === 'ativo')  return '<span class="pill on">acessou</span>';
    if (st === 'parado') return '<span class="pill" style="background:#fef3c7;color:#b45309">sem acesso recente</span>';
    return '<span class="pill off">nunca acessou</span>';
  }
  function quando(ms) {
    if (ms === null) return '<span class="muted">—</span>';
    var d = new Date(ms);
    var dias = Math.floor((Date.now() - ms) / 86400000);
    var rel = dias <= 0 ? 'hoje' : (dias === 1 ? 'ontem' : 'há ' + dias + ' dias');
    return esc(d.toLocaleDateString('pt-BR')) + ' <span class="muted">(' + rel + ')</span>';
  }
  function pct(n, d) { return d ? Math.round(n * 100 / d) : 0; }

  // Filtro de busca/situação + ordenação. Tela e CSV leem daqui: baixar o
  // relatório tem que dar exatamente a lista que está na tela, na mesma ordem.
  function usoFiltrado(linhas) {
    var q = ($('uso-busca').value || '').trim().toLowerCase();
    var st = $('uso-status').value;
    return linhas.filter(function (l) {
      if (st === 'sem') { if (l.status === 'ativo') return false; }
      else if (st && l.status !== st) return false;
      if (!q) return true;
      return ((l.perfil.nome || '') + ' ' + (l.perfil.email || '')).toLowerCase().indexOf(q) >= 0;
    // Quem menos usa primeiro: nunca acessou, depois o acesso mais antigo. O
    // topo da lista é a ação a tomar, não a informação já conhecida.
    }).sort(function (a, b) {
      if ((a.ultimo === null) !== (b.ultimo === null)) return a.ultimo === null ? -1 : 1;
      if (a.ultimo !== b.ultimo) return (a.ultimo || 0) - (b.ultimo || 0);
      return (a.perfil.nome || '').localeCompare(b.perfil.nome || '');
    });
  }

  function renderUso() {
    if (!cacheUso) return;
    var linhas = linhasUso();
    var total = linhas.length;
    var ativos = linhas.filter(function (l) { return l.status === 'ativo'; }).length;
    var parados = linhas.filter(function (l) { return l.status === 'parado'; }).length;
    var nunca = linhas.filter(function (l) { return l.status === 'nunca'; }).length;
    var periodo = ($('uso-periodo').selectedOptions[0] || {}).text || '';

    // Sem a tabela no banco, "nunca acessaram: 4" seria uma afirmação falsa
    // com cara de medição. Some com os cartões e deixe a explicação falar.
    if (usoIndisponivel) {
      $('uso-cards').innerHTML = '';
      $('uso-ctx').textContent = '';
      $('uso-tabela-area').innerHTML = usoIndisponivel;
      renderUsoPorSistema();
      return;
    }

    $('uso-cards').innerHTML =
      '<div class="uso-cards">' +
      '<div class="uso-card"><div class="r">Com acesso liberado</div><div class="n">' + total + '</div>' +
        '<div class="s">pessoas que o cadastro alcança</div></div>' +
      '<div class="uso-card ok"><div class="r">Acessaram</div><div class="n">' + ativos +
        ' <span style="font-size:.9rem;color:#64748b">(' + pct(ativos, total) + '%)</span></div>' +
        '<div class="s">' + esc(periodo.toLowerCase()) + '</div></div>' +
      '<div class="uso-card alerta"><div class="r">Sem acesso recente</div><div class="n">' + parados + '</div>' +
        '<div class="s">já usaram, mas não no período</div></div>' +
      '<div class="uso-card frio"><div class="r">Nunca acessaram</div><div class="n">' + nunca + '</div>' +
        '<div class="s">nenhum registro desde o início</div></div>' +
      '</div>';

    renderUsoPorSistema();

    var lista = usoFiltrado(linhas);

    $('uso-ctx').textContent = lista.length === total ? '' : '(' + lista.length + ' de ' + total + ')';

    var area = $('uso-tabela-area');
    if (!lista.length) { area.innerHTML = '<div class="empty">Ninguém nesse recorte.</div>'; return; }

    var h = '<div class="table-responsive"><table class="table table-sm align-middle">' +
      '<thead><tr><th>Pessoa</th><th>Tipo</th><th>Sistemas</th><th style="white-space:nowrap">Último acesso</th>' +
      '<th class="text-center">Sessões</th><th>Situação</th></tr></thead><tbody>';
    lista.forEach(function (l) {
      var p = l.perfil;
      h += '<tr>' +
        '<td><b>' + esc(p.nome || '—') + '</b><div class="muted">' + esc(p.email || '') + '</div></td>' +
        '<td>' + (p.is_super_admin ? '<span class="pill super">super</span>' :
                  '<span class="pill tipo">' + esc(p.tipo || '—') + '</span>') +
              (p.ativo === false ? ' <span class="pill off">desativado</span>' : '') + '</td>' +
        '<td style="font-size:.8rem">' + esc(l.usados.length + '/' + l.alcanca.length) +
          ' <span class="muted">usados</span></td>' +
        '<td style="white-space:nowrap;font-size:.84rem">' + quando(l.ultimo) + '</td>' +
        '<td class="text-center">' + (l.acessos || '<span class="muted">0</span>') + '</td>' +
        '<td>' + rotuloStatus(l.status) + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div>';

    var primeiro = cacheUso.reduce(function (m, u) {
      var t = Date.parse(u.primeiro_acesso);
      return isNaN(t) ? m : (m === null || t < m ? t : m);
    }, null);
    h += '<div class="muted mt-2" style="font-size:.8rem">' +
      (primeiro === null
        ? 'Ainda não há nenhum acesso registrado.'
        : 'Há registro desde ' + esc(new Date(primeiro).toLocaleDateString('pt-BR')) +
          '. Uso anterior a essa data não foi gravado e aparece como “nunca acessou”.') +
      ' Cada sessão do navegador conta uma vez por sistema — não é contagem de páginas abertas.</div>';
    area.innerHTML = h;
  }

  // Adoção por sistema: o denominador é quem o cadastro alcança (papel ou
  // exceção), não o total de pessoas da rede — comparar contra a rede inteira
  // faria um sistema de nicho parecer abandonado.
  function renderUsoPorSistema() {
    var box = $('uso-sistemas');
    var painel = $('uso-painel-sistemas');
    var sisId = $('uso-sistema').value;
    var corte = corteUso();
    var incluirInativos = $('uso-inativos').checked;
    var sistemas = cacheSistemas.filter(function (s) {
      return s.ativo !== false && (!sisId || String(s.id) === String(sisId));
    });
    painel.classList.toggle('hidden', !sistemas.length);
    if (!sistemas.length) return;
    if (usoIndisponivel) { box.innerHTML = '<div class="empty">Sem registro de uso.</div>'; return; }

    var pessoas = cachePerfis.filter(function (p) { return incluirInativos || p.ativo !== false; });
    var h = '<div class="table-responsive"><table class="table table-sm align-middle">' +
      '<thead><tr><th>Sistema</th><th class="text-center">Liberados</th><th class="text-center">Acessaram</th>' +
      '<th class="text-center">Nunca</th><th style="min-width:140px">Adoção</th></tr></thead><tbody>';
    sistemas.map(function (s) {
      var alc = 0, ac = 0, nu = 0;
      pessoas.forEach(function (p) {
        if (!perfilAlcancaSistema(p, s.id)) return;
        alc++;
        var u = (usoPorPerfil[p.id] || {})[Number(s.id)];
        if (!u) { nu++; return; }
        var t = Date.parse(u.ultimo_acesso);
        if (!isNaN(t) && (corte === null || t >= corte)) ac++;
      });
      return { s: s, alc: alc, ac: ac, nu: nu, p: pct(ac, alc) };
    }).sort(function (a, b) { return a.p - b.p; }).forEach(function (r) {
      h += '<tr>' +
        '<td><b>' + esc(r.s.nome) + '</b> <span class="muted">' + esc(r.s.slug) + '</span></td>' +
        '<td class="text-center">' + r.alc + '</td>' +
        '<td class="text-center" style="color:#15803d;font-weight:800">' + r.ac + '</td>' +
        '<td class="text-center" style="color:#b91c1c;font-weight:800">' + r.nu + '</td>' +
        '<td><div class="d-flex align-items-center gap-2"><div class="barra" style="flex:1">' +
          '<i style="width:' + r.p + '%"></i></div><span class="muted">' + r.p + '%</span></div></td>' +
        '</tr>';
    });
    h += '</tbody></table></div>';
    box.innerHTML = h;
  }

  // CSV com ';' e BOM: é o que o Excel em pt-BR abre sem pedir importação.
  // ⚠️ O arquivo leva nome e e-mail de servidor — é dado pessoal. Ele nasce no
  // navegador de quem baixou e não deve ser versionado em repositório nenhum.
  function baixarUsoCsv() {
    var linhas = usoFiltrado(linhasUso());
    var ROTULO = { ativo: 'acessou no periodo', parado: 'sem acesso recente', nunca: 'nunca acessou' };
    function c(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    var out = ['Nome;E-mail;Tipo;Ativo;Sistemas liberados;Sistemas usados;Ultimo acesso;Sessoes;Situacao'];
    linhas.forEach(function (l) {
      out.push([
        c(l.perfil.nome), c(l.perfil.email), c(l.perfil.is_super_admin ? 'super admin' : (l.perfil.tipo || '')),
        c(l.perfil.ativo === false ? 'nao' : 'sim'),
        c(l.alcanca.length), c(l.usados.length),
        c(l.ultimo === null ? '' : new Date(l.ultimo).toLocaleString('pt-BR')),
        c(l.acessos), c(ROTULO[l.status])
      ].join(';'));
    });
    var blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'uso-sistemas-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast(linhas.length + ' linhas exportadas');
  }

})();
