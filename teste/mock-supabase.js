/* ============================================================================
   mock-supabase.js — Banco FICTÍCIO em memória para o MODO DEMONSTRAÇÃO.
   Reproduz a parte da API do supabase-js usada pelo admin.js, sem servidor.
   Nada é salvo: ao recarregar a página, os dados voltam ao estado inicial.
   ============================================================================ */
(function () {
  var SEQ = 9000;

  // ---- Dados fictícios -----------------------------------------------------
  var DB = {
    perfis: [
      { id: 1, email: 'desenv.sme@gmail.com',                 nome: 'Administração SME',     tipo: 'secretaria', is_super_admin: true,  ativo: true },
      { id: 2, email: 'usuario@educacao.pmrp.sp.gov.br', nome: 'Ana Amaral (Diretora)', tipo: 'escola',     is_super_admin: false, ativo: true },
      { id: 3, email: 'usuario@educacao.pmrp.sp.gov.br',   nome: 'Carlos Silva (Coord.)', tipo: 'escola',     is_super_admin: false, ativo: true },
      { id: 4, email: 'contato@construtorabeta.com.br',        nome: 'Construtora Beta',      tipo: 'externo',    is_super_admin: false, ativo: true },
      { id: 5, email: 'usuario@educacao.pmrp.sp.gov.br', nome: 'Setor de Gestão',   tipo: 'secretaria', is_super_admin: false, ativo: false }
    ],
    escolas: [
      { id: 1, codigo_inep: '35000111', nome: 'EMEF Prof. João Ribeiro',   email_institucional: 'usuario@educacao.pmrp.sp.gov.br', ativo: true },
      { id: 2, codigo_inep: '35000222', nome: 'EMEI Vila das Flores',      email_institucional: 'usuario@educacao.pmrp.sp.gov.br',  ativo: true },
      { id: 3, codigo_inep: '35000333', nome: 'EMEF Maria Aparecida',      email_institucional: null,                                  ativo: true }
    ],
    sistemas: [
      { id: 1, slug: 'central', nome: 'Painel Central', url: '/central/',  icone: 'bi-shield-lock-fill', cor: '#7c3aed', ordem: 0, ativo: true },
      { id: 2, slug: 'mapa',    nome: 'MAPA',           url: '/mapa-sme/', icone: 'bi-map-fill',         cor: '#002b5e', ordem: 1, ativo: true },
      { id: 3, slug: 'gom',     nome: 'GOM',            url: '/gom-sme/',  icone: 'bi-tools',            cor: '#b45309', ordem: 2, ativo: true },
      { id: 4, slug: 'sate',    nome: 'SATE',           url: '/sate-sme/', icone: 'bi-bus-front-fill',   cor: '#0e7490', ordem: 3, ativo: true },
      { id: 5, slug: 'rocada',  nome: 'Roçadas',        url: '/rocada/',   icone: 'bi-tree-fill',        cor: '#15803d', ordem: 4, ativo: true }
    ],
    telas: [
      // central
      { id: 101, sistema_id: 1, slug: 'acessos',  nome: 'Acessos por tela', ordem: 1 },
      { id: 102, sistema_id: 1, slug: 'usuarios', nome: 'Usuários',         ordem: 2 },
      { id: 103, sistema_id: 1, slug: 'escolas',  nome: 'Escolas',          ordem: 3 },
      { id: 104, sistema_id: 1, slug: 'catalogo', nome: 'Catálogo',         ordem: 4 },
      { id: 105, sistema_id: 1, slug: 'simular',  nome: 'Ver como',         ordem: 5 },
      // mapa
      { id: 201, sistema_id: 2, slug: 'avaliacao',         nome: 'Avaliações',        ordem: 1 },
      { id: 202, sistema_id: 2, slug: 'atribuicao',        nome: 'Atribuição',        ordem: 2 },
      { id: 203, sistema_id: 2, slug: 'elefante',          nome: 'Elefante Letrado',  ordem: 3 },
      { id: 204, sistema_id: 2, slug: 'fluencia',          nome: 'Fluência Leitora',  ordem: 4 },
      { id: 205, sistema_id: 2, slug: 'educacao_especial', nome: 'Educação Especial', ordem: 5 },
      { id: 206, sistema_id: 2, slug: 'relatorios',        nome: 'Relatórios',        ordem: 6 },
      // gom
      { id: 301, sistema_id: 3, slug: 'chamados', nome: 'Chamados',         ordem: 1 },
      { id: 302, sistema_id: 3, slug: 'ordens',   nome: 'Ordens de serviço', ordem: 2 },
      { id: 303, sistema_id: 3, slug: 'relatorios', nome: 'Relatórios',     ordem: 3 },
      // sate
      { id: 401, sistema_id: 4, slug: 'agendamento', nome: 'Agendamento', ordem: 1 },
      { id: 402, sistema_id: 4, slug: 'chamados',    nome: 'Chamados',    ordem: 2 },
      { id: 403, sistema_id: 4, slug: 'frota',       nome: 'Frota',       ordem: 3 },
      // rocada
      { id: 501, sistema_id: 5, slug: 'solicitacoes', nome: 'Solicitações', ordem: 1 },
      { id: 502, sistema_id: 5, slug: 'mapa_areas',   nome: 'Mapa de áreas', ordem: 2 }
    ],
    // liberações diretas por perfil (exemplos)
    perfil_tela: [
      { perfil_id: 2, tela_id: 201, pode_ver: true, pode_editar: true,  pode_exportar: false }, // diretora: avaliações ver+editar
      { perfil_id: 2, tela_id: 206, pode_ver: true, pode_editar: false, pode_exportar: true  }, // diretora: relatórios ver+exportar
      { perfil_id: 3, tela_id: 201, pode_ver: true, pode_editar: false, pode_exportar: false }, // coord: avaliações ver
      { perfil_id: 4, tela_id: 301, pode_ver: true, pode_editar: true,  pode_exportar: false }  // fornecedor: chamados GOM
    ],
    perfil_escola: [
      { perfil_id: 2, escola_id: 1, vinculo: 'gestor' },
      { perfil_id: 3, escola_id: 1, vinculo: 'coordenador' },
      { perfil_id: 3, escola_id: 3, vinculo: 'coordenador' }
    ]
  };

  // ---- Query builder encadeável e "thenable" -------------------------------
  function byCol(col) {
    return function (a, b) {
      var x = a[col], y = b[col];
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y));
    };
  }

  function Builder(table) {
    this.table = table; this.op = 'select';
    this.filters = []; this.payload = null;
    this._order = null; this._single = false; this._select = false; this.onConflict = 'id';
  }
  Builder.prototype.select = function () { if (this.op === 'select') this.op = 'select'; this._select = true; return this; };
  Builder.prototype.order = function (c) { this._order = c; return this; };
  Builder.prototype.single = function () { this._single = true; return this; };
  Builder.prototype.eq = function (c, v) { this.filters.push(function (r) { return String(r[c]) === String(v); }); return this; };
  Builder.prototype.in = function (c, arr) { var s = arr.map(String); this.filters.push(function (r) { return s.indexOf(String(r[c])) >= 0; }); return this; };
  Builder.prototype.insert = function (p) { this.op = 'insert'; this.payload = p; return this; };
  Builder.prototype.update = function (p) { this.op = 'update'; this.payload = p; return this; };
  Builder.prototype.upsert = function (p, o) { this.op = 'upsert'; this.payload = p; this.onConflict = (o && o.onConflict) || 'id'; return this; };
  Builder.prototype.delete = function () { this.op = 'delete'; return this; };

  Builder.prototype._exec = function () {
    var t = this.table, self = this;
    var rows = DB[t] || (DB[t] = []);
    var match = function (r) { return self.filters.every(function (f) { return f(r); }); };

    if (this.op === 'select') {
      var res = rows.filter(match);
      if (this._order) res = res.slice().sort(byCol(this._order));
      return { data: this._single ? (res[0] || null) : res, error: null };
    }
    if (this.op === 'insert') {
      var items = Array.isArray(this.payload) ? this.payload : [this.payload];
      var ins = items.map(function (o) { var c = Object.assign({}, o); if (c.id == null) c.id = ++SEQ; return c; });
      rows.push.apply(rows, ins);
      return { data: this._select ? (this._single ? ins[0] : ins) : null, error: null };
    }
    if (this.op === 'upsert') {
      var its = Array.isArray(this.payload) ? this.payload : [this.payload];
      var keys = this.onConflict.split(',').map(function (s) { return s.trim(); });
      its.forEach(function (o) {
        var ex = rows.find(function (r) { return keys.every(function (k) { return String(r[k]) === String(o[k]); }); });
        if (ex) Object.assign(ex, o); else { var c = Object.assign({}, o); if (c.id == null) c.id = ++SEQ; rows.push(c); }
      });
      return { data: null, error: null };
    }
    if (this.op === 'update') {
      rows.filter(match).forEach(function (r) { Object.assign(r, self.payload); });
      return { data: null, error: null };
    }
    if (this.op === 'delete') {
      DB[t] = rows.filter(function (r) { return !match(r); });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  Builder.prototype.then = function (onF, onR) {
    var out;
    try { out = this._exec(); } catch (e) { out = { data: null, error: e }; }
    return Promise.resolve(out).then(onF, onR);
  };

  // ---- "Ver como" (permissoes_de) sobre o DB fictício ----------------------
  function permissoesDe(email) {
    var p = DB.perfis.find(function (x) { return x.email.toLowerCase() === String(email || '').toLowerCase() && x.ativo; });
    if (!p) return { autorizado: false };
    var escolas = DB.perfil_escola.filter(function (pe) { return pe.perfil_id === p.id; })
      .map(function (pe) { var e = DB.escolas.find(function (e) { return e.id === pe.escola_id; }); return e ? { id: e.id, nome: e.nome, vinculo: pe.vinculo } : null; })
      .filter(Boolean);
    var sistemas = DB.sistemas.filter(function (s) { return s.ativo; }).map(function (s) {
      var telas = {};
      DB.telas.filter(function (t) { return t.sistema_id === s.id; }).forEach(function (t) {
        var ver = false, editar = false, exportar = false;
        if (p.is_super_admin) { ver = editar = exportar = true; }
        else {
          var pt = DB.perfil_tela.find(function (x) { return x.perfil_id === p.id && x.tela_id === t.id; });
          if (pt) { ver = pt.pode_ver; editar = pt.pode_editar; exportar = pt.pode_exportar; }
        }
        if (ver) telas[t.slug] = { nome: t.nome, ver: ver, editar: editar, exportar: exportar };
      });
      if (!p.is_super_admin && Object.keys(telas).length === 0) return null;
      return { slug: s.slug, nome: s.nome, url: s.url, icone: s.icone, cor: s.cor, papel: p.is_super_admin ? 'admin' : 'perfil', telas: telas };
    }).filter(Boolean);
    return { autorizado: true, perfil: { id: p.id, nome: p.nome, email: p.email, tipo: p.tipo, is_super_admin: p.is_super_admin }, escolas: escolas, sistemas: sistemas };
  }

  // ---- Cliente Supabase falso ----------------------------------------------
  window.ACESSO_SB = {
    from: function (table) { return new Builder(table); },
    rpc: function (fn, args) {
      if (fn === 'permissoes_de') return Promise.resolve({ data: permissoesDe(args.p_email), error: null });
      if (fn === 'minhas_permissoes') return Promise.resolve({ data: permissoesDe('desenv.sme@gmail.com'), error: null });
      return Promise.resolve({ data: null, error: null });
    }
  };

  // Perfil (super admin) que "abre" o painel na demo.
  window.ACESSO_DEMO_PERFIL = { id: 1, nome: 'Administração SME (DEMO)', email: 'desenv.sme@gmail.com', tipo: 'secretaria', is_super_admin: true };
  window.ACESSO_DEMO_DB = DB;
})();
