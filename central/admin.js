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
    initSimular();
  });

  // ---- navegação entre seções ---------------------------------------------
  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        document.querySelectorAll('.nav-item').forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        var sec = item.getAttribute('data-sec');
        ['acessos', 'usuarios', 'escolas', 'catalogo', 'simular'].forEach(function (s) {
          $('sec-' + s).classList.toggle('hidden', s !== sec);
        });
      });
    });
  }

  // ---- dados base ----------------------------------------------------------
  async function carregarPerfis() {
    var r = await SB.from('perfis').select('id,email,nome,tipo,is_super_admin,ativo').order('nome');
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
    if (!rpa.error) papeis = rpa.data || [];
    if (papeis.length) {
      var papelById = {}; papeis.forEach(function (p) { papelById[p.id] = p; });
      var rpp = await SB.from('papel_permissoes').select('papel_id,tela_id,pode_ver,pode_editar,pode_exportar')
        .in('papel_id', papeis.map(function (p) { return p.id; }));
      if (!rpp.error) (rpp.data || []).forEach(function (x) {
        (permsByPapel[x.papel_id] = permsByPapel[x.papel_id] || {})[x.tela_id] = x;
        if (x.pode_ver) (telaBadges[x.tela_id] = telaBadges[x.tela_id] || []).push(papelById[x.papel_id]);
      });
    }

    // Papel deste usuário NESTE sistema (perfil_papeis). É o que define o perfil
    // (escola/secretaria/empresa/admin) e as telas padrão. Trocar aqui muda o
    // "tipo de perfil" do usuário no sistema — grava na hora.
    var papelBox = el('div', { class: 'mb-3', style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:.7rem .9rem' });
    if (papeis.length) {
      var papelAtual = '';
      var rap = await SB.from('perfil_papeis').select('papel_id').eq('perfil_id', perfilId)
        .in('papel_id', papeis.map(function (p) { return p.id; }));
      if (!rap.error && rap.data && rap.data.length) papelAtual = rap.data[0].papel_id;

      papelBox.appendChild(el('div', { class: 'muted', style: 'font-size:.85rem;margin-bottom:.4rem' },
        '<i class="bi bi-person-badge"></i> Papel deste usuário no sistema (define o perfil e as telas padrão):'));
      var selP = el('select', { class: 'form-select form-select-sm', style: 'max-width:300px' });
      selP.appendChild(el('option', { value: '' }, '— nenhum —'));
      papeis.forEach(function (pa) { selP.appendChild(el('option', { value: pa.id }, esc(pa.nome))); });
      selP.value = papelAtual ? String(papelAtual) : '';
      selP.addEventListener('change', function () { salvarPapelSistema(perfilId, papeis, selP.value); });
      papelBox.appendChild(selP);
    }

    // Barra de atalhos por papel (aditivo: marca as telas do papel; "Limpar" zera).
    var toolbar = el('div', { class: 'mb-3 d-flex flex-wrap align-items-center gap-1' });
    if (papeis.length) {
      toolbar.appendChild(el('span', { class: 'muted', style: 'font-size:.85rem;margin-right:.3rem' }, '<i class="bi bi-magic"></i> Liberar como papel:'));
      papeis.forEach(function (pa) {
        var b = el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button' }, esc(pa.nome));
        b.addEventListener('click', function () { aplicaPapel(pa.id, permsByPapel); toast('Telas do papel “' + pa.nome + '” marcadas. Revise e salve.'); });
        toolbar.appendChild(b);
      });
      var bl = el('button', { class: 'btn btn-sm btn-light', type: 'button' }, '<i class="bi bi-eraser"></i> Limpar');
      bl.addEventListener('click', limparTudo);
      toolbar.appendChild(bl);
    }

    var tbl = el('table');
    tbl.innerHTML =
      '<thead><tr><th>Tela</th><th class="chk-col">Ver</th><th class="chk-col">Editar</th><th class="chk-col">Exportar</th></tr></thead>';
    var tb = el('tbody');
    telas.forEach(function (t) {
      var a = atual[t.id] || {};
      var tr = el('tr');
      var badges = (telaBadges[t.id] || []).map(function (pp) { return '<span class="pill tipo">' + esc(pp.slug) + '</span>'; }).join(' ');
      tr.appendChild(el('td', null, '<b>' + esc(t.nome) + '</b><br><span class="muted">' + esc(t.slug) + '</span>'
        + (badges ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">' + badges + '</div>' : '')));
      ['ver', 'editar', 'exportar'].forEach(function (acao) {
        var td = el('td', { class: 'chk-col' });
        var chk = el('input', { type: 'checkbox', class: 'form-check-input', 'data-tela': t.id, 'data-acao': acao });
        if (a['pode_' + acao]) chk.checked = true;
        chk.addEventListener('change', function () { onChkChange(tr); });
        td.appendChild(chk); tr.appendChild(td);
      });
      tb.appendChild(tr);
      syncRow(tr);
    });
    tbl.appendChild(tb);
    box.innerHTML = '';
    if (papeis.length) box.appendChild(papelBox);
    if (papeis.length) box.appendChild(toolbar);
    box.appendChild(tbl);
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

  // Marca (aditivo) as telas do papel escolhido, conforme papel_permissoes.
  function aplicaPapel(papelId, permsByPapel) {
    var mapa = permsByPapel[papelId] || {};
    document.querySelectorAll('#ac-tabela tbody tr').forEach(function (tr) {
      var vch = tr.querySelector('[data-acao="ver"]');
      var telaId = Number(vch.getAttribute('data-tela'));
      var perm = mapa[telaId];
      if (!perm) return; // papel não inclui esta tela -> não mexe (aditivo)
      if (perm.pode_ver) vch.checked = true;
      if (perm.pode_editar) tr.querySelector('[data-acao="editar"]').checked = true;
      if (perm.pode_exportar) tr.querySelector('[data-acao="exportar"]').checked = true;
      syncRow(tr);
    });
  }

  function limparTudo() {
    document.querySelectorAll('#ac-tabela tbody tr').forEach(function (tr) {
      tr.querySelector('[data-acao="ver"]').checked = false;
      tr.querySelector('[data-acao="editar"]').checked = false;
      tr.querySelector('[data-acao="exportar"]').checked = false;
      syncRow(tr);
    });
  }

  // editar/exportar dependem de "ver"
  function onChkChange(tr) {
    var ver = tr.querySelector('[data-acao="ver"]');
    if (!ver.checked) {
      tr.querySelector('[data-acao="editar"]').checked = false;
      tr.querySelector('[data-acao="exportar"]').checked = false;
    }
    syncRow(tr);
  }
  function syncRow(tr) {
    var ver = tr.querySelector('[data-acao="ver"]').checked;
    tr.querySelector('[data-acao="editar"]').disabled = !ver;
    tr.querySelector('[data-acao="exportar"]').disabled = !ver;
  }

  async function salvarAcessos() {
    var perfilId = Number($('ac-perfil').value);
    if (!perfilId) return;
    var btn = $('ac-salvar'); btn.disabled = true;

    var upserts = [], deletes = [];
    document.querySelectorAll('#ac-tabela tbody tr').forEach(function (tr) {
      var telaId = Number(tr.querySelector('[data-acao="ver"]').getAttribute('data-tela'));
      var ver = tr.querySelector('[data-acao="ver"]').checked;
      if (ver) {
        upserts.push({
          perfil_id: perfilId, tela_id: telaId,
          pode_ver: true,
          pode_editar: tr.querySelector('[data-acao="editar"]').checked,
          pode_exportar: tr.querySelector('[data-acao="exportar"]').checked
        });
      } else {
        deletes.push(telaId);
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
      toast('Liberações salvas. (o usuário vê na próxima entrada)');
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
    bootstrap.Modal.getOrCreateInstance($('modalUser')).show();
  }

  function renderUsuarios() {
    var q = ($('us-busca').value || '').toLowerCase().trim();
    var sisId = ($('us-sistema') && $('us-sistema').value) || '';
    var lista = cachePerfis.filter(function (p) {
      if (q && !((p.nome || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))) return false;
      if (sisId) {
        if (p.is_super_admin) return true;                  // super admin acessa todos
        var set = cacheAcessoPerfil[p.id];
        if (!set || !set.has(Number(sisId))) return false;
      }
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
    tbl.innerHTML = '<thead><tr><th>Nome / E-mail</th><th>Sistemas</th><th>Tipo</th><th>Status</th><th>Super</th><th></th></tr></thead>';
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
      tr.appendChild(el('td', null, p.is_super_admin ? '<span class="pill super">super</span>' : '<span class="muted">—</span>'));

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
      var bEdit = el('button', { class: 'btn btn-sm btn-light ms-1', title: 'Editar' }, '<i class="bi bi-pencil"></i>');
      bEdit.addEventListener('click', function () { abrirModalUsuario(p); });
      var bDel = el('button', { class: 'btn btn-sm btn-light ms-1', title: 'Excluir' }, '<i class="bi bi-trash text-danger"></i>');
      bDel.addEventListener('click', function () { excluirUsuario(p); });
      acts.appendChild(bAtivo); acts.appendChild(bSuper); acts.appendChild(bEdit); acts.appendChild(bDel);
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

  async function salvarUsuario() {
    var email = ($('nu-email').value || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Informe um e-mail válido.', true); return; }
    var dados = {
      email: email,
      nome: ($('nu-nome').value || '').trim() || null,
      tipo: $('nu-tipo').value,
      is_super_admin: $('nu-super').checked
    };
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
    renderCatSistemas();
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
      tr.addEventListener('click', function () { catSistemaId = s.id; renderCatSistemas(); renderCatTelas(); });
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
     SEÇÃO 5 — VER COMO (permissoes_de)
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
})();
