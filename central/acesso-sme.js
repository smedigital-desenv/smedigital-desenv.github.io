/* ============================================================================
   acesso-sme.js — Biblioteca de autenticação/autorização da REDE SME.
   Versão neutra (renomeada) do auth.js do MAPA, para uso por TODOS os sistemas.

   Incluir DEPOIS de central/config.js e do supabase-js, em página protegida.

   O que faz:
     1. Garante o cliente Supabase (window.ACESSO_SB).
     2. Confirma a sessão (senão -> login.html).
     3. Busca as permissões via RPC minhas_permissoes() (cache em sessionStorage).
     4. Verifica acesso AO SISTEMA atual (window.ACESSO_SISTEMA, padrão 'central').
     5. Esconde elementos data-tela="slug" / data-perm="tela:acao".
     6. Bloqueia a tela atual (nome do arquivo) se não houver permissão de ver.
     7. Expõe window.AcessoSME.

   API pública (window.AcessoSME):
     .pronto             -> Promise que resolve quando a auth terminou
     .perfil             -> { id, nome, email, tipo, is_super_admin }
     .escolas            -> [{ id, nome, vinculo }]
     .sistema            -> objeto do sistema atual (slug, nome, telas...)
     .sistemas           -> todos os sistemas liberados ao usuário
     .can(tela, acao)    -> bool  (acao: 'ver'|'editar'|'exportar', padrão 'ver')
     .token()            -> Promise<access_token atual>
     .authFetch(url,opt) -> fetch com Authorization do usuário (RLS)
     .signOut()          -> encerra sessão e volta ao login
     .simular(email)     -> super admin: ver a rede como outro perfil
     .pararSimulacao()   -> encerra a simulação

   Uso: defina window.ACESSO_SISTEMA = '<slug>' ANTES de incluir este arquivo.
   ============================================================================ */
