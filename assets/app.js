'use strict';
(function () {
  // ---------- 對照表 ----------
  var TZ = 'Asia/Taipei';
  var STAGES = [
    ['interested', '有興趣'], ['quoting', '詢價中'], ['preparing', '備標中'],
    ['submitted', '已投標'], ['awaiting', '待開標'], ['won', '得標'], ['lost', '未得標']
  ];
  var STAGE_LABEL = {};
  STAGES.forEach(function (s) { STAGE_LABEL[s[0]] = s[1]; });
  var KANBAN = [
    { key: 'interested', label: '有興趣', stages: ['interested'] },
    { key: 'quoting', label: '詢價中', stages: ['quoting'] },
    { key: 'preparing', label: '備標中', stages: ['preparing'] },
    { key: 'submitted', label: '已投標', stages: ['submitted'] },
    { key: 'awaiting', label: '待開標', stages: ['awaiting'] },
    { key: 'done', label: '得標／未得標', stages: ['won', 'lost'] }
  ];
  var BUCKET = { tender: '招標中', inquiry: '公開徵求', preview: '公開閱覽', closed_pending: '已截止待結果', awarded: '已決標', failed: '無法決標' };
  var BUCKET_ORDER = ['tender', 'inquiry', 'preview', 'closed_pending', 'awarded', 'failed'];
  var CAT = { valve: '閥', pipe: '鋼管', fitting: '管配件', other: '其他' };
  var CAT_ORDER = ['valve', 'pipe', 'fitting', 'other', null];
  var NOTICE = { formal: '正式招標', inquiry: '公開徵求', preview: '公開閱覽', result: '結果公告', award: '決標公告' };
  var EXCL = { user: '人工排除', out_of_scope: '範圍外', below_threshold: '低於門檻' };
  var REL = { inquiry_of: '對應的徵求案', tender_of: '對應的正式招標', retender_of: '前次流標或廢標' };
  var VERIFY = { official: ['已核', 'v-ok'], local: ['待核', 'v-warn'], guess: ['推測', 'v-guess'] };
  var STUCK_DAYS = { quoting: 5, interested: 7, preparing: 7, submitted: 7 };
  var H = 3600 * 1000, D = 24 * H;

  var DATA = null, ALL = [], ACTIVE = [], EXCLUDED = [], NOW = new Date();
  var rendered = {};

  // ---------- 工具 ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    append(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function append(el, kids) {
    kids.forEach(function (k) {
      if (k == null || k === false) return;
      if (Array.isArray(k)) append(el, k);
      else el.append(k instanceof Node ? k : String(k));
    });
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, text) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = String(text);
    return el;
  }
  function pd(v) {
    if (!v) return null;
    var d = new Date(String(v).replace(/(\.\d{3})\d+/, '$1'));
    return isNaN(d.getTime()) ? null : d;
  }
  var fDate = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var fDT = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var fKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var fWd = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, weekday: 'short' });
  function dayKey(d) { return d ? fKey.format(d) : null; }
  function fmtDate(d) { return d ? fDate.format(d) : null; }
  function fmtDT(d) { return d ? fDT.format(d) : null; }
  function money(n) { return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('zh-TW') + ' 元' : null; }
  function moneyShort(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '預算未公告';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 億元';
    if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('zh-TW') + ' 萬元';
    return n.toLocaleString('zh-TW') + ' 元';
  }
  function txt(v, fb) { return (v == null || v === '') ? fb : String(v); }
  function caseName(c) { return txt(c.title, '（案名未載）'); }
  function remainInfo(c) {
    if (!c._dl) return { text: '無截止資料', cls: '' };
    var ms = c._dl - NOW;
    if (ms <= 0) return { text: '已截止', cls: '' };
    var hours = Math.floor(ms / H), days = Math.floor(ms / D);
    var t = days >= 1 ? '剩 ' + days + ' 天 ' + (hours - days * 24) + ' 小時' : '剩 ' + hours + ' 小時 ' + Math.floor((ms % H) / 60000) + ' 分';
    if (ms <= 48 * H) return { text: t, cls: 'urgent', badge: '48小時內' };
    if (ms <= 7 * D) return { text: t, cls: 'soon', badge: '7天內' };
    return { text: t, cls: '' };
  }
  function isOpenNow(c) { return (c.bucket === 'tender' || c.bucket === 'inquiry') && c._dl && c._dl > NOW; }
  function vtag(c, field) {
    var v = c.verify && c.verify[field];
    var m = v && VERIFY[v];
    return m ? h('span', { class: 'v ' + m[1] }, m[0]) : null;
  }
  function vtagVal(v) { var m = v && VERIFY[v]; return m ? h('span', { class: 'v ' + m[1] }, m[0]) : null; }
  function safeUrl(u) { return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null; }
  function bucketLabel(b) { return b ? (BUCKET[b] || b) : '狀態未取得'; }
  function catLabel(k) { return k ? (CAT[k] || k) : '未分類'; }

  // ---------- 載入 ----------
  function load() {
    fetch('data/dashboard-data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(init)
      .catch(function (e) {
        var m = document.getElementById('loadmsg');
        m.textContent = '資料讀取失敗（' + e.message + '）。請確認 data/dashboard-data.json 存在，並以網頁伺服器開啟。';
        m.className = 'loadmsg err';
      });
  }

  function init(data) {
    DATA = data || {};
    ALL = Array.isArray(DATA.cases) ? DATA.cases : [];
    ALL.forEach(function (c, i) {
      c._i = i;
      c._dl = pd(c.deadline);
      c._open = pd(c.opening_at);
      c._pub = pd(c.published_at);
      c._since = pd(c.stage_since);
      c._search = [c.case_no, c.title, c.agency, c.key_spec, c.quantity].filter(Boolean).join(' ').toLowerCase();
    });
    ACTIVE = ALL.filter(function (c) { return c.excluded === false || c.excluded == null; });
    EXCLUDED = ALL.filter(function (c) { return c.excluded === true; });

    var asof = pd(DATA.data_as_of);
    document.getElementById('asof').textContent = '資料截至 ' + (fmtDT(asof) || '時間未載') + '　·　倒數依您的瀏覽器時間計算';
    document.getElementById('coverage').hidden = DATA.coverage !== 'partial';
    document.getElementById('loadmsg').remove();

    window.addEventListener('hashchange', route);
    document.getElementById('overlay').addEventListener('click', closeCase);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCase(); });
    route();
  }

  function route() {
    var v = (location.hash || '#home').slice(1);
    if (['home', 'pool', 'charts'].indexOf(v) < 0) v = 'home';
    ['home', 'pool', 'charts'].forEach(function (k) {
      document.getElementById('view-' + k).hidden = k !== v;
      var a = document.querySelector('.tabs a[data-view="' + k + '"]');
      if (k === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!rendered[v]) { rendered[v] = true; ({ home: renderHome, pool: renderPool, charts: renderCharts })[v](); }
  }

  // ---------- 案件卡 ----------
  function card(c, extra) {
    var r = remainInfo(c);
    var badges = [];
    if (r.badge) badges.push(h('span', { class: 'badge ' + (r.cls === 'urgent' ? 'b-red' : 'b-amber') }, r.badge));
    (extra || []).forEach(function (b) { badges.push(b); });
    return h('button', { type: 'button', class: 'card ' + r.cls, onclick: function () { openCase(c); } },
      h('div', { class: 'row1' }, h('span', { class: 'no' }, txt(c.case_no, '案號未載')), badges),
      h('div', { class: 'title' }, caseName(c)),
      h('div', { class: 'agency' }, txt(c.agency, '機關未載')),
      h('div', { class: 'row3' }, h('span', null, moneyShort(c.budget)), h('span', { class: 'remain' }, r.text))
    );
  }
  function cardList(list, extraFn, emptyText) {
    if (!list.length) return h('p', { class: 'empty' }, emptyText || '目前沒有案件');
    return h('div', { class: 'cards' }, list.map(function (c) { return card(c, extraFn ? extraFn(c) : null); }));
  }

  function foldList(list, n, extraFn, emptyText) {
    if (list.length <= n) return cardList(list, extraFn, emptyText);
    var box = h('div');
    var full = false;
    function draw() {
      box.textContent = '';
      box.append(cardList(full ? list : list.slice(0, n), extraFn, emptyText),
        h('div', { class: 'more' }, h('button', { type: 'button', onclick: function () { full = !full; draw(); } },
          full ? '只顯示前 ' + n + ' 件' : '顯示全部 ' + list.length + ' 件（尚有 ' + (list.length - n) + ' 件）')));
    }
    draw();
    return box;
  }

  // ---------- 首頁 ----------
  function newCases() {
    var asof = pd(DATA.data_as_of);
    if (!asof) return [];
    var k0 = dayKey(asof), k1 = dayKey(new Date(asof.getTime() - D));
    return ACTIVE.filter(function (c) {
      var k = dayKey(c._pub);
      return (k === k0 || k === k1) && (c.bucket === 'tender' || c.bucket === 'inquiry');
    }).sort(byDeadline);
  }
  function byDeadline(a, b) {
    if (a._dl && b._dl) return a._dl - b._dl;
    if (a._dl) return -1;
    if (b._dl) return 1;
    return 0;
  }

  function renderHome() {
    var root = document.getElementById('view-home');
    var open = ACTIVE.filter(isOpenNow).sort(byDeadline);
    var in48 = open.filter(function (c) { return c._dl - NOW <= 48 * H; });
    var nw = newCases();
    var prep = ACTIVE.filter(function (c) { return c.stage === 'preparing'; });
    var subm = ACTIVE.filter(function (c) { return c.stage === 'submitted' || c.stage === 'awaiting'; });
    var q = DATA.quota || {};

    function stat(label, value, sub, alert) {
      return h('div', { class: 'stat' + (alert ? ' alert' : '') },
        h('div', { class: 'label' }, label),
        h('div', { class: 'value' }, value, sub ? h('small', null, sub) : null));
    }
    var quotaVal = (q.remaining != null) ? String(q.remaining) : '—';
    var quotaSub = (q.limit != null) ? ' / ' + q.limit : ' / 未載';
    root.append(h('div', { class: 'stats' },
      stat('48 小時內截標', String(in48.length), ' 件', in48.length > 0),
      stat('新案件（近兩日公告）', String(nw.length), ' 件'),
      stat('備標中', String(prep.length), ' 件'),
      stat('已投標與待開標', String(subm.length), ' 件'),
      stat('閱覽額度剩餘' + (q.month ? '（' + q.month + '）' : ''), quotaVal, quotaSub)
    ));

    var i2t = ACTIVE.filter(function (c) { return c.inquiry_to_tender === true; });
    if (i2t.length) {
      root.append(h('div', { class: 'banner', role: 'alert' },
        h('h2', null, '最高優先：已關注的徵求案已正式招標（' + i2t.length + ' 件）'),
        cardList(i2t, function () { return [h('span', { class: 'badge b-violet' }, '徵求轉招標')]; })));
    }

    // 左欄
    var left = h('div', null,
      h('h2', { class: 'col-title' }, '機會'),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', null, '截標倒數（' + open.length + ' 件）'),
          h('span', { class: 'note' }, '招標中與公開徵求、尚未截止')),
        foldList(open, 10, function (c) { return c.deadline_time_default ? [h('span', { class: 'badge b-gray' }, '預設17:00')] : null; }, '目前沒有未截止的案件')),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', null, '新案（' + nw.length + ' 件）'),
          h('span', { class: 'note' }, '公告日為資料截至日或前一日')),
        cardList(nw, function (c) {
          var b = [h('span', { class: 'badge b-blue' }, bucketLabel(c.bucket))];
          if (c.bucket === 'tender' && c.failed_count > 0) b.push(h('span', { class: 'badge b-amber' }, '流標續招'));
          return b;
        }, '近兩日沒有新公告的招標中或公開徵求案件'))
    );

    // 右欄：看板
    var cols = KANBAN.map(function (col) {
      var list = ACTIVE.filter(function (c) { return col.stages.indexOf(c.stage) >= 0; })
        .sort(function (a, b) { return (a._since || 0) - (b._since || 0); });
      var det = h('details', { class: 'kcol', open: list.length > 0 || window.innerWidth >= 1024 },
        h('summary', null, h('span', null, col.label), h('span', { class: 'dim' }, list.length + ' 件')),
        cardList(list, function (c) {
          var b = [];
          if (col.key === 'done') b.push(h('span', { class: 'badge ' + (c.stage === 'won' ? 'b-green' : 'b-gray') }, STAGE_LABEL[c.stage]));
          var lim = STUCK_DAYS[c.stage];
          if (lim && c._since) {
            var days = Math.floor((NOW - c._since) / D);
            if (days > lim) b.push(h('span', { class: 'badge b-red' }, '卡住：停留 ' + days + ' 天'));
          }
          return b;
        }, '無'));
      return det;
    });
    var right = h('div', null,
      h('h2', { class: 'col-title' }, '進度'),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', null, '進度看板'),
          h('span', { class: 'note' }, '詢價中逾 5 天、其他階段逾 7 天標示「卡住」')),
        h('div', { class: 'kanban' }, cols)));

    root.append(h('div', { class: 'home-grid' }, left, right));
    root.append(h('div', { class: 'panel timeline', style: 'margin-top:16px' }, timeline()));
  }

  function timeline() {
    var start = new Date(dayKey(NOW) + 'T00:00:00+08:00');
    var DAYS = 30;
    var days = [];
    for (var i = 0; i < DAYS; i++) {
      var d = new Date(start.getTime() + i * D);
      days.push({ d: d, k: dayKey(d), dead: [], open: [] });
    }
    var idx = {};
    days.forEach(function (x, i) { idx[x.k] = i; });
    ACTIVE.forEach(function (c) {
      var kd = dayKey(c._dl), ko = dayKey(c._open);
      if (kd in idx && c._dl >= start) days[idx[kd]].dead.push(c);
      if (ko in idx && c._open >= start) days[idx[ko]].open.push(c);
    });
    var W = 1000, PAD = 20, colW = (W - PAD * 2) / DAYS, AX = 90;
    var maxN = Math.max(1, Math.max.apply(null, days.map(function (x) { return Math.max(x.dead.length, x.open.length); })));
    var unit = Math.min(14, 60 / maxN);
    var svg = s('svg', { viewBox: '0 0 ' + W + ' 190', role: 'img', 'aria-label': '未來 30 天截標與開標時間軸' });
    svg.append(s('line', { x1: PAD, x2: W - PAD, y1: AX, y2: AX, class: 'tl-axis' }));
    days.forEach(function (x, i) {
      var cx = PAD + colW * i + colW / 2;
      svg.append(s('line', { x1: cx, x2: cx, y1: AX - 3, y2: AX + 3, class: i === 0 ? 'tl-today' : 'tl-tick' }));
      var dt = x.d;
      var md = x.k.slice(5).replace('-', '/');
      if (i === 0 || i % 3 === 0) svg.append(s('text', { x: cx, y: 180, 'text-anchor': 'middle', class: 'tl-label' }, i === 0 ? '今天' : md));
      if (x.dead.length) {
        var hgt = Math.max(4, unit * x.dead.length);
        var g = s('g');
        g.append(s('title', null, md + ' 截標 ' + x.dead.length + ' 件'));
        g.append(s('rect', { x: cx - colW * 0.3, y: AX - 6 - hgt, width: colW * 0.6, height: hgt, rx: 3, class: 'tl-dead' }));
        g.append(s('text', { x: cx, y: AX - 10 - hgt, 'text-anchor': 'middle', class: 'tl-count' }, x.dead.length));
        svg.append(g);
      }
      if (x.open.length) {
        var hg2 = Math.max(4, unit * x.open.length);
        var g2 = s('g');
        g2.append(s('title', null, md + ' 開標 ' + x.open.length + ' 件'));
        g2.append(s('rect', { x: cx - colW * 0.3, y: AX + 6, width: colW * 0.6, height: hg2, class: 'tl-open' }));
        g2.append(s('text', { x: cx, y: AX + 18 + hg2, 'text-anchor': 'middle', class: 'tl-count' }, x.open.length));
        svg.append(g2);
      }
      void dt;
    });
    var list = days.filter(function (x) { return x.dead.length || x.open.length; }).map(function (x) {
      var md = x.k.slice(5).replace('-', '/') + '（' + fWd.format(x.d).replace('週', '') + '）';
      function links(arr) {
        return arr.map(function (c, j) {
          return [j ? '、' : '', h('button', { type: 'button', class: 'linkbtn', onclick: function () { openCase(c); } }, txt(c.case_no, '案號未載'))];
        });
      }
      return h('div', { class: 'tl-day' }, h('b', null, md),
        x.dead.length ? h('div', null, h('span', { class: 'badge b-red' }, '截標'), ' ', links(x.dead)) : null,
        x.open.length ? h('div', null, h('span', { class: 'badge b-blue' }, '開標'), ' ', links(x.open)) : null);
    });
    return [
      h('div', { class: 'panel-head' }, h('h3', null, '未來 30 天時間軸'),
        h('div', { class: 'legend' },
          h('span', null, h('span', { class: 'sw dead' }), '軸上方：截標'),
          h('span', null, h('span', { class: 'sw open' }), '軸下方：開標'))),
      svg,
      list.length ? h('div', { class: 'tl-list' }, list) : h('p', { class: 'empty' }, '未來 30 天沒有截標或開標')
    ];
  }

  // ---------- 案件池 ----------
  function poolSort(a, b) {
    // 尚未截止者依截止時間由近到遠，其次已截止者依最近截止，最後為無截止時間
    var ga = !a._dl ? 2 : (a._dl > NOW ? 0 : 1), gb = !b._dl ? 2 : (b._dl > NOW ? 0 : 1);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return a._dl - b._dl;
    if (ga === 1) return b._dl - a._dl;
    return 0;
  }

  function renderPool() {
    var root = document.getElementById('view-pool');
    var activeBox = h('div');
    var exclBox = h('div', { hidden: true });
    var exclDone = false;
    var btnA = h('button', { type: 'button', 'aria-pressed': 'true' }, '有效案件（' + ACTIVE.length + '）');
    var btnE = h('button', { type: 'button', 'aria-pressed': 'false' }, '已排除（' + EXCLUDED.length + '）');
    btnA.onclick = function () { btnA.setAttribute('aria-pressed', 'true'); btnE.setAttribute('aria-pressed', 'false'); activeBox.hidden = false; exclBox.hidden = true; };
    btnE.onclick = function () {
      btnE.setAttribute('aria-pressed', 'true'); btnA.setAttribute('aria-pressed', 'false'); activeBox.hidden = true; exclBox.hidden = false;
      if (!exclDone) { exclDone = true; buildPool(exclBox, EXCLUDED, true); }
    };
    root.append(h('div', { class: 'subtabs' }, btnA, btnE), activeBox, exclBox);
    buildPool(activeBox, ACTIVE, false);
  }

  function buildPool(box, src, isExcl) {
    var agCount = {};
    src.forEach(function (c) { var a = txt(c.agency, ''); if (a) agCount[a] = (agCount[a] || 0) + 1; });
    var ags = Object.keys(agCount).sort(function (a, b) { return agCount[b] - agCount[a] || a.localeCompare(b, 'zh-Hant'); });

    function sel(label, opts) {
      var el = h('select', null, opts.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
      return { el: el, wrap: h('label', null, label, el) };
    }
    var kw = h('input', { type: 'search', placeholder: '案名、案號、機關、規範' });
    var fCat = sel('類別', [['', '全部']].concat(CAT_ORDER.map(function (k) { return [k || '__null', catLabel(k)]; })));
    var fAg = sel('機關', [['', '全部（' + ags.length + ' 個）']].concat(ags.map(function (a) { return [a, a + '（' + agCount[a] + '）']; })));
    var fSt = sel('狀態', [['', '全部']].concat(BUCKET_ORDER.map(function (k) { return [k, BUCKET[k]]; })).concat([['__null', '狀態未取得']]));
    var fMin = h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: '不限' });
    var fMax = h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: '不限' });
    var fFail = sel('是否流標過', [['', '全部'], ['y', '是'], ['n', '否']]);
    var fReason = isExcl ? sel('排除原因', [['', '全部']].concat(Object.keys(EXCL).map(function (k) { return [k, EXCL[k]]; }))) : null;
    var reset = h('button', { type: 'button', class: 'reset' }, '清除篩選');

    var filters = h('div', { class: 'filters' },
      h('label', { class: 'kw' }, '關鍵字', kw), fCat.wrap, fAg.wrap, fSt.wrap,
      h('label', null, '預算下限（萬元）', fMin), h('label', null, '預算上限（萬元）', fMax),
      fReason ? fReason.wrap : fFail.wrap, fReason ? fFail.wrap : reset);
    if (fReason) filters.append(reset);
    var countLine = h('p', { class: 'count-line' });
    var tbody = h('tbody');
    var cols = ['案號', '案名', '機關', '類別', '預算', '狀態', '截標日'];
    if (isExcl) cols.push('排除原因');
    var table = h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { class: c === '預算' ? 'num' : null }, c); }))), tbody);
    var more = h('div', { class: 'more' });
    box.append(h('div', { class: 'panel' }, filters, countLine, table, more));

    var PAGE = 200, shown = PAGE, current = [];
    function apply() {
      var k = kw.value.trim().toLowerCase();
      var kws = k ? k.split(/\s+/) : [];
      var cat = fCat.el.value, ag = fAg.el.value, st = fSt.el.value, fl = fFail.el.value;
      var rs = fReason ? fReason.el.value : '';
      var mn = fMin.value === '' ? null : Number(fMin.value) * 1e4;
      var mx = fMax.value === '' ? null : Number(fMax.value) * 1e4;
      current = src.filter(function (c) {
        if (kws.length && !kws.every(function (w) { return c._search.indexOf(w) >= 0; })) return false;
        if (cat && (cat === '__null' ? c.category != null : c.category !== cat)) return false;
        if (ag && c.agency !== ag) return false;
        if (st && (st === '__null' ? c.bucket != null : c.bucket !== st)) return false;
        if (fl === 'y' && !(c.failed_count > 0)) return false;
        if (fl === 'n' && c.failed_count > 0) return false;
        if (rs && c.exclude_reason !== rs) return false;
        if ((mn != null || mx != null)) {
          if (typeof c.budget !== 'number') return false;
          if (mn != null && c.budget < mn) return false;
          if (mx != null && c.budget > mx) return false;
        }
        return true;
      }).sort(poolSort);
      shown = PAGE;
      draw();
    }
    function draw() {
      var withBudget = current.filter(function (c) { return typeof c.budget === 'number'; });
      var sum = withBudget.reduce(function (a, c) { return a + c.budget; }, 0);
      countLine.textContent = '共 ' + current.length + ' 筆　·　已公告預算 ' + withBudget.length + ' 筆，合計 ' + moneyShort(sum) + '（僅計已公告預算）　·　排序：未截止者由近到遠，其次已截止，無截止時間排最後';
      tbody.textContent = '';
      var frag = document.createDocumentFragment();
      current.slice(0, shown).forEach(function (c) {
        var r = remainInfo(c);
        var dlCell = c._dl ? [fmtDT(c._dl), c.deadline_time_default ? h('div', null, h('span', { class: 'badge b-gray' }, '預設17:00')) : null,
          r.badge && isOpenNow(c) ? h('div', null, h('span', { class: 'badge ' + (r.cls === 'urgent' ? 'b-red' : 'b-amber') }, r.badge)) : null] : '無截止資料';
        var tr = h('tr', { onclick: function () { openCase(c); } },
          h('td', { 'data-label': '案號', class: 'mono nowrap' }, h('button', { type: 'button', class: 'linkbtn', onclick: function (e) { e.stopPropagation(); openCase(c); } }, txt(c.case_no, '案號未載'))),
          h('td', { 'data-label': '案名' }, caseName(c), c.failed_count > 0 ? [' ', h('span', { class: 'badge b-amber' }, '流標 ' + c.failed_count + ' 次')] : null),
          h('td', { 'data-label': '機關' }, txt(c.agency, '機關未載')),
          h('td', { 'data-label': '類別', class: 'nowrap' }, catLabel(c.category)),
          h('td', { 'data-label': '預算', class: 'num' }, money(c.budget) || '未公告'),
          h('td', { 'data-label': '狀態', class: 'nowrap' }, bucketLabel(c.bucket)),
          h('td', { 'data-label': '截標日', class: 'nowrap' }, dlCell),
          isExcl ? h('td', { 'data-label': '排除原因' }, c.exclude_reason ? (EXCL[c.exclude_reason] || c.exclude_reason) : '原因未載') : null);
        frag.append(tr);
      });
      tbody.append(frag);
      more.textContent = '';
      if (current.length > shown) {
        more.append(h('button', { type: 'button', onclick: function () { shown += PAGE; draw(); } }, '再顯示 ' + Math.min(PAGE, current.length - shown) + ' 筆（尚有 ' + (current.length - shown) + ' 筆）'));
      }
      if (!current.length) more.append(h('p', { class: 'empty' }, '沒有符合條件的案件'));
    }
    var t;
    kw.addEventListener('input', function () { clearTimeout(t); t = setTimeout(apply, 150); });
    [fCat.el, fAg.el, fSt.el, fFail.el, fReason && fReason.el].forEach(function (el) { if (el) el.addEventListener('change', apply); });
    [fMin, fMax].forEach(function (el) { el.addEventListener('input', function () { clearTimeout(t); t = setTimeout(apply, 250); }); });
    reset.addEventListener('click', function () {
      kw.value = ''; fMin.value = ''; fMax.value = '';
      [fCat.el, fAg.el, fSt.el, fFail.el, fReason && fReason.el].forEach(function (el) { if (el) el.value = ''; });
      apply();
    });
    apply();
  }

  // ---------- 情報圖表 ----------
  function budgetSum(list) { return list.reduce(function (a, c) { return a + (typeof c.budget === 'number' ? c.budget : 0); }, 0); }

  function renderCharts() {
    var root = document.getElementById('view-charts');
    root.append(h('div', { class: 'charts-grid' },
      h('div', { class: 'panel wide' }, heatmap()),
      h('div', { class: 'panel wide' }, trend()),
      h('div', { class: 'panel' }, failedView()),
      h('div', { class: 'panel' }, stageStats())
    ));
  }

  function heatmap() {
    var agCount = {};
    ACTIVE.forEach(function (c) { if (c.agency) agCount[c.agency] = (agCount[c.agency] || 0) + 1; });
    var top = Object.keys(agCount).sort(function (a, b) { return agCount[b] - agCount[a] || a.localeCompare(b, 'zh-Hant'); }).slice(0, 12);
    var cells = {}, maxB = 0, maxN = 0;
    top.forEach(function (a) {
      cells[a] = {};
      CAT_ORDER.forEach(function (k) {
        var list = ACTIVE.filter(function (c) { return c.agency === a && (c.category || null) === k; });
        var b = budgetSum(list);
        cells[a][k] = { n: list.length, b: b };
        if (b > maxB) maxB = b;
        if (list.length > maxN) maxN = list.length;
      });
    });
    var rows = top.map(function (a) {
      return h('tr', null, h('th', { class: 'ag', scope: 'row' }, a, h('span', { class: 'dim' }, '（' + agCount[a] + '）')),
        CAT_ORDER.map(function (k) {
          var x = cells[a][k];
          if (!x.n) return h('td', { class: 'zero' }, '0');
          var byCount = x.b <= 0;
          var alpha = byCount ? 0.12 + 0.6 * (x.n / maxN) : 0.15 + 0.8 * Math.sqrt(x.b / maxB);
          var td = h('td', { class: alpha > 0.55 ? 'dk' : null, title: a + '・' + catLabel(k) + '：' + x.n + ' 件，' + (byCount ? '預算全未公告' : '已公告預算 ' + money(x.b)) },
            x.n + (byCount ? '＊' : ''), h('small', null, byCount ? '預算未公告' : moneyShort(x.b)));
          td.style.setProperty('--a', alpha.toFixed(3));
          return td;
        }));
    });
    return [
      h('div', { class: 'panel-head' }, h('h2', null, '機關 × 類別熱力圖'),
        h('span', { class: 'note' }, '案件數前 12 名機關。格內為件數與已公告預算合計；顏色深淺依已公告預算合計（僅計已公告預算），標「＊」者預算全未公告，深淺改依件數。')),
      top.length ? h('div', { class: 'heat-wrap' }, h('table', { class: 'heat' },
        h('thead', null, h('tr', null, h('th', { class: 'ag' }, '機關（件數）'), CAT_ORDER.map(function (k) { return h('th', null, catLabel(k)); }))),
        h('tbody', null, rows))) : h('p', { class: 'empty' }, '沒有資料')
    ];
  }

  function barChart(months, vals, fmtVal, cls, title) {
    var W = 1000, HH = 200, L = 20, R = 20, T = 24, B = 30;
    var max = Math.max.apply(null, vals.concat([0]));
    var bw = (W - L - R) / months.length;
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + HH, role: 'img', 'aria-label': title });
    svg.append(s('line', { x1: L, x2: W - R, y1: HH - B, y2: HH - B, class: 'c-axis' }));
    months.forEach(function (m, i) {
      var v = vals[i], x = L + bw * i;
      var bh = max > 0 ? (HH - T - B) * v / max : 0;
      var g = s('g');
      g.append(s('title', null, m + '：' + fmtVal(v)));
      if (v > 0) g.append(s('rect', { x: x + bw * 0.18, y: HH - B - bh, width: bw * 0.64, height: Math.max(bh, 1), rx: 2, class: cls }));
      g.append(s('text', { x: x + bw / 2, y: HH - B - bh - 6, 'text-anchor': 'middle', class: 'c-val' }, fmtVal(v)));
      g.append(s('text', { x: x + bw / 2, y: HH - 10, 'text-anchor': 'middle', class: 'c-label' }, m));
      svg.append(g);
    });
    return svg;
  }

  function trend() {
    var asof = pd(DATA.data_as_of) || NOW;
    var k = dayKey(asof), y = +k.slice(0, 4), mo = +k.slice(5, 7);
    var months = [];
    for (var i = 11; i >= 0; i--) {
      var mm = mo - i, yy = y;
      while (mm <= 0) { mm += 12; yy -= 1; }
      months.push(yy + '-' + (mm < 10 ? '0' : '') + mm);
    }
    var cnt = months.map(function () { return 0; }), bud = months.map(function () { return 0; });
    var outside = 0, noPub = 0;
    ACTIVE.forEach(function (c) {
      var dk = dayKey(c._pub);
      if (!dk) { noPub++; return; }
      var j = months.indexOf(dk.slice(0, 7));
      if (j < 0) { outside++; return; }
      cnt[j]++;
      if (typeof c.budget === 'number') bud[j] += c.budget;
    });
    var labels = months.map(function (m) { return m.replace('-', '/'); });
    return [
      h('div', { class: 'panel-head' }, h('h2', null, '每月趨勢（依公告月份）'),
        h('span', { class: 'note' }, '近 12 個月有效案件。' + (outside ? '另有 ' + outside + ' 件公告日在此範圍外。' : '') + (noPub ? '另有 ' + noPub + ' 件公告日未載。' : ''))),
      h('h3', { class: 'sub-title' }, '新案件數'),
      h('div', { class: 'chart' }, barChart(labels, cnt, function (v) { return String(v); }, 'c-bar', '每月新案件數')),
      h('h3', { class: 'sub-title' }, '已公告預算合計（僅計已公告預算）'),
      h('div', { class: 'chart' }, barChart(labels, bud, function (v) { return v ? moneyShort(v).replace('元', '') : '0'; }, 'c-bar2', '每月已公告預算合計'))
    ];
  }

  function hbars(entries, emptyText) {
    if (!entries.length) return h('p', { class: 'empty' }, emptyText || '沒有資料');
    var max = Math.max.apply(null, entries.map(function (e) { return e[1]; }));
    return h('div', { class: 'hbars' }, entries.map(function (e) {
      var fill = h('div', { class: 'fill' });
      fill.style.width = (100 * e[1] / max).toFixed(1) + '%';
      return h('div', { class: 'hbar' }, h('span', { class: 'name' }, e[0]), h('div', { class: 'track' }, fill), h('span', { class: 'n' }, e[1]));
    }));
  }

  function failedView() {
    var f = ACTIVE.filter(function (c) { return c.bucket === 'failed'; });
    var byAg = {}, byCat = {};
    f.forEach(function (c) {
      var a = txt(c.agency, '機關未載'); byAg[a] = (byAg[a] || 0) + 1;
      var k = catLabel(c.category); byCat[k] = (byCat[k] || 0) + 1;
    });
    var agE = Object.keys(byAg).map(function (k) { return [k, byAg[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var catE = CAT_ORDER.map(function (k) { return [catLabel(k), byCat[catLabel(k)] || 0]; }).filter(function (e) { return e[1] > 0; });
    var topF = f.filter(function (c) { return c.failed_count > 0; }).sort(function (a, b) { return b.failed_count - a.failed_count || byDeadline(a, b); }).slice(0, 10);
    return [
      h('div', { class: 'panel-head' }, h('h2', null, '流標觀察'), h('span', { class: 'note' }, '無法決標案件 ' + f.length + ' 件')),
      h('h3', { class: 'sub-title' }, '依機關（前 10）'), hbars(agE.slice(0, 10)),
      agE.length > 10 ? h('p', { class: 'note' }, '其餘 ' + (agE.length - 10) + ' 個機關未列出') : null,
      h('h3', { class: 'sub-title' }, '依類別'), hbars(catE),
      h('h3', { class: 'sub-title' }, '流標／廢標次數最高'),
      topF.length ? h('ul', { class: 'plain' }, topF.map(function (c) {
        return h('li', null, h('span', { class: 'badge b-amber' }, c.failed_count + ' 次'), ' ',
          h('button', { type: 'button', class: 'linkbtn', onclick: function () { openCase(c); } }, txt(c.case_no, '案號未載') + '　' + caseName(c)),
          h('div', { class: 'dim' }, txt(c.agency, '機關未載')));
      })) : h('p', { class: 'empty' }, '沒有流標次數資料')
    ];
  }

  function stageStats() {
    var rows = STAGES.map(function (st) {
      var list = ACTIVE.filter(function (c) { return c.stage === st[0]; });
      var wb = list.filter(function (c) { return typeof c.budget === 'number'; }).length;
      return h('tr', null, h('td', { 'data-label': '階段' }, st[1]), h('td', { 'data-label': '件數', class: 'num' }, list.length),
        h('td', { 'data-label': '預算合計', class: 'num' }, wb ? money(budgetSum(list)) : '—'),
        h('td', { 'data-label': '有預算', class: 'num' }, wb + ' / ' + list.length));
    });
    var none = ACTIVE.filter(function (c) { return !c.stage; }).length;
    return [
      h('div', { class: 'panel-head' }, h('h2', null, '各階段統計'), h('span', { class: 'note' }, '預算僅計已公告預算')),
      h('table', { class: 'list stage-table' },
        h('thead', null, h('tr', null, h('th', null, '階段'), h('th', { class: 'num' }, '件數'), h('th', { class: 'num' }, '已公告預算合計'), h('th', { class: 'num' }, '有預算／件數'))),
        h('tbody', null, rows)),
      h('p', { class: 'note' }, '未設定階段的有效案件 ' + none + ' 件')
    ];
  }

  // ---------- 案件頁 ----------
  var lastFocus = null;
  function kv(label, value, tag) {
    return [h('dt', null, label), h('dd', null, value, tag)];
  }
  function relItem(r, guess) {
    var url = safeUrl(r.source_url);
    var label = (REL[r.type] || r.type || '關聯') + '：';
    var body = [txt(r.agency, '機關未載'), '　', txt(r.case_no, '案號未載'),
      r.notice_type ? '（' + (NOTICE[r.notice_type] || r.notice_type) + '）' : '',
      r.published_at ? '　公告 ' + fmtDate(pd(r.published_at)) : ''];
    return h('li', null, h('b', null, label), body,
      guess ? h('span', { class: 'v v-guess' }, '推測') : vtagVal(r.verify),
      url ? [' ', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, '原頁')] : null);
  }
  function fmtAny(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v.toLocaleString('zh-TW');
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { var d = pd(v); return d ? fmtDate(d) : v; }
    if (typeof v === 'object') return null;
    return String(v);
  }

  function openCase(c) {
    lastFocus = document.activeElement;
    var dr = document.getElementById('drawer');
    dr.textContent = '';
    var none = function (t) { return h('span', { class: 'dim' }, t); };

    var dl = c._dl ? [fmtDT(c._dl), c.deadline_time_default ? [' ', h('span', { class: 'badge b-gray' }, '預設17:00')] : null,
      isOpenNow(c) ? [' ', h('span', { class: 'dim' }, '（' + remainInfo(c).text + '）')] : null] : none('無截止資料');

    var sec = [];
    sec.push(h('section', null, h('h3', null, '基本'), h('dl', { class: 'kv' },
      kv('機關', txt(c.agency, '機關未載'), vtag(c, 'agency')),
      kv('預算', money(c.budget) || none('未公告'), vtag(c, 'budget')),
      kv('公告日', fmtDate(c._pub) || none('公告日未載'), vtag(c, 'published_at')),
      kv('截標', dl, vtag(c, 'deadline')),
      kv('開標', fmtDT(c._open) || none('未載'), vtag(c, 'opening_at')),
      kv('公告類型', c.notice_type ? (NOTICE[c.notice_type] || c.notice_type) : none('未載'), vtag(c, 'notice_type')),
      kv('狀態', bucketLabel(c.bucket), vtag(c, 'bucket')),
      kv('類別', catLabel(c.category), vtag(c, 'category')),
      c.excluded ? kv('排除原因', c.exclude_reason ? (EXCL[c.exclude_reason] || c.exclude_reason) : none('原因未載'), vtag(c, 'exclude_reason')) : null)));

    sec.push(h('section', null, h('h3', null, '初篩摘要'), h('dl', { class: 'kv' },
      kv('數量', txt(c.quantity, '') || none('未查'), vtag(c, 'quantity')),
      kv('主要規範', txt(c.key_spec, '') || none('未查'), vtag(c, 'key_spec')))));

    sec.push(h('section', null, h('h3', null, '限制'), h('dl', { class: 'kv' },
      kv('產地', txt(c.origin_limit, '') || none('未查'), vtag(c, 'origin_limit')),
      kv('投標資格', txt(c.qualification, '') || none('未查'), vtag(c, 'qualification')))));

    var anomalies = Array.isArray(c.anomalies) ? c.anomalies.filter(Boolean) : [];
    var uniqA = anomalies.filter(function (a, i) { return anomalies.indexOf(a) === i; });
    sec.push(h('section', null, h('h3', null, '結果'), h('dl', { class: 'kv' },
      kv('結果類型', txt(c.result_kind, '') || none('尚無結果'), vtag(c, 'result_kind')),
      c.result_text && c.result_text !== c.result_kind ? kv('結果說明', c.result_text, vtag(c, 'result_text')) : null,
      kv('流標次數', typeof c.failed_count === 'number' ? c.failed_count + ' 次' : none('未載'), vtag(c, 'failed_count')),
      kv('是否續招', c.retender === true ? '是' : (c.retender === false ? '否' : none('未載')), vtag(c, 'retender')),
      kv('異常提示', uniqA.length ? h('ul', { class: 'plain' }, uniqA.map(function (a) { return h('li', null, h('span', { class: 'badge b-amber' }, '注意'), ' ', a); })) : none('無')))));

    var rel = Array.isArray(c.related) ? c.related : [], cand = Array.isArray(c.related_candidates) ? c.related_candidates : [];
    sec.push(h('section', null, h('h3', null, '關聯'),
      rel.length ? h('ul', { class: 'plain' }, rel.map(function (r) { return relItem(r, false); })) : h('p', { class: 'empty' }, '無已核實的關聯案件'),
      cand.length ? [h('p', { class: 'note', style: 'margin:8px 0 2px' }, '推測的關聯（未核實）'), h('ul', { class: 'plain' }, cand.map(function (r) { return relItem(r, true); }))] : null));

    var hist = Array.isArray(c.stage_history) ? c.stage_history : [];
    sec.push(h('section', null, h('h3', null, '進度紀錄'),
      h('dl', { class: 'kv' }, kv('目前階段', c.stage ? (STAGE_LABEL[c.stage] || c.stage) + (c._since ? '（自 ' + fmtDT(c._since) + '）' : '') : none('未設定'), vtag(c, 'stage'))),
      hist.length ? h('ul', { class: 'plain', style: 'margin-top:6px' }, hist.map(function (x) {
        return h('li', null, fmtDT(pd(x && x.at)) || '時間未載', '　', x && x.stage ? (STAGE_LABEL[x.stage] || x.stage) : '階段未載');
      })) : null));

    var aw = Array.isArray(c.award_history) ? c.award_history : [];
    if (aw.length) {
      sec.push(h('section', null, h('h3', null, '歷史決標'), h('ul', { class: 'plain' }, aw.map(function (x) {
        if (x == null || typeof x !== 'object') return h('li', null, fmtAny(x) || '');
        var parts = Object.keys(x).map(function (k) {
          if (k === 'source_url') return null;
          var v = fmtAny(x[k]); return v ? v : null;
        }).filter(Boolean);
        var u = safeUrl(x.source_url);
        return h('li', null, parts.join('　·　'), u ? [' ', h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, '原頁')] : null);
      }))));
    }

    var src = safeUrl(c.source_url);
    sec.push(h('section', null, h('h3', null, '連結'),
      src ? h('p', { style: 'margin:0' }, h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, '政府採購網原頁'), vtag(c, 'source_url')) : h('p', { class: 'empty' }, '無來源連結')));

    var closeBtn = h('button', { type: 'button', class: 'close', onclick: closeCase }, '關閉 ✕');
    dr.append(
      h('div', { class: 'drawer-head' },
        h('div', { class: 't' }, h('div', { class: 'no' }, txt(c.case_no, '案號未載'), vtag(c, 'case_no')),
          h('h2', { id: 'drawer-title' }, caseName(c), vtag(c, 'title'))),
        closeBtn),
      h('div', { class: 'drawer-body' }, sec));
    dr.hidden = false;
    document.getElementById('overlay').hidden = false;
    dr.scrollTop = 0;
    closeBtn.focus();
  }
  function closeCase() {
    var dr = document.getElementById('drawer');
    if (dr.hidden) return;
    dr.hidden = true;
    document.getElementById('overlay').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  load();
})();
