/* 水浒传 · 交互图谱、座次与结局（零依赖，单作品模块）
 *
 * 与三国的差别：水浒的主轴是「座次 + 山头 + 招安后的结局」，
 * 因此多一个座次表视图，人物卡片与详情都要标星号、座次与结局。
 */
(function () {
  'use strict';

  var D = null;
  var byId = {}, groupById = {}, placeById = {};
  var relByPerson = {}, eventsByPerson = {};
  var state = { view: 'graph', group: 'all', rel: 'all', showEvents: false, pq: '', plq: '',
    fate: 'all', rq: '' };
  var FATE_COLOR = {
    '阵亡': '#a3463f', '病故': '#7d7568', '被害': '#7b4d76', '自尽': '#5b5f7a',
    '出家': '#8a6f34', '归隐': '#4f7276', '存留': '#5f7a57', '不明': '#8d8474'
  };
  var G = { W: 1120, H: 720 };
  var mqMobile = window.matchMedia('(max-width: 760px)');
  var view = { x: 0, y: 0, k: 1 };
  var model = null, nodePos = {}, nodeDeg = {}, neighbors = {};
  var svg, scene, modal, lastFocus = null, gsHits = [], gsActive = -1;
  var ptrs = {}, dragStart = null, pinchStart = null, dragMoved = false, downTarget = null;

  var GROUP = {
    kin: '亲族 · 结义', serve: '君臣 · 师承', ally: '同盟 · 知遇',
    friend: '友朋 · 同僚', rival: '敌对 · 交锋', event: '事件'
  };
  var GROUP_ORDER = ['kin', 'serve', 'ally', 'friend', 'rival'];
  var GROUP_SHORT = { all: '全部关系', kin: '亲缘', serve: '君臣', ally: '同盟', friend: '友朋', rival: '敌对' };
  var GROUP_COLOR = { kin: '#a5674a', serve: '#4f7276', ally: '#6e8352', friend: '#9a8446', rival: '#a3463f', event: '#8d7751' };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function ch(n) { return '第' + n + '回'; }
  function fcolor(id) { return groupById[id] ? groupById[id].color : '#7a6953'; }

  /* ---------------- 索引 ---------------- */
  function buildIndices() {
    relByPerson = {}; eventsByPerson = {};
    D.relations.forEach(function (r) {
      (relByPerson[r.a] = relByPerson[r.a] || []).push({ other: r.b, label: r.label, group: r.group, chapter: r.chapter, dir: 'out' });
      (relByPerson[r.b] = relByPerson[r.b] || []).push({ other: r.a, label: r.label, group: r.group, chapter: r.chapter, dir: 'in' });
    });
    D.events.forEach(function (ev) {
      ev.cast.forEach(function (pid) {
        (eventsByPerson[pid] = eventsByPerson[pid] || []).push(ev);
      });
    });
  }

  function fillStatic() {
    $('#scopeText').textContent = D.scope;
    $('#sourceText').textContent = D.source;
    $('#statChars').textContent = D.characters.length;
    $('#statRels').textContent = D.relations.length;
    $('#statEvents').textContent = D.events.length;
    var sr = $('#statRanked');
    if (sr) sr.textContent = D.counts.ranked;
  }

  /* ---------------- 势力筛选 ---------------- */
  function renderBars() {
    ['gFac', 'pFac', 'pFac2', 'eFac'].forEach(function (id) {
      var box = $('#' + id);
      if (!box) return;
      box.innerHTML = '<button type="button" class="f-chip on" data-group="all"><i class="dot all"></i>全部</button>' +
        D.groups.map(function (f) {
          return '<button type="button" class="f-chip" data-group="' + f.id + '"><i class="dot" style="background:' +
            f.color + '"></i>' + esc(f.name) + '</button>';
        }).join('');
      box.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-group]');
        if (b) setGroup(b.getAttribute('data-group'));
      });
    });
  }

  function renderRelBar() {
    var box = $('#gRel');
    if (!box) return;
    box.innerHTML = ['all'].concat(GROUP_ORDER).map(function (g) {
      return '<button type="button" class="f-chip' + (g === 'all' ? ' on' : '') + '" data-rel="' + g + '">' +
        esc(GROUP_SHORT[g]) + '</button>';
    }).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-rel]');
      if (b) setRel(b.getAttribute('data-rel'));
    });
  }

  function setRel(g) {
    state.rel = g;
    $$('[data-rel]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-rel') === g); });
    hideTip();
    renderGraph();
  }

  function visibleEdge(e) {
    return e.kind === 'event' || state.rel === 'all' || e.group === state.rel;
  }

  function setGroup(f) {
    state.group = f;
    $$('[data-group]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-group') === f);
    });
    hideTip();
    renderGraph();
    renderPeople();
    renderRanks();
    renderEvents();
  }

  /* ---------------- 关系图模型与布局 ---------------- */
  function ensureModel() {
    if (model && model.showEvents === state.showEvents) return;
    model = { showEvents: state.showEvents, nodes: [], edges: [], anchors: {} };
    D.characters.forEach(function (c) {
      model.nodes.push({ id: c.id, name: c.name, kind: 'person', group: c.group });
    });
    model.edges = D.relations.map(function (r) {
      return { a: r.a, b: r.b, kind: 'relation', group: r.group, label: r.label };
    });
    if (state.showEvents) {
      D.events.forEach(function (ev) {
        model.nodes.push({ id: ev.id, name: ev.name, kind: 'event', chapter: ev.chapter, cast: ev.cast });
        ev.cast.forEach(function (pid) {
          model.edges.push({ a: ev.id, b: pid, kind: 'event', group: 'event' });
        });
      });
    }
    layout();
    computeDegrees();
  }

  function geometry() {
    G = mqMobile.matches ? { W: 640, H: 920 } : { W: 1120, H: 720 };
    if (svg) svg.setAttribute('viewBox', '0 0 ' + G.W + ' ' + G.H);
  }

  function anchorsFor() {
    if (mqMobile.matches) {
      return {
        shu: { x: 172, y: 286 }, wei: { x: 468, y: 286 },
        wu: { x: 172, y: 690 }, qun: { x: 468, y: 690 }
      };
    }
    return {
      shu: { x: 292, y: 468 }, wei: { x: 300, y: 196 },
      wu: { x: 836, y: 468 }, qun: { x: 820, y: 196 }
    };
  }

  function layout() {
    var anchors = anchorsFor();
    var compact = G.W < 800;
    var repulsion = compact ? 1700 : 2500;
    var springLen = compact ? 72 : 96;
    model.anchors = anchors;
    var people = model.nodes.filter(function (n) { return n.kind === 'person'; });
    var relEdges = model.edges.filter(function (e) { return e.kind === 'relation'; });
    var p = {};
    var ids = [];
    people.forEach(function (n, i) {
      var a = anchors[n.group] || { x: G.W / 2, y: G.H / 2 };
      var ang = (hash(n.id) % 360) * Math.PI / 180 + i * 0.7;
      var rad = 42 + hash(n.id) % 74;
      p[n.id] = { x: a.x + Math.cos(ang) * rad, y: a.y + Math.sin(ang) * rad, vx: 0, vy: 0, fx: 0, fy: 0 };
      ids.push(n.id);
    });

    for (var iter = 0; iter < 300; iter++) {
      Object.keys(p).forEach(function (k) { p[k].fx = 0; p[k].fy = 0; });
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          var A = p[ids[i]], B = p[ids[j]];
          var dx = B.x - A.x, dy = B.y - A.y;
          var d2 = dx * dx + dy * dy;
          if (d2 < 1) d2 = 1;
          var d = Math.sqrt(d2), f = repulsion / d2;
          var ux = dx / d, uy = dy / d;
          A.fx -= ux * f; A.fy -= uy * f;
          B.fx += ux * f; B.fy += uy * f;
        }
      }
      relEdges.forEach(function (e) {
        var A = p[e.a], B = p[e.b];
        if (!A || !B) return;
        var dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        var f = (d - springLen) * (compact ? 0.007 : 0.006);
        var ux = dx / d, uy = dy / d;
        A.fx += ux * f; A.fy += uy * f;
        B.fx -= ux * f; B.fy -= uy * f;
      });
      ids.forEach(function (k) {
        var n = p[k], a = anchors[byId[k].group] || { x: G.W / 2, y: G.H / 2 };
        n.fx += (a.x - n.x) * 0.013;
        n.fy += (a.y - n.y) * 0.013;
        n.vx = (n.vx + n.fx) * 0.8;
        n.vy = (n.vy + n.fy) * 0.8;
        n.vx = clamp(n.vx, -14, 14); n.vy = clamp(n.vy, -14, 14);
        n.x = clamp(n.x + n.vx, 58, G.W - 58);
        n.y = clamp(n.y + n.vy, 58, G.H - 58);
      });
    }

    nodePos = {};
    ids.forEach(function (k) { nodePos[k] = { x: p[k].x, y: p[k].y }; });

    // 事件节点放在参与者重心附近，再做一次轻量排斥，避免压住人物。
    var evs = model.nodes.filter(function (n) { return n.kind === 'event'; });
    var evPos = {};
    evs.forEach(function (ev, i) {
      var cx = 0, cy = 0, n = 0;
      ev.cast.forEach(function (pid) { if (nodePos[pid]) { cx += nodePos[pid].x; cy += nodePos[pid].y; n++; } });
      cx = n ? cx / n : G.W / 2; cy = n ? cy / n : G.H / 2;
      var ang = (i * 2.39996) + (hash(ev.id) % 100) / 40;
      var rad = 54 + (i % 4) * 10;
      evPos[ev.id] = { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad };
      nodePos[ev.id] = evPos[ev.id];
    });
    var all = Object.keys(nodePos);
    for (var t = 0; t < 90; t++) {
      all.forEach(function (k) {
        var n = nodePos[k];
        if (!n) return;
        var fx = 0, fy = 0;
        all.forEach(function (o) {
          if (o === k) return;
          var m = nodePos[o], dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < 2200) { var f = 180 / d2; fx += dx * f; fy += dy * f; }
        });
        var ev = evs.find(function (x) { return x.id === k; });
        if (ev) {
          var cx = 0, cy = 0, c = 0;
          ev.cast.forEach(function (pid) { if (nodePos[pid]) { cx += nodePos[pid].x; cy += nodePos[pid].y; c++; } });
          if (c) { fx += ((cx / c) - n.x) * 0.03; fy += ((cy / c) - n.y) * 0.03; }
        }
        n.x = clamp(n.x + fx, 46, G.W - 46);
        n.y = clamp(n.y + fy, 46, G.H - 46);
      });
    }
  }

  function computeDegrees() {
    nodeDeg = {}; neighbors = {};
    model.nodes.forEach(function (n) { nodeDeg[n.id] = 0; neighbors[n.id] = {}; });
    model.edges.forEach(function (e) {
      nodeDeg[e.a] = (nodeDeg[e.a] || 0) + 1;
      nodeDeg[e.b] = (nodeDeg[e.b] || 0) + 1;
      neighbors[e.a][e.b] = 1;
      neighbors[e.b][e.a] = 1;
    });
  }

  function radius(n) {
    if (n.kind === 'event') return 8.5;
    return 5.5 + Math.min(8.5, Math.sqrt(nodeDeg[n.id] || 1) * 1.55);
  }

  function visible(n) {
    if (state.group === 'all') return true;
    if (n.kind === 'person') return n.group === state.group;
    return n.cast.some(function (pid) { return byId[pid] && byId[pid].group === state.group; });
  }

  /* ---------------- 图谱渲染 ---------------- */
  function renderGraph() {
    ensureModel();
    svg.setAttribute('data-hover', '');
    svg.classList.remove('focusing');
    var vis = {};
    model.nodes.forEach(function (n) { if (visible(n)) vis[n.id] = 1; });
    var edges = [], hits = [], nodes = [];

    model.edges.forEach(function (e) {
      var A = nodePos[e.a], B = nodePos[e.b];
      if (!A || !B) return;
      var on = vis[e.a] && vis[e.b] && visibleEdge(e);
      edges.push('<line class="edge ' + (e.kind === 'event' ? 'ev' : 'g-' + e.group) +
        (on ? '' : ' off') + '" x1="' + A.x.toFixed(1) + '" y1="' + A.y.toFixed(1) +
        '" x2="' + B.x.toFixed(1) + '" y2="' + B.y.toFixed(1) + '"></line>');
      if (e.kind === 'relation' && on) {
        hits.push('<line class="edge-hit" x1="' + A.x.toFixed(1) + '" y1="' + A.y.toFixed(1) +
          '" x2="' + B.x.toFixed(1) + '" y2="' + B.y.toFixed(1) + '" data-key="' +
          esc(e.a + '|' + e.b) + '"></line>');
      }
    });

    var clusters = D.groups.map(function (f) {
      var a = model.anchors[f.id];
      if (!a) return '';
      var on = state.group === 'all' || state.group === f.id;
      var lift = mqMobile.matches ? 120 : 132;
      return '<text class="cluster' + (on ? '' : ' off') + '" x="' + (a.x - 52) + '" y="' + (a.y - lift) + '">' +
        esc(f.name) + '</text>';
    }).join('');

    model.nodes.forEach(function (n) {
      var p = nodePos[n.id], r = radius(n);
      var on = !!vis[n.id];
      var cls = 'node ' + (n.kind === 'event' ? 'ev-node' : 'p-node') + (on ? '' : ' off') +
        (n.kind === 'person' ? ' f-' + n.group : '');
      var label = n.name;
      if (n.kind === 'event') {
        nodes.push('<g class="' + cls + '" data-id="' + esc(n.id) + '" transform="translate(' +
          p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')" tabindex="0" role="button" aria-label="事件：' +
          esc(n.name) + '，' + ch(n.chapter) + '"><title>' + esc(n.name) + ' · ' + ch(n.chapter) +
          '</title><polygon points="0,-9 9,0 0,9 -9,0"></polygon><text y="21">' + esc(label) + '</text></g>');
      } else {
        nodes.push('<g class="' + cls + '" data-id="' + esc(n.id) + '" transform="translate(' +
          p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')" tabindex="0" role="button" aria-label="' +
          esc(n.name) + '，' + esc(groupById[n.group].name) + '"><title>' + esc(n.name) + ' · ' +
          esc(groupById[n.group].name) + '</title><circle r="' + r.toFixed(1) + '" fill="' +
          fcolor(n.group) + '"></circle><text y="' + (r + 14).toFixed(1) + '">' + esc(label) + '</text></g>');
      }
    });

    svg.innerHTML = '<g class="scene" id="scene"><g class="clusters">' + clusters +
      '</g><g class="edges">' + edges.join('') + '</g><g class="edge-hits">' + hits.join('') +
      '</g><g class="nodes">' + nodes.join('') + '</g></g>';
    scene = $('#scene');
    applyView();
    fitVisible(vis);
    updateGraphMeta(vis);
    updateEventButton();
  }

  function updateGraphMeta(vis) {
    var ppl = 0, rel = 0;
    model.nodes.forEach(function (n) { if (n.kind === 'person' && vis[n.id]) ppl++; });
    model.edges.forEach(function (e) { if (e.kind === 'relation' && vis[e.a] && vis[e.b] && visibleEdge(e)) rel++; });
    var evs = 0;
    if (state.showEvents) model.nodes.forEach(function (n) { if (n.kind === 'event' && vis[n.id]) evs++; });
    $('#gCount').textContent = ppl + ' 位人物 · ' + rel + ' 条关系' +
      (state.showEvents ? ' · ' + evs + ' 个事件' : '');
    $('#gHint').textContent = state.showEvents
      ? '点人物看关系与出场事件；点事件看回目、参与者与地点；滚轮缩放，拖动平移。'
      : '点人物看关系与出场事件；点两点之间的连线看关系依据；滚轮缩放，拖动平移。';
  }

  function renderLegend() {
    var html = D.groups.map(function (f) {
      return '<span><i style="background:' + f.color + '"></i>' + esc(f.name) + '</span>';
    }).join('');
    html += '<span class="legend-sep"></span>';
    GROUP_ORDER.forEach(function (g) {
      html += '<span class="lg g-' + g + '"><i></i>' + esc(GROUP[g].split(' · ')[0]) + '</span>';
    });
    html += '<span class="lg g-event"><i></i>事件</span>';
    $('#gLegend').innerHTML = html;
  }

  function fitVisible(vis) {
    var pts = model.nodes.filter(function (n) { return vis[n.id]; }).map(function (n) { return nodePos[n.id]; });
    if (!pts.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    });
    var pad = mqMobile.matches ? 46 : 78;
    var w = Math.max(120, x1 - x0 + pad * 2), h = Math.max(120, y1 - y0 + pad * 2);
    var k = clamp(Math.min(G.W / w, G.H / h), 0.58, 1.55);
    view.k = k;
    view.x = G.W / 2 - (x0 + x1) / 2 * k;
    view.y = G.H / 2 - (y0 + y1) / 2 * k;
    applyView();
  }

  function applyView() {
    if (!scene) return;
    scene.setAttribute('transform', 'translate(' + view.x.toFixed(2) + ',' + view.y.toFixed(2) +
      ') scale(' + view.k.toFixed(3) + ')');
    $('#gZoomLabel').textContent = Math.round(view.k * 100) + '%';
  }

  function zoomAt(mx, my, factor) {
    var k = clamp(view.k * factor, 0.5, 2.9);
    var r = k / view.k;
    view.x = mx - (mx - view.x) * r;
    view.y = my - (my - view.y) * r;
    view.k = k;
    applyView();
  }

  function resetView() {
    var vis = {};
    model.nodes.forEach(function (n) { if (visible(n)) vis[n.id] = 1; });
    fitVisible(vis);
  }

  function updateEventButton() {
    var b = $('#evToggle');
    if (!b) return;
    b.classList.toggle('on', state.showEvents);
    b.textContent = state.showEvents ? '隐藏事件节点' : '显示事件节点';
  }

  /* ---------------- 悬浮 ---------------- */
  function setHover(id) {
    if (svg.getAttribute('data-hover') === (id || '')) return;
    svg.setAttribute('data-hover', id || '');
    svg.classList.toggle('focusing', !!id);
    var near = id ? neighbors[id] || {} : {};
    var active = {};
    if (id) { active[id] = 1; Object.keys(near).forEach(function (k) { active[k] = 1; }); }
    $$('.node', svg).forEach(function (g) {
      var nid = g.getAttribute('data-id');
      g.classList.toggle('dim', !!id && !active[nid]);
    });
    var lines = $$('.edge', svg), i = 0;
    model.edges.forEach(function (e) {
      if (i < lines.length) {
        lines[i].classList.toggle('dim', !!id && !(active[e.a] && active[e.b]));
        i++;
      }
    });
  }

  function rankText(p) {
    if (!p.rank) return '';
    return '座次第' + p.rank + ' · ' + p.star;
  }
  function starBadge(p) {
    if (!p.rank) return '';
    return '<span class="p-star' + (p.rank <= 36 ? ' heaven' : '') + '">' + esc(p.star) + ' · 第' + p.rank + '位</span>';
  }
  function fateTag(p) {
    if (!p.fate) return '';
    return '<span class="fate-tag" style="--fc:' + (FATE_COLOR[p.fate] || '#7d7568') + '">' + esc(p.fate) + '</span>';
  }

  function tipHTML(id) {
    var n = byId[id];
    if (!n) return '';
    if (n.kind === 'event') {
      return '<b>' + esc(n.name) + '</b><span>' + ch(n.chapter) + ' · ' + esc(placeById[n.place] ? placeById[n.place].name : '') + '</span>';
    }
    var bits = [n.nickname, groupById[n.group].name, n.role, rankText(n)].filter(Boolean).join(' · ');
    return '<b>' + esc(n.name) + '</b><span>' + esc(bits) + '</span>';
  }

  function showTip(id, ev) {
    var tip = $('#gTip');
    if (!tip) return;
    tip.innerHTML = tipHTML(id);
    tip.hidden = false;
    positionTip(ev);
  }
  function positionTip(ev) {
    var tip = $('#gTip');
    if (!tip || tip.hidden) return;
    var x = ev.clientX + 14, y = ev.clientY + 14, r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 12) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 12) y = ev.clientY - r.height - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { var t = $('#gTip'); if (t) t.hidden = true; }

  /* ---------------- 搜索定位 ---------------- */
  function renderSearchList() {
    var input = $('#gSearch'), list = $('#gSearchList');
    var q = input.value.trim();
    if (!q) { list.hidden = true; gsHits = []; gsActive = -1; return; }
    gsHits = D.characters.filter(function (p) {
      return p.name.indexOf(q) >= 0 || (p.nickname && p.nickname.indexOf(q) >= 0) ||
        (p.star && p.star.indexOf(q) >= 0);
    }).sort(function (a, b) {
      var pa = a.name.indexOf(q) === 0 ? 0 : 1, pb = b.name.indexOf(q) === 0 ? 0 : 1;
      return pa - pb || a.name.length - b.name.length;
    }).slice(0, 7);
    gsActive = gsHits.length ? 0 : -1;
    list.innerHTML = gsHits.length ? gsHits.map(function (p, i) {
      return '<button type="button" role="option" data-id="' + esc(p.id) + '"' + (i === 0 ? ' class="on"' : '') + '>' +
        '<span>' + esc(p.name) + '</span><small>' + esc(p.nickname || '') + ' · ' +
        esc(groupById[p.group].name) + (p.rank ? ' · 第' + p.rank + '位' : '') + '</small></button>';
    }).join('') : '<div class="slist-empty">没有找到「' + esc(q) + '」</div>';
    list.hidden = false;
  }

  function pickSearch(id) {
    var p = byId[id];
    if (!p) return;
    $('#gSearch').value = p.name;
    $('#gSearchList').hidden = true;
    revealNode(id);
    focusNode(id);
  }

  function revealNode(id) {
    var n = byId[id];
    if (!n) return;
    if (n.kind === 'person' && state.group !== 'all' && n.group !== state.group) setGroup('all');
    if (n.kind === 'event' && !state.showEvents) {
      state.showEvents = true;
      renderGraph();
    }
  }

  function focusNode(id) {
    var p = nodePos[id];
    if (!p) return;
    var k = Math.max(view.k, 1.7);
    view.k = k;
    view.x = G.W / 2 - p.x * k;
    view.y = G.H / 2 - p.y * k;
    applyView();
    var g = svg.querySelector('.node[data-id="' + id + '"]');
    if (g) {
      g.classList.add('pulse');
      setTimeout(function () { g.classList.remove('pulse'); }, 1900);
    }
  }

  /* ---------------- 人物列表 ---------------- */
  function renderFateBar() {
    var box = $('#pFate');
    if (!box) return;
    box.innerHTML = ['all'].concat(D.fateOrder).map(function (f) {
      return '<button type="button" class="f-chip' + (f === 'all' ? ' on' : '') + '" data-fate="' + f + '">' +
        (f === 'all' ? '全部结局' : esc(f)) + '</button>';
    }).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-fate]');
      if (!b) return;
      state.fate = b.getAttribute('data-fate');
      $$('[data-fate]').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderPeople();
      renderRanks();
    });
  }

  function renderPeople() {
    var q = state.pq.trim();
    var list = D.characters.filter(function (p) {
      if (state.group !== 'all' && p.group !== state.group) return false;
      if (state.fate !== 'all' && p.fate !== state.fate) return false;
      if (!q) return true;
      return p.name.indexOf(q) >= 0 || (p.nickname && p.nickname.indexOf(q) >= 0) ||
        (p.star && p.star.indexOf(q) >= 0) || p.summary.indexOf(q) >= 0;
    }).sort(function (a, b) { return (a.rank || 999) - (b.rank || 999); });
    $('#peopleCount').textContent = list.length + ' 位';
    $('#peopleGrid').innerHTML = list.map(function (p) {
      return '<button type="button" class="p-card" data-go="' + esc(p.id) + '" style="--c:' + fcolor(p.group) + '">' +
        '<span class="p-fac">' + esc(groupById[p.group].name) + ' · ' + esc(p.role) + '</span>' +
        '<strong>' + esc(p.name) + (p.nickname ? '<small>' + esc(p.nickname) + '</small>' : '') + '</strong>' +
        starBadge(p) +
        (p.duty ? '<span class="p-duty">' + esc(p.duty) + '</span>' : '') +
        '<span class="p-sum">' + esc(p.summary) + '</span>' +
        '<span class="p-ch">' + fateTag(p) + ' ' + esc(p.ending) + '</span></button>';
    }).join('');
  }

  /* ---------------- 座次表 ---------------- */
  function renderRanks() {
    var q = state.rq.trim();
    var list = D.characters.filter(function (p) {
      if (!p.rank) return false;
      if (state.group !== 'all' && p.group !== state.group) return false;
      if (state.fate !== 'all' && p.fate !== state.fate) return false;
      if (!q) return true;
      return p.name.indexOf(q) >= 0 || (p.nickname && p.nickname.indexOf(q) >= 0) ||
        (p.star && p.star.indexOf(q) >= 0);
    }).sort(function (a, b) { return a.rank - b.rank; });

    var counts = {};
    D.characters.forEach(function (p) { if (p.fate) counts[p.fate] = (counts[p.fate] || 0) + 1; });
    $('#rankStats').innerHTML = D.fateOrder.map(function (f) {
      return '<span class="rk-stat"><i style="background:' + (FATE_COLOR[f] || '#7d7568') + '"></i>' +
        esc(f) + ' <b>' + (counts[f] || 0) + '</b></span>';
    }).join('');
    $('#rankCount').textContent = list.length + ' 位';

    function rows(arr) {
      return arr.map(function (p) {
        return '<button type="button" class="rk-row" data-go="' + esc(p.id) + '">' +
          '<span class="rk-no">' + p.rank + '</span>' +
          '<span class="rk-star">' + esc(p.star) + '</span>' +
          '<span class="rk-name">' + esc(p.name) + '<small>' + esc(p.nickname || '') + '</small></span>' +
          '<span class="rk-group">' + esc(groupById[p.group].name) + '</span>' +
          '<span class="rk-fate" style="--fc:' + (FATE_COLOR[p.fate] || '#7d7568') + '">' + esc(p.fate || '—') + '</span></button>';
      }).join('');
    }

    var heavens = list.filter(function (p) { return p.rank <= 36; });
    var earths = list.filter(function (p) { return p.rank > 36; });
    var html = '';
    if (heavens.length) {
      html += '<section class="rk-sec"><h3>天罡三十六 <small>石碣天文前列</small></h3><div class="rk-head">' +
        '<span>座次</span><span>星号</span><span>姓名 / 绰号</span><span>山头</span><span>结局</span></div>' +
        '<div class="rk-list">' + rows(heavens) + '</div></section>';
    }
    if (earths.length) {
      html += '<section class="rk-sec"><h3>地煞七十二 <small>本切片选录</small></h3><div class="rk-head">' +
        '<span>座次</span><span>星号</span><span>姓名 / 绰号</span><span>山头</span><span>结局</span></div>' +
        '<div class="rk-list">' + rows(earths) + '</div></section>';
    }
    $('#rankTable').innerHTML = html || '<p class="rk-empty">没有符合条件的人物。</p>';
  }

  /* ---------------- 招安进程 ---------------- */
  function renderAmnesty() {
    $('#amnestyTrack').innerHTML = D.amnesty.map(function (s, i) {
      return '<div class="am-step"><span class="am-no">' + (i + 1) + '</span>' +
        '<div><b>' + esc(s.name) + '</b><small>' + ch(s.chapter) + '</small>' +
        '<p>' + esc(s.summary) + '</p></div></div>';
    }).join('');
  }

  /* ---------------- 事件时间线 ---------------- */
  function renderEvents() {
    var list = D.events.filter(function (ev) {
      if (state.group === 'all') return true;
      return ev.cast.some(function (pid) { return byId[pid].group === state.group; });
    });
    $('#eventCount').textContent = list.length + ' 个事件';
    $('#timeline').innerHTML = list.map(function (ev) {
      var place = placeById[ev.place];
      return '<button type="button" class="t-item" data-go="' + esc(ev.id) + '">' +
        '<span class="t-ch">' + ch(ev.chapter) + '</span>' +
        '<span class="t-dot"></span>' +
        '<span class="t-body"><strong>' + esc(ev.name) + '</strong>' +
        '<small>' + esc(ev.sourceTitle) + '</small>' +
        '<span class="t-sum">' + esc(ev.summary) + '</span>' +
        '<span class="t-meta">' + ev.cast.map(function (pid) { return esc(byId[pid].name); }).join('、') +
        (place ? ' · ' + esc(place.name) : '') + '</span></span></button>';
    }).join('');
  }

  /* ---------------- 地点 ---------------- */
  function renderPlaces() {
    var q = state.plq.trim();
    var list = D.places.filter(function (pl) {
      if (!q) return true;
      return pl.name.indexOf(q) >= 0 || (pl.modern && pl.modern.indexOf(q) >= 0) || pl.summary.indexOf(q) >= 0;
    }).sort(function (a, b) { return a.chapter - b.chapter; });
    $('#placesCount').textContent = list.length + ' 处';
    $('#placesGrid').innerHTML = list.map(function (pl) {
      var n = D.events.filter(function (ev) { return ev.place === pl.id; }).length;
      return '<button type="button" class="p-card place-card" data-go="' + esc(pl.id) + '">' +
        '<span class="p-fac">' + ch(pl.chapter) + ' · 地点</span>' +
        '<strong>' + esc(pl.name) + '</strong>' +
        '<span class="p-sum">' + esc(pl.summary) + '</span>' +
        '<span class="p-ch">' + esc(pl.modern || '地望待考') + (n ? ' · ' + n + ' 个事件' : '') + '</span></button>';
    }).join('');
  }

  /* ---------------- 详情弹窗 ---------------- */
  function refsHTML(item) {
    if (!item.refs || !item.refs.length) return '';
    return '<p class="m-refs">延伸阅读：' + item.refs.map(function (r) {
      return '<a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(r.label) + ' ↗</a>';
    }).join('') + '</p>';
  }

  function wikidataHTML(p) {
    var facts = p.wikidataFacts || [];
    if (!facts.length) return '';
    return '<div class="m-wd"><b>外部参考 · Wikidata</b><dl class="m-facts">' +
      facts.map(function (f) {
        return '<dt>' + esc(f.label) + '</dt><dd>' + esc(f.value) + '</dd>';
      }).join('') + '</dl></div>';
  }

  function profileHTML(p) {
    var rows = [];
    if (p.rank) rows.push(['座次', '第 ' + p.rank + ' 位 · ' + p.star]);
    if (p.nickname) rows.push(['绰号', p.nickname]);
    if (p.duty) rows.push(['梁山职司', p.duty]);
    if (p.before) rows.push(['上山前', p.before]);
    rows.push(['山头', groupById[p.group].name]);
    if (p.fate) rows.push(['结局类别', p.fate]);
    if (!rows.length) return '';
    return '<section class="m-sec"><h3>词条档案</h3><dl class="m-facts">' +
      rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
      }).join('') + '</dl>' +
      (p.nicknameNote ? '<p class="m-nicknote">' + esc(p.nicknameNote) + '</p>' : '') +
      wikidataHTML(p) +
      (D.factSource ? '<p class="m-factnote">' + esc(D.factSource) + '</p>' : '') +
      '</section>';
  }

  function personModal(p) {
    var f = groupById[p.group];
    var rels = (relByPerson[p.id] || []).slice().sort(function (a, b) {
      return GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    });
    var evs = (eventsByPerson[p.id] || []).slice().sort(function (a, b) { return a.chapter - b.chapter; });
    var html = '<div class="m-head" style="--c:' + f.color + '">' +
      '<span class="m-eyebrow">' + esc(f.name) + ' · ' + esc(p.role) +
      (p.rank ? ' · ' + esc(rankText(p)) : ' · 未入一百单八将') + '</span>' +
      '<h2 id="modalTitle">' + esc(p.name) + (p.nickname ? '<small>' + esc(p.nickname) + '</small>' : '') + '</h2>' +
      '<p class="m-sub">' + p.chapters.map(ch).join(' · ') + '</p></div>' +
      '<p class="m-lead">' + esc(p.summary) + '</p><p class="m-text">' + esc(p.detail) + '</p>';
    if (p.history) html += '<aside class="m-note"><b>小说与史</b><span>' + esc(p.history) + '</span></aside>';
    html += profileHTML(p);
    if (p.ending) {
      html += '<section class="m-sec"><h3>结局</h3><div class="m-ending" style="--fc:' +
        (FATE_COLOR[p.fate] || '#7d7568') + '"><span class="fate-tag" style="--fc:' +
        (FATE_COLOR[p.fate] || '#7d7568') + '">' + esc(p.fate || '—') + '</span>' +
        '<p>' + esc(p.ending) + '</p></div></section>';
    }

    if (rels.length) {
      html += '<section class="m-sec"><h3>人物关系</h3><div class="m-rels">' + rels.map(function (r) {
        var o = byId[r.other];
        return '<div class="m-rel g-' + r.group + '"><i></i><span class="m-rg">' + esc(GROUP[r.group]) +
          '</span><button type="button" data-go="' + esc(r.other) + '">' + esc(o.name) + '</button>' +
          '<span class="m-rl">' + esc(r.label) + '</span><small>' + ch(r.chapter) + '</small></div>';
      }).join('') + '</div></section>';
    }
    if (evs.length) {
      html += '<section class="m-sec"><h3>出场事件</h3><div class="m-evs">' + evs.map(function (ev) {
        return '<button type="button" data-go="' + esc(ev.id) + '"><small>' + ch(ev.chapter) +
          '</small><span>' + esc(ev.name) + '</span></button>';
      }).join('') + '</div></section>';
    }
    html += refsHTML(p);
    html += '<p class="m-src">依据：' + esc(D.source) + '</p>';
    return html;
  }

  function placeModal(pl) {
    var evs = D.events.filter(function (ev) { return ev.place === pl.id; })
      .sort(function (a, b) { return a.chapter - b.chapter; });
    var html = '<div class="m-head m-head-place">' +
      '<span class="m-eyebrow">地点 · ' + ch(pl.chapter) + '</span>' +
      '<h2 id="modalTitle">' + esc(pl.name) + '</h2>' +
      '<p class="m-sub">' + esc(pl.modern || '') + '</p></div>' +
      '<p class="m-lead">' + esc(pl.summary) + '</p>';
    if (evs.length) {
      html += '<section class="m-sec"><h3>此处发生的事件</h3><div class="m-evs">' + evs.map(function (ev) {
        return '<button type="button" data-go="' + esc(ev.id) + '"><small>' + ch(ev.chapter) +
          '</small><span>' + esc(ev.name) + '</span></button>';
      }).join('') + '</div></section>';
    } else {
      html += '<aside class="m-note"><b>说明</b><span>当前切片尚未收录发生于此处的事件。</span></aside>';
    }
    html += '<p class="m-src">地望为通行说法，古今地名对照可能有异；依据：' + esc(D.source) + '</p>';
    return html;
  }

  function eventModal(ev) {
    var place = placeById[ev.place];
    var html = '<div class="m-head m-head-event">' +
      '<span class="m-eyebrow">' + ch(ev.chapter) + (place ? ' · ' + esc(place.name) : '') + '</span>' +
      '<h2 id="modalTitle">' + esc(ev.name) + '</h2>' +
      '<p class="m-sub">' + esc(ev.sourceTitle) + '</p></div>' +
      '<p class="m-lead">' + esc(ev.summary) + '</p><p class="m-text">' + esc(ev.detail) + '</p>';
    if (ev.history) html += '<aside class="m-note"><b>小说与史</b><span>' + esc(ev.history) + '</span></aside>';
    html += '<section class="m-sec"><h3>出场人物</h3><div class="m-cast">' + ev.cast.map(function (pid) {
      var p = byId[pid];
      return '<button type="button" data-go="' + esc(pid) + '" style="--c:' + fcolor(p.group) + '">' +
        '<i></i>' + esc(p.name) + '<small>' + esc(groupById[p.group].name) + '</small></button>';
    }).join('') + '</div></section>';
    if (place) {
      html += '<section class="m-sec"><h3>地点</h3><button type="button" class="m-place" data-go="' +
        esc(place.id) + '"><b>' + esc(place.name) + '</b><span>' + esc(place.modern || '') +
        '</span><p>' + esc(place.summary) + '</p></button></section>';
    }
    html += '<p class="m-src">依据：' + esc(D.source) + '</p>';
    return html;
  }

  function relationModal(aId, bId) {
    var rel = D.relations.find(function (r) {
      return (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId);
    });
    if (!rel) return null;
    var a = byId[aId], b = byId[bId];
    var shared = sharedEvents(aId, bId);
    return '<div class="m-head m-head-rel" style="--c:' + GROUP_COLOR[rel.group] + '">' +
      '<span class="m-eyebrow">人物关系 · ' + ch(rel.chapter) + '</span>' +
      '<h2 id="modalTitle">' + esc(a.name) + ' · ' + esc(b.name) + '</h2>' +
      '<p class="m-sub">' + esc(GROUP[rel.group]) + '</p></div>' +
      '<p class="m-lead">' + esc(rel.label) + '</p>' +
      '<div class="m-duo">' + [a, b].map(function (p) {
        return '<button type="button" data-go="' + esc(p.id) + '" style="--c:' + fcolor(p.group) + '">' +
          '<i></i><b>' + esc(p.name) + '</b><small>' + esc(groupById[p.group].name) + ' · ' + esc(p.role) + '</small></button>';
      }).join('') + '</div>' +
      (shared.length ? '<section class="m-sec"><h3>共同出场的事件</h3><div class="m-evs">' + shared.map(function (ev) {
        return '<button type="button" data-go="' + esc(ev.id) + '"><small>' + ch(ev.chapter) +
          '</small><span>' + esc(ev.name) + '</span></button>';
      }).join('') + '</div></section>' : '') +
      '<aside class="m-note"><b>说明</b><span>关系与回目依据小说叙事；史传记载可能不同，详见两人词条。</span></aside>' +
      '<p class="m-src">依据：' + esc(D.source) + '</p>';
  }

  function sharedEvents(aId, bId) {
    var m = {};
    (eventsByPerson[aId] || []).forEach(function (ev) { m[ev.id] = 1; });
    return (eventsByPerson[bId] || []).filter(function (ev) { return m[ev.id]; })
      .sort(function (x, y) { return x.chapter - y.chapter; });
  }

  function openDetail(id, fromRoute) {
    var item = byId[id];
    if (!item) return;
    var html = item.kind === 'event' ? eventModal(item)
      : item.kind === 'place' ? placeModal(item) : personModal(item);
    showModal(html);
    if (!fromRoute) {
      try {
        var prefix = item.kind === 'event' ? 'event/' : item.kind === 'place' ? 'place/' : 'figure/';
        history.replaceState(null, '', '#' + prefix + id);
      } catch (e) { /* ignore */ }
    }
  }

  function openRelation(key) {
    var parts = key.split('|');
    var html = relationModal(parts[0], parts[1]);
    if (html) showModal(html);
  }

  function showModal(html) {
    var wasOpen = !modal.hidden;
    $('#modalBody').innerHTML = html;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    var card = $('.modal-card', modal);
    if (card) card.scrollTop = 0;
    if (!wasOpen) lastFocus = document.activeElement;
    var close = $('#modalClose');
    if (close) close.focus();
  }

  function hideModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function closeDetail() {
    if (!modal || modal.hidden) return;
    hideModal();
    if (/^#(figure|event|place)\//.test(location.hash)) {
      try { history.replaceState(null, '', '#' + state.view); } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- 视图路由 ---------------- */
  function setView(v, updateHash) {
    state.view = v;
    $$('[data-view]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === v);
    });
    $$('.view').forEach(function (el) {
      el.hidden = el.id !== 'view-' + v;
    });
    if (updateHash !== false) {
      try { history.replaceState(null, '', '#' + v); } catch (e) { /* ignore */ }
    }
    if (v === 'graph') renderGraph();
    if (v === 'people') renderPeople();
    if (v === 'events') renderEvents();
    if (v === 'places') renderPlaces();
    if (v === 'ranks') renderRanks();
    if (v === 'amnesty') renderAmnesty();
  }

  function route() {
    var h = location.hash.replace(/^#/, '');
    var parts = h.split('/');
    if ((parts[0] === 'figure' || parts[0] === 'event' || parts[0] === 'place') && parts[1]) {
      if (!model) setView('graph', false);
      openDetail(decodeURIComponent(parts[1]), true);
      return;
    }
    if (['people', 'events', 'places', 'graph', 'ranks', 'amnesty'].indexOf(parts[0]) >= 0) {
      setView(parts[0], false);
      return;
    }
    setView('graph', false);
  }

  /* ---------------- 缩放 / 平移 ---------------- */
  function svgPoint(clientX, clientY) {
    var r = svg.getBoundingClientRect();
    var s = G.W / r.width;
    return { x: (clientX - r.left) * s, y: (clientY - r.top) * s };
  }

  function clientToScene(clientX, clientY) {
    var r = svg.getBoundingClientRect();
    var s = G.W / r.width;
    var x = (clientX - r.left) * s, y = (clientY - r.top) * s;
    return { x: (x - view.x) / view.k, y: (y - view.y) / view.k };
  }

  function distanceToSegment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function nearestEdge(p) {
    var best = null, bestScore = Infinity;
    model.edges.forEach(function (e) {
      if (e.kind !== 'relation' || !visibleEdge(e)) return;
      if (!visible(byId[e.a]) || !visible(byId[e.b])) return;
      var A = nodePos[e.a], B = nodePos[e.b];
      if (!A || !B) return;
      var d = distanceToSegment(p, A, B);
      if (d > 13) return;
      // 多条线在同一处交叉时，优先选“点击位置更靠近线中点”的那条。
      var mid = Math.hypot(p.x - (A.x + B.x) / 2, p.y - (A.y + B.y) / 2);
      var score = d + mid * 0.05;
      if (score < bestScore) { bestScore = score; best = e; }
    });
    return best;
  }

  function pinchInfo() {
    var ids = Object.keys(ptrs);
    if (ids.length < 2) return null;
    var p1 = ptrs[ids[0]], p2 = ptrs[ids[1]];
    var m = svgPoint((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    return {
      d: Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y)),
      mx: m.x, my: m.y, k: view.k, x: view.x, y: view.y
    };
  }

  function bindGraph() {
    svg = $('#gSvg');

    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(ptrs).length === 1) {
        downTarget = e.target.closest('.node') || e.target.closest('.edge-hit');
        dragStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, s: G.W / svg.getBoundingClientRect().width };
        dragMoved = false;
      } else {
        downTarget = null;
        dragStart = null;
        pinchStart = pinchInfo();
      }
      setHover(null);
    });

    svg.addEventListener('pointermove', function (e) {
      if (ptrs[e.pointerId]) {
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        var n = Object.keys(ptrs).length;
        if (n >= 2 && pinchStart) {
          var info = pinchInfo();
          if (info) {
            var k = clamp(pinchStart.k * (info.d / pinchStart.d), 0.5, 2.9);
            var r = k / pinchStart.k;
            view.k = k;
            view.x = info.mx - (info.mx - pinchStart.x) * r;
            view.y = info.my - (info.my - pinchStart.y) * r;
            applyView();
          }
          return;
        }
        if (dragStart) {
          var dx = (e.clientX - dragStart.x) * dragStart.s;
          var dy = (e.clientY - dragStart.y) * dragStart.s;
          if (Math.abs(e.clientX - dragStart.x) + Math.abs(e.clientY - dragStart.y) > 5) dragMoved = true;
          view.x = dragStart.vx + dx;
          view.y = dragStart.vy + dy;
          applyView();
        }
        return;
      }
      if (e.pointerType === 'touch') return;
      var g = e.target.closest('.node');
      var id = g ? g.getAttribute('data-id') : null;
      setHover(id);
      if (id) showTip(id, e); else hideTip();
    });

    function up(e) {
      delete ptrs[e.pointerId];
      if (Object.keys(ptrs).length < 2) pinchStart = null;
      if (!Object.keys(ptrs).length) {
        if (!dragMoved) {
          if (downTarget && downTarget.classList.contains('node')) {
            openDetail(downTarget.getAttribute('data-id'));
          } else {
            var edge = nearestEdge(clientToScene(e.clientX, e.clientY));
            if (edge) openRelation(edge.a + '|' + edge.b);
          }
        }
        downTarget = null;
        dragStart = null;
        dragMoved = false;
        hideTip();
      }
    }
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', function () { setHover(null); hideTip(); });

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = svgPoint(e.clientX, e.clientY);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    svg.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var node = e.target.closest('.node');
      if (!node) return;
      e.preventDefault();
      openDetail(node.getAttribute('data-id'));
    });

    $$('#gZoom [data-zoom]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-zoom');
        if (m === 'in') zoomAt(G.W / 2, G.H / 2, 1.2);
        else if (m === 'out') zoomAt(G.W / 2, G.H / 2, 1 / 1.2);
        else resetView();
      });
    });

    $('#evToggle').addEventListener('click', function () {
      state.showEvents = !state.showEvents;
      hideTip();
      renderGraph();
    });
  }

  /* ---------------- 搜索 / 弹窗 / 全局事件 ---------------- */
  function bindChrome() {
    $$('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (modal && !modal.hidden) hideModal();
        setView(b.getAttribute('data-view'));
      });
    });

    var gs = $('#gSearch');
    gs.addEventListener('input', renderSearchList);
    gs.addEventListener('focus', function () { if (gs.value.trim()) renderSearchList(); });
    gs.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { $('#gSearchList').hidden = true; gs.blur(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!gsHits.length) return;
        e.preventDefault();
        gsActive = (gsActive + (e.key === 'ArrowDown' ? 1 : gsHits.length - 1)) % gsHits.length;
        $$('#gSearchList button').forEach(function (b, i) { b.classList.toggle('on', i === gsActive); });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var p = gsHits[gsActive] || gsHits[0];
        if (p) pickSearch(p.id);
      }
    });
    $('#gSearchList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (b) pickSearch(b.getAttribute('data-id'));
    });
    document.addEventListener('click', function (e) {
      var wrap = $('.gsearch');
      if (wrap && !wrap.contains(e.target)) $('#gSearchList').hidden = true;
    });

    var rq = $('#rankSearch');
    if (rq) rq.addEventListener('input', function (e) { state.rq = e.target.value; renderRanks(); });
    var rk = $('#rankTable');
    if (rk) rk.addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b) openDetail(b.getAttribute('data-go'));
    });

    $('#peopleSearch').addEventListener('input', function (e) {
      state.pq = e.target.value;
      renderPeople();
    });
    $('#peopleGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b) openDetail(b.getAttribute('data-go'));
    });
    $('#placesSearch').addEventListener('input', function (e) {
      state.plq = e.target.value;
      renderPlaces();
    });
    $('#placesGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b) openDetail(b.getAttribute('data-go'));
    });
    $('#timeline').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b) openDetail(b.getAttribute('data-go'));
    });

    $('#modalClose').addEventListener('click', closeDetail);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeDetail(); });
    $('#modalBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b) openDetail(b.getAttribute('data-go'));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (modal && !modal.hidden) { closeDetail(); return; }
        $('#gSearchList').hidden = true;
        setHover(null);
      }
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        if (state.view === 'people') $('#peopleSearch').focus();
        else { if (state.view !== 'graph') setView('graph'); $('#gSearch').focus(); }
      }
    });

    window.addEventListener('hashchange', route);
    window.addEventListener('resize', function () {
      var next = mqMobile.matches ? '640x920' : '1120x720';
      if (svg.getAttribute('data-geo') === next) return;
      svg.setAttribute('data-geo', next);
      geometry();
      model = null;
      renderGraph();
    });
  }

  /* ---------------- 启动 ---------------- */
  fetch('../../api/works/shuihu.json', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('水浒数据加载失败');
    return r.json();
  }).then(function (data) {
    D = data;
    D.characters.forEach(function (p) { p.kind = 'person'; byId[p.id] = p; });
    D.events.forEach(function (e) { e.kind = 'event'; byId[e.id] = e; });
    D.groups.forEach(function (f) { groupById[f.id] = f; });
    D.places.forEach(function (p) { p.kind = 'place'; placeById[p.id] = p; byId[p.id] = p; });
    buildIndices();
    fillStatic();
    renderBars();
    renderRelBar();
    renderFateBar();
    renderLegend();
    modal = $('#modal');
    bindGraph();
    geometry();
    bindChrome();
    svg.setAttribute('data-geo', mqMobile.matches ? '640x920' : '1120x720');
    route();
  }).catch(function (err) {
    var stage = $('.graph-stage');
    if (stage) {
      var p = document.createElement('p');
      p.className = 'load-error';
      p.textContent = err.message + '。请先运行 python3 server/app.py。';
      stage.appendChild(p);
    }
  });
})();