(function () {
  var CFG = window.ACESSO_CFG;
  if (!CFG || !CFG.url || /SEU-PROJETO-CENTRAL|COLE_AQUI/.test(CFG.url + CFG.anonKey)) {
    console.error('[acesso-sme] window.ACESSO_CFG não configurado. Edite central/config.js.');
  }
  var SISTEMA_SLUG = window.ACESSO_SISTEMA || 'central';
  var CACHE_KEY = 'ACESSO_PERMS_v1';
  var SIMULA_KEY = 'ACESSO_SIMULA';   // e-mail que o super admin está simulando
  var LOGIN_PAGE = window.ACESSO_LOGIN || 'login.html';

  function telaAtual() {
    var f = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/i, '');
    return (f === 'index' || f === '') ? null : f;   // index = portal do sistema
  }

  // ── Normalização de nomes de escola (isolamento de dados por unidade) ──
  function normEscola(s) {
    return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function baseEscola(s) { return normEscola(String(s || '').split(',')[0]); }

  function carregarSupabaseJs() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = resolve; s.onerror = function () { reject(new Error('Falha ao carregar supabase-js')); };
      document.head.appendChild(s);
    });
  }

  function irParaLogin() {
    var aqui = (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
    location.replace(LOGIN_PAGE + '?next=' + encodeURIComponent(aqui));
  }

  function telaSemAcesso(msg) {
    var simulando = window.AcessoSME && window.AcessoSME.simulando;
    var extra = simulando
      ? '<div style="margin-top:.4rem"><button onclick="window.AcessoSME.pararSimulacao()" class="btn btn-warning btn-sm fw-bold">'
        + '<i class="bi bi-incognito"></i> Encerrar simulação</button></div>'
        + '<p style="color:#94a3b8;font-size:.78rem;margin-top:.4rem">Você está simulando este perfil — ele não tem acesso aqui.</p>'
      : '';
    document.documentElement.innerHTML =
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">' +
      '<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet"></head>' +
      '<body style="font-family:Inter,sans-serif;background:#f0f4f8;min-height:100vh;display:grid;place-items:center;margin:0;padding:1rem">' +
      '<div style="background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.12);max-width:440px;padding:2.2rem;text-align:center">' +
      '<div style="font-size:2.4rem;color:#b91c1c"><i class="bi bi-shield-exclamation"></i></div>' +
      '<h4 style="font-weight:900;color:#002b5e;margin:.6rem 0">Acesso não autorizado</h4>' +
      '<p style="color:#475569;font-size:.9rem">' + msg + '</p>' +
      extra +
      '<button onclick="window.AcessoSME.signOut()" class="btn btn-outline-secondary btn-sm mt-2">Trocar de conta</button>' +
      '</div></body>';
  }

  function montar() {
    var SB = (window.ACESSO_SB) || window.supabase.createClient(CFG.url, CFG.anonKey);
    window.ACESSO_SB = SB;

    var api = {
      pronto: null, perfil: null, escolas: [], sistema: null, sistemas: [], _todos: [],
      // Isolamento de dados por escola (espelha o auth.js do MAPA).
      restritoEscola: false, escolasNomes: [], escolasBases: [],
      podeVerEscola: function (nome) {
        if (!this.restritoEscola) return true;
        var n = normEscola(nome); if (!n) return false;
        if (this.escolasNomes.indexOf(n) !== -1) return true;
        var nb = baseEscola(nome);
        for (var i = 0; i < this.escolasBases.length; i++) {
          var b = this.escolasBases[i];
          if (b && (b === nb || nb.indexOf(b) === 0 || b.indexOf(nb) === 0)) return true;
        }
        return false;
      },
      filtrarEscolas: function (rows, getNome) {
        if (!this.restritoEscola) return rows || [];
        var self = this;
        return (rows || []).filter(function (r) { return self.podeVerEscola(getNome ? getNome(r) : r); });
      },
      can: function (tela, acao) {
        if (this.perfil && this.perfil.is_super_admin) return true;
        if (!this.sistema) return false;
        var t = this.sistema.telas && this.sistema.telas[tela];
        return !!(t && t[acao || 'ver']);
      },
      token: function () {
        return SB.auth.getSession().then(function (r) {
          return r.data.session ? r.data.session.access_token : null;
        });
      },
      authFetch: function (url, opt) {
        opt = opt || {};
        return this.token().then(function (tok) {
          opt.headers = Object.assign({}, opt.headers, {
            apikey: CFG.anonKey,
            Authorization: 'Bearer ' + (tok || CFG.anonKey)
          });
          return fetch(url, opt);
        });
      },
      signOut: function () {
        try { sessionStorage.removeItem(CACHE_KEY); sessionStorage.removeItem(SIMULA_KEY); } catch (e) {}
        return SB.auth.signOut().then(irParaLogin).catch(irParaLogin);
      },
      // SIMULAÇÃO (só super admin): ver a rede como outro perfil.
      simulando: null,      // e-mail simulado (ou null)
      realPerfil: null,     // perfil real de quem está simulando
      simular: function (email) {
        try { sessionStorage.setItem(SIMULA_KEY, String(email || '').toLowerCase()); } catch (e) {}
        location.href = 'index.html';
      },
      pararSimulacao: function () {
        try { sessionStorage.removeItem(SIMULA_KEY); } catch (e) {}
        location.reload();
      }
    };
    window.AcessoSME = api;

    api.pronto = (async function () {
      var sess = (await SB.auth.getSession()).data.session;
      if (!sess) { irParaLogin(); return; }

      // permissões (cache na sessão do navegador p/ poupar egress)
      var perms = null;
      try { perms = JSON.parse(sessionStorage.getItem(CACHE_KEY)); } catch (e) {}
      if (!perms) {
        var r = await SB.rpc('minhas_permissoes');
        if (r.error) { telaSemAcesso('Erro ao verificar permissões: ' + r.error.message); return; }
        perms = r.data;
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(perms)); } catch (e) {}
      }

      if (!perms || !perms.autorizado) {
        var motivo = perms && perms.motivo === 'dominio'
          ? 'A conta <b>' + (sess.user.email || '') + '</b> não pertence ao domínio institucional autorizado.'
          : 'A conta <b>' + (sess.user.email || '') + '</b> ainda não foi autorizada pela secretaria.';
        telaSemAcesso(motivo);
        return;
      }

      // SIMULAÇÃO: e-mail em sessão E usuário REAL é super admin -> troca permissões.
      var simEmail = null;
      try { simEmail = sessionStorage.getItem(SIMULA_KEY); } catch (e) {}
      if (simEmail && perms.perfil && perms.perfil.is_super_admin
          && simEmail.toLowerCase() !== (perms.perfil.email || '').toLowerCase()) {
        var rs = await SB.rpc('permissoes_de', { p_email: simEmail });
        if (!rs.error && rs.data && rs.data.autorizado) {
          api.realPerfil = perms.perfil;
          api.simulando = simEmail;
          perms = rs.data;                 // passa a "ser" o perfil simulado
        } else {
          try { sessionStorage.removeItem(SIMULA_KEY); } catch (e) {}
        }
      }

      api.perfil = perms.perfil;
      api.escolas = perms.escolas || [];
      api.escolasNomes = api.escolas.map(function (e) { return normEscola(e.nome); }).filter(Boolean);
      api.escolasBases = api.escolas.map(function (e) { return baseEscola(e.nome); }).filter(Boolean);
      api.restritoEscola = !(api.perfil && api.perfil.is_super_admin) && api.escolasNomes.length > 0;
      api._todos = perms.sistemas || [];
      api.sistemas = api._todos;
      api.sistema = api._todos.filter(function (s) { return s.slug === SISTEMA_SLUG; })[0] || null;

      if (!api.sistema) {
        telaSemAcesso('Você não tem acesso ao sistema <b>' + SISTEMA_SLUG.toUpperCase() + '</b>. '
          + 'Sistemas liberados: ' + (api._todos.map(function (s) { return s.nome; }).join(', ') || 'nenhum') + '.');
        return;
      }

      // tela específica sem permissão de ver -> bloqueia
      var tela = telaAtual();
      if (tela && !api.can(tela, 'ver')) {
        telaSemAcesso('Você não tem permissão para a tela <b>' + tela + '</b> deste sistema.');
        return;
      }

      aplicarUI(api);
      document.dispatchEvent(new CustomEvent('acesso-pronto', { detail: api }));
      return api;
    })();
  }

  // Esconde links/elementos de telas não permitidas e injeta o "chip" do usuário.
  function aplicarUI(api) {
    // Faixa de SIMULAÇÃO (super admin vendo como outro perfil)
    if (api.simulando && !document.getElementById('acesso-simula-bar')) {
      var quem = (api.perfil && api.perfil.nome) ? (api.perfil.nome + ' · ' + api.simulando) : api.simulando;
      var bar = document.createElement('div');
      bar.id = 'acesso-simula-bar';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:5000;background:#b45309;color:#fff;'
        + 'font:700 13px Inter,sans-serif;padding:7px 14px;display:flex;align-items:center;justify-content:center;'
        + 'gap:12px;box-shadow:0 2px 10px rgba(0,0,0,.25)';
      var span = document.createElement('span');
      span.innerHTML = '<i class="bi bi-incognito"></i> Simulando acesso de: ';
      var b = document.createElement('b'); b.textContent = quem; span.appendChild(b);
      var btn = document.createElement('button');
      btn.textContent = 'Encerrar simulação';
      btn.style.cssText = 'border:0;background:#fff;color:#b45309;font-weight:800;border-radius:999px;padding:3px 12px;cursor:pointer';
      btn.addEventListener('click', function () { api.pararSimulacao(); });
      bar.appendChild(span); bar.appendChild(btn);
      document.body.appendChild(bar);
      document.body.style.paddingTop = '36px';
    }

    // elementos com data-tela="slug" somem se não puder ver
    document.querySelectorAll('[data-tela]').forEach(function (el) {
      if (!api.can(el.getAttribute('data-tela'), 'ver')) el.style.display = 'none';
    });
    // elementos com data-perm="tela:acao" (ex "avaliacao:editar")
    document.querySelectorAll('[data-perm]').forEach(function (el) {
      var p = (el.getAttribute('data-perm') || '').split(':');
      if (!api.can(p[0], p[1] || 'ver')) el.style.display = 'none';
    });

    // chip do usuário + sair, fixado no canto
    if (!document.getElementById('acesso-user-chip')) {
      var nome = (api.perfil && (api.perfil.nome || api.perfil.email)) || '';
      var div = document.createElement('div');
      div.id = 'acesso-user-chip';
      div.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2000;background:#fff;'
        + 'border:1px solid #e2e8f0;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.12);'
        + 'padding:6px 10px;display:flex;align-items:center;gap:8px;font:600 12px Inter,sans-serif;color:#334155';
      div.innerHTML =
        '<i class="bi bi-person-circle" style="font-size:1.1rem;color:#002b5e"></i>' +
        '<span style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + nome + '</span>' +
        '<button id="acesso-logout" title="Sair" style="border:0;background:#f1f5f9;border-radius:999px;'
        + 'width:26px;height:26px;cursor:pointer;color:#475569"><i class="bi bi-box-arrow-right"></i></button>';
      document.body.appendChild(div);
      document.getElementById('acesso-logout').addEventListener('click', function () { api.signOut(); });
    }
  }

  carregarSupabaseJs().then(montar).catch(function (e) {
    console.error('[acesso-sme]', e);
  });
})();
