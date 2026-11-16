/* 西游记 · 法脉、关系、西行路线、难簿与隐语（零依赖，单作品模块）
 *
 * 与红楼/三国的分工：
 *   红楼 app.js 是「谱系 + 判词 + 府邸」的渲染器，西游不合用；
 *   三国 sanguo.js 只有关系图，西游在此之上加了三块自己的东西：
 *     1) 路线：站点位置由 (leg, chapter) 计算，加站点不必重排坐标；
 *     2) 难簿：名目 ↔ 实际经过，判定分照应/拆分/补列/存疑；
 *     3) 隐语：分七类，判定分通行/一说/存疑。
 *   关系沿用红楼的做法：同一对人物可有多重关系，图上只画主关系。
 */
(function () {
  'use strict';

  var D = null;
  var byId = {}, groupById = {}, placeById = {};
  var relByPerson = {}, eventsByPerson = {}, trialsByPerson = {}, wordsByPerson = {},
    placesByOwner = {}, eventsByPlace = {};
  var state = {
    view: 'graph', group: 'all', rel: 'all', showEvents: false, pq: '',
    leg: 'all', verdict: 'all', kind: 'all', gview: 'graph', edge: null
  };
  var G = { W: 1120, H: 880 };
  var mqMobile = window.matchMedia('(max-width: 760px)');
  var view = { x: 0, y: 0, k: 1 };
  var model = null, nodePos = {}, neighbors = {}, nodeDeg = {};
  var svg, scene, modal, lastFocus = null;
  var ptrs = {}, dragStart = null, pinchStart = null, dragMoved = false;

  /* 关系权重：图上只画最重的一条，其余进详情（同红楼的处理） */
  var REL_WEIGHT = { master: 0, kin: 1, serve: 2, ally: 3, friend: 4, rival: 5 };
  var REL = {
    master: { label: '师承 · 法脉', color: '#8c1f28' },
    kin: { label: '亲族 · 姻缘', color: '#a8823c' },
    serve: { label: '统属 · 坐骑', color: '#3f6480' },
    ally: { label: '护持 · 相助', color: '#2f6457' },
    friend: { label: '结义 · 故旧', color: '#6e8352' },
    rival: { label: '敌对 · 降服', color: '#7a6953' }
  };
  var REL_ORDER = ['master', 'kin', 'serve', 'ally', 'friend', 'rival'];

  /* 反向称谓来自数据本身（relations[].inv）：
     西游的 label 大多是事件式的（三借芭蕉扇、长鸣制蝎），两端通用；
     只有身份式的（师徒、夫妻、坐骑下界…）需要 inv，例如「弟子」↔「师父」。 */

  /* 难簿判定 */
  var TV = {
    '照应': { cls: 'v-ok', txt: '名目与前文严丝合缝' },
    '拆分': { cls: 'v-split', txt: '同一回被切成两难' },
    '补列': { cls: 'v-add', txt: '不在西行路上（出身或东返）' },
    '存疑': { cls: 'v-doubt', txt: '所指不独立成难，或字句有异' }
  };
  var TV_ORDER = ['照应', '拆分', '补列', '存疑'];

  /* 隐语 */
  var WV = { '通行': 'v-ok', '一说': 'v-sec', '存疑': 'v-doubt' };
  var WV_TXT = { '通行': '有回目或正文硬证', '一说': '评点常见，无硬证', '存疑': '牵强，列出仅为完整' };
  var WK_ORDER = ['拆字·会意', '内丹代号', '名号反语·游戏', '名号寓意', '地名寓意', '佛典用事', '谐音·附会'];

  /* 路线站点符号 */
  var KIND = {
    city: { label: '城 · 国', color: '#b07a52' },
    mountain: { label: '山', color: '#7f9370' },
    ridge: { label: '岭', color: '#8c9a6b' },
    river: { label: '河 · 涧 · 渡', color: '#6f9fa8' },
    cave: { label: '洞府', color: '#8a7b60' },
    temple: { label: '寺 · 观', color: '#a8823c' },
    villa: { label: '庄院', color: '#9a8a6c' }
  };
  var LEGS = [
    { id: 0, name: '出身', sub: '第1—7回' },
    { id: 1, name: '第一段', sub: '大唐境内 · 第13—15回' },
    { id: 2, name: '第二段', sub: '浮屠—流沙 · 第16—23回' },
    { id: 3, name: '第三段', sub: '宝象—车迟 · 第27—46回' },
    { id: 4, name: '第四段', sub: '通天—火焰山 · 第47—61回' },
    { id: 5, name: '第五段', sub: '祭赛—狮驼 · 第62—77回' },
    { id: 6, name: '第六段', sub: '比丘—灵山 · 第78—100回' },
    { id: 9, name: '神界', sub: '不入西行路线' }
  ];

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
  function gcolor(id) { return groupById[id] ? groupById[id].color : '#7a6953'; }

  /* ---------------- 索引 ---------------- */
  function buildIndices() {
    D.characters.forEach(function (c) { byId[c.id] = c; });
    D.places.forEach(function (p) { byId[p.id] = p; placeById[p.id] = p; });
    D.events.forEach(function (e) { byId[e.id] = e; });
    D.groups.forEach(function (g) { groupById[g.id] = g; });

    relByPerson = {}; eventsByPerson = {}; trialsByPerson = {};
    wordsByPerson = {}; placesByOwner = {}; eventsByPlace = {};
    D.relations.forEach(function (r) {
      // 记的是 a→b；a 端看对方用 label，b 端看对方用 inv（如「弟子」↔「师父」）
      (relByPerson[r.a] = relByPerson[r.a] || []).push({ rel: r, dir: 'out' });
      (relByPerson[r.b] = relByPerson[r.b] || []).push({ rel: r, dir: 'in' });
    });
    D.events.forEach(function (ev) {
      ev.cast.forEach(function (pid) {
        (eventsByPerson[pid] = eventsByPerson[pid] || []).push(ev);
      });
      (eventsByPlace[ev.place] = eventsByPlace[ev.place] || []).push(ev);
    });
    D.trials.items.forEach(function (t) {
      (t.who || []).forEach(function (pid) {
        (trialsByPerson[pid] = trialsByPerson[pid] || []).push(t);
      });
    });
    D.wordplay.forEach(function (w) {
      if (!w.person) return;
      (wordsByPerson[w.person] = wordsByPerson[w.person] || []).push(w);
    });
    D.places.forEach(function (p) {
      if (!p.owner) return;
      (placesByOwner[p.owner] = placesByOwner[p.owner] || []).push(p);
    });
  }

  function fillStatic() {
    $('#scopeText').textContent = D.scope;
    $('#sourceText').textContent = D.source;
    $('#subTitle').textContent = D.subtitle;
    if (D.refs && $('#readRefs')) {
      $('#readRefs').innerHTML = '<details><summary>这一页的判定依据哪些书</summary><ul>' +
        D.refs.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></details>';
    }
    $('#statChars').textContent = D.counts.characters;
    $('#statRels').textContent = D.counts.relations;
    $('#statPlaces').textContent = D.counts.places;
    $('#statEvents').textContent = D.counts.events;
    $('#statTrials').textContent = D.counts.trials;
    $('#statWords').textContent = D.counts.wordplay;
  }

  /* ---------------- 路由 ---------------- */
  function route() {
    var h = (location.hash || '#graph').replace(/^#/, '');
    var parts = h.split('/');
    /* 筛选值可能是中文（#trials/补列），hash 里是百分号编码，要先还原 */
    if (parts[1]) { try { parts[1] = decodeURIComponent(parts[1]); } catch (e) { /* 保留原值 */ } }
    if (parts[0] === 'item' && parts[1]) { openItem(decodeURIComponent(parts[1])); return; }
    var v = parts[0] || 'graph';
    if (['graph', 'route', 'trials', 'wordplay', 'people', 'events'].indexOf(v) >= 0) state.view = v;
    $$('.view').forEach(function (el) { el.hidden = el.id !== 'view-' + state.view; });
    $$('.mainnav button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === state.view);
    });
    window.scrollTo(0, 0);
    if (state.view === 'graph') { renderBars(); renderGraph(); }
    if (state.view === 'route') renderRoute(parts[1]);
    if (state.view === 'trials') renderTrials(parts[1]);
    if (state.view === 'wordplay') renderWords(parts[1]);
    if (state.view === 'people') renderPeople();
    if (state.view === 'events') renderEvents();
  }

  /* ---------------- 筛选条 ---------------- */
  function chip(html) { return '<button type="button" class="f-chip">' + html + '</button>'; }

  function groupChips(box, current, attr) {
    var head = '<button type="button" class="f-chip' + (current === 'all' ? ' on' : '') +
      '" data-' + attr + '="all"><i class="dot all"></i>全部</button>';
    return head + D.groups.map(function (g) {
      return '<button type="button" class="f-chip' + (current === g.id ? ' on' : '') +
        '" data-' + attr + '="' + g.id + '"><i class="dot" style="background:' + g.color +
        '"></i>' + esc(g.name) + '</button>';
    }).join('');
  }

  function renderBars() {
    ['#gGroup', '#pGroup', '#eGroup'].forEach(function (sel) {
      var box = $(sel);
      if (box) box.innerHTML = groupChips(box, state.group, 'group');
    });
  }

  /* 委托绑在容器上：重绘 innerHTML 之后监听不会丢，也不必重复绑定 */
  function bindGroupBars() {
    ['#gGroup', '#pGroup', '#eGroup'].forEach(function (sel) {
      var box = $(sel);
      if (!box) return;
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-group]');
        if (b) setGroup(b.getAttribute('data-group'));
      });
    });
  }

  function setGroup(v) {
    state.group = v;
    renderBars();
    hideTip();
    renderGraph();
    renderPeople();
    renderEvents();
  }

  /* ---------------- 图谱：模型、布局、渲染 ---------------- */
  function mainRelations() {
    /* 同一对人物只留权重最高的一条；其余在详情里并列 */
    var best = {};
    D.relations.forEach(function (r) {
      var key = [r.a, r.b].sort().join('|');
      var cur = best[key];
      if (!cur || REL_WEIGHT[r.group] < REL_WEIGHT[cur.group]) best[key] = r;
    });
    return Object.keys(best).map(function (k) { return best[k]; });
  }

  function ensureModel() {
    if (model && model.showEvents === state.showEvents && model.w === G.W) return;
    model = { showEvents: state.showEvents, w: G.W, nodes: [], edges: [] };
    D.characters.forEach(function (c) {
      model.nodes.push({ id: c.id, name: c.name, kind: 'person', group: c.group });
    });
    model.edges = mainRelations().map(function (r) {
      return { a: r.a, b: r.b, kind: 'relation', group: r.group, label: r.label, chapter: r.chapter };
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
    /* 移动端画布用 3:4，且刻意做小（540×720）：
       画布越小，viewBox→CSS 的缩放系数越大，11.5px 的标签才不会被缩成看不清；
       同时逼标签避让只保留少数重要节点，避免 108 个名字糊成一片。 */
    G = mqMobile.matches ? { W: 540, H: 720 } : { W: 1120, H: 880 };
    if (svg) svg.setAttribute('viewBox', '0 0 ' + G.W + ' ' + G.H);
  }

  /* 六界锚点：取经团队居中，人间/仙真在东（上），佛国在天庭（右），妖魔在下 */
  function anchorsFor() {
    if (mqMobile.matches) {
      return {
        tu: { x: 270, y: 356 }, ren: { x: 112, y: 158 }, dao: { x: 424, y: 152 },
        fo: { x: 440, y: 486 }, tian: { x: 126, y: 498 }, yao: { x: 274, y: 620 }
      };
    }
    return {
      tu: { x: 560, y: 450 }, ren: { x: 190, y: 210 }, dao: { x: 560, y: 150 },
      fo: { x: 950, y: 240 }, tian: { x: 960, y: 640 }, yao: { x: 300, y: 700 }
    };
  }

  function layout() {
    var anchors = anchorsFor();
    var compact = G.W < 800;
    var people = model.nodes.filter(function (n) { return n.kind === 'person'; });
    var relEdges = model.edges.filter(function (e) { return e.kind === 'relation'; });
    /* 斥力随节点数走：67 人时 3300 够用，108 人会挤成一团 */
    var scale = Math.sqrt(people.length / 60);
    var repulsion = (compact ? 2100 : 3300) * scale;
    var springLen = (compact ? 78 : 104) * Math.min(1.25, scale);
    var CORE = { 'tang-seng': 2.2, 'wu-kong': 2.2, 'ba-jie': 1.8, 'sha-seng': 1.8, 'bai-long-ma': 1.8 };
    var p = {}, ids = [];

    var gsize = {};
    people.forEach(function (n) { gsize[n.group] = (gsize[n.group] || 0) + 1; });
    people.forEach(function (n, i) {
      var a = anchors[n.group] || { x: G.W / 2, y: G.H / 2 };
      var ang = (hash(n.id) % 360) * Math.PI / 180 + i * 0.7;
      /* 人多的界摊得更开，否则妖魔（41 人）会挤成一坨 */
      var spread = clamp(Math.sqrt((gsize[n.group] || 1) / 6), 1, 2.6);
      var rad = (40 + hash(n.id) % 78) * spread;
      p[n.id] = { x: a.x + Math.cos(ang) * rad, y: a.y + Math.sin(ang) * rad, vx: 0, vy: 0, fx: 0, fy: 0 };
      ids.push(n.id);
    });

    for (var iter = 0; iter < 300; iter++) {
      ids.forEach(function (k) { p[k].fx = 0; p[k].fy = 0; });
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          var A = p[ids[i]], B = p[ids[j]];
          var dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) d2 = 1;
          var d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
          var f = repulsion * (CORE[ids[i]] || 1) * (CORE[ids[j]] || 1) / d2;
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
        var n = people.filter(function (x) { return x.id === k; })[0];
        var a = anchors[n.group] || { x: G.W / 2, y: G.H / 2 };
        p[k].fx += (a.x - p[k].x) * 0.012;
        p[k].fy += (a.y - p[k].y) * 0.012;
      });
      ids.forEach(function (k) {
        var q = p[k];
        q.vx = (q.vx + q.fx) * 0.6; q.vy = (q.vy + q.fy) * 0.6;
        var sp = Math.sqrt(q.vx * q.vx + q.vy * q.vy);
        if (sp > 12) { q.vx *= 12 / sp; q.vy *= 12 / sp; }
        q.x = clamp(q.x + q.vx, 34, G.W - 34);
        q.y = clamp(q.y + q.vy, 30, G.H - 30);
      });
    }

    /* 事件节点：挂在出场人物重心附近 */
    if (state.showEvents) {
      D.events.forEach(function (ev) {
        var cx = 0, cy = 0, n = 0;
        ev.cast.forEach(function (pid) {
          if (!p[pid]) return;
          cx += p[pid].x; cy += p[pid].y; n++;
        });
        if (!n) return;
        var ang = (hash(ev.id) % 360) * Math.PI / 180;
        nodePos[ev.id] = { x: clamp(cx / n + Math.cos(ang) * 46, 30, G.W - 30),
          y: clamp(cy / n + Math.sin(ang) * 46, 26, G.H - 26) };
      });
    }
    Object.keys(p).forEach(function (k) { nodePos[k] = p[k]; });
  }

  function computeDegrees() {
    nodeDeg = {}; neighbors = {};
    model.nodes.forEach(function (n) { nodeDeg[n.id] = 0; neighbors[n.id] = []; });
    model.edges.forEach(function (e) {
      nodeDeg[e.a] = (nodeDeg[e.a] || 0) + 1;
      nodeDeg[e.b] = (nodeDeg[e.b] || 0) + 1;
      if (neighbors[e.a]) neighbors[e.a].push(e.b);
      if (neighbors[e.b]) neighbors[e.b].push(e.a);
    });
  }

  /* 标签避让：108 个节点全标会糊成一片。
     按度数降序贪心——高度数的先占位，给每个标签试 下/上/右/左 四个位置，
     全都撞车的就不标（点或悬停仍能看到名字）。核心人物永远有名字。 */
  function placeLabels(persons) {
    var CORE = ['tang-seng', 'wu-kong', 'ba-jie', 'sha-seng', 'bai-long-ma'];
    var taken = [];
    var out = {};
    function fits(b) {
      if (b.x < 4 || b.y < 4 || b.x + b.w > G.W - 4 || b.y + b.h > G.H - 4) return false;
      for (var i = 0; i < taken.length; i++) {
        var o = taken[i];
        if (b.x < o.x + o.w + 3 && b.x + b.w + 3 > o.x && b.y < o.y + o.h + 2 && b.y + b.h + 2 > o.y) return false;
      }
      return true;
    }
    var order = persons.slice().sort(function (x, y) {
      var cx = CORE.indexOf(x.id) >= 0 ? 1 : 0, cy = CORE.indexOf(y.id) >= 0 ? 1 : 0;
      if (cx !== cy) return cy - cx;
      return (nodeDeg[y.id] || 0) - (nodeDeg[x.id] || 0);
    });
    // 窄屏只标前 22 个（核心五人优先），其余靠悬停、搜索与点击
    if (G.W < 800) order = order.slice(0, 22);
    order.forEach(function (n) {
      var q = nodePos[n.id];
      if (!q) return;
      var r = nodeRadius(n);
      var name = n.name.length > 6 ? n.name.slice(0, 5) + '…' : n.name;
      var w = Math.round(name.length * 11.6 + 4), h = 13;
      var cands = [
        { cx: q.x, cy: q.y + r + 4 + h / 2 },
        { cx: q.x, cy: q.y - r - 4 - h / 2 },
        { cx: q.x + r + 6 + w / 2, cy: q.y + h / 2 - 2 },
        { cx: q.x - r - 6 - w / 2, cy: q.y + h / 2 - 2 }
      ];
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        var box = { x: c.cx - w / 2, y: c.cy - h / 2, w: w, h: h };
        if (fits(box)) {
          taken.push(box);
          out[n.id] = { x: c.cx, y: c.cy, name: name };
          return;
        }
      }
    });
    return out;
  }

  function nodeRadius(n) {
    if (n.kind === 'event') return 5.5;
    var deg = nodeDeg[n.id] || 0;
    var core = ['tang-seng', 'wu-kong', 'ba-jie', 'sha-seng', 'bai-long-ma'].indexOf(n.id) >= 0;
    return core ? 14 : clamp(7 + deg * 1.15, 8, 12.5);
  }

  function renderGraph() {
    geometry();
    ensureModel();
    svg = svg || $('#gSvg');
    scene = scene || (function () {
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(g);
      return g;
    })();

    var byId2 = {};
    model.nodes.forEach(function (n) { byId2[n.id] = n; });
    /* 选「妖魔」时不该只看见妖魔：本界节点 + 直接相连的邻界节点 + 至少一端在本界的边 */
    var inGroup = {}, halo = {};
    if (state.group === 'all') {
      model.nodes.forEach(function (n) { inGroup[n.id] = true; });
    } else {
      model.nodes.forEach(function (n) {
        if (n.kind === 'person' && n.group === state.group) inGroup[n.id] = true;
      });
      model.edges.forEach(function (e) {
        if (inGroup[e.a]) halo[e.b] = true;
        if (inGroup[e.b]) halo[e.a] = true;
      });
    }
    var show = function (id) {
      var n = byId2[id];
      if (!n) return false;
      if (n.kind === 'event') return state.group === 'all';
      return !!inGroup[id] || !!halo[id];
    };
    var edgeShown = function (e) {
      if (e.kind === 'event' && state.group !== 'all') return false;
      if (state.rel !== 'all' && e.group !== state.rel) return false;
      if (state.group === 'all') return true;
      return !!inGroup[e.a] || !!inGroup[e.b];
    };

    var persons = model.nodes.filter(function (n) { return n.kind === 'person'; });
    var labelAt = placeLabels(persons);

    var out = [];
    /* 岛名做底纹水印：画在最底层，节点压在上面才不会互相遮挡 */
    if (state.group === 'all') {
      var anc = anchorsFor();
      D.groups.forEach(function (g) {
        var a = anc[g.id];
        if (!a) return;
        out.push('<text class="g-isle" x="' + a.x + '" y="' + (a.y + 10) + '" fill="' +
          g.color + '">' + esc(g.name) + '</text>');
      });
    }

    /* 边 */
    model.edges.forEach(function (e, i) {
      var A = nodePos[e.a], B = nodePos[e.b];
      if (!A || !B) return;
      if (!edgeShown(e)) return;
      var color = e.kind === 'event' ? '#b6a888' : (REL[e.group] || REL.rival).color;
      var geo = 'x1="' + A.x.toFixed(1) + '" y1="' + A.y.toFixed(1) +
        '" x2="' + B.x.toFixed(1) + '" y2="' + B.y.toFixed(1) + '"';
      out.push('<line class="g-edge' + (e.kind === 'event' ? ' ev' : '') + '" ' + geo +
        ' stroke="' + color + '" data-e="' + i + '"/>');
      if (e.kind === 'relation') {
        /* 细线不好点，补一条透明粗线做热区 */
        out.push('<line class="g-hit" ' + geo + ' data-e="' + i + '"/>');
      }
    });

    /* 节点 */
    model.nodes.forEach(function (n) {
      var q = nodePos[n.id];
      if (!q) return;
      if (!show(n.id)) return;
      var r = nodeRadius(n);
      var cls = 'g-node' + (n.kind === 'event' ? ' ev' : '') +
        (state.group !== 'all' && !inGroup[n.id] && halo[n.id] ? ' halo' : '');
      var color = n.kind === 'event' ? '#8d7751' : gcolor(n.group);
      out.push('<g class="' + cls + '" data-n="' + n.id + '" transform="translate(' +
        q.x.toFixed(1) + ',' + q.y.toFixed(1) + ')">');
      if (n.kind === 'person' && n.name.length > 6) {
        out.push('<title>' + esc(n.name) + '</title>');
      }
      if (n.kind === 'person') {
        var hasTrial = !!(trialsByPerson[n.id] || []).length;
        var hasWord = !!(wordsByPerson[n.id] || []).length;
        if (hasWord) out.push('<circle class="g-ring" r="' + (r + 4.5) + '" stroke="#a8823c"/>');
        if (hasTrial) out.push('<circle class="g-ring t" r="' + (r + 8) + '" stroke="#8c1f28"/>');
      }
      out.push('<circle class="g-dot" r="' + r + '" fill="' + color + '"/>');
      if (n.kind === 'person') {
        // 位置由 placeLabels 的避让结果决定（相对节点圆心的偏移）
        var lb = labelAt[n.id];
        if (lb) {
          out.push('<text class="g-label" x="' + (lb.x - q.x).toFixed(1) +
            '" y="' + (lb.y - q.y + 4).toFixed(1) + '">' + esc(lb.name) + '</text>');
        }
      } else {
        out.push('<text class="g-label sm" y="' + (r + 12) + '">' + esc(n.name) + '</text>');
      }
      out.push('</g>');
    });

    scene.innerHTML = out.join('');
    renderRelBar();
    applyZoom();

    $$('.g-node', scene).forEach(function (g) {
      var id = g.getAttribute('data-n');
      g.addEventListener('mouseenter', function () { hover(id); showTip(id, g); });
      g.addEventListener('mouseleave', function () { hover(null); hideTip(); });
      g.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openItem(id);
      });
    });
    $$('.g-hit', scene).forEach(function (l) {
      l.addEventListener('click', function (ev) {
        ev.stopPropagation();
        showEdgePanel(model.edges[+l.getAttribute('data-e')]);
      });
    });
    hideEdgePanel();

    var n = $$('.g-node', scene).length, e = $$('.g-edge', scene).length;
    $('#gCount').textContent = n + ' 个节点 · ' + e + ' 条主线（人物库 ' + D.counts.characters +
      '，关系 ' + D.counts.relations + ' 条，多重关系已取主）';
    renderLegend();
  }

  /* 关系类型条（与「界」筛选是两个维度，可叠加） */
  function renderRelBar() {
    var box = $('#gRelBar');
    if (!box) return;
    var counts = {};
    D.relations.forEach(function (r) { counts[r.group] = (counts[r.group] || 0) + 1; });
    box.innerHTML = '<button type="button" class="f-chip' + (state.rel === 'all' ? ' on' : '') +
      '" data-rel="all">全部关系 ' + D.relations.length + '</button>' + REL_ORDER.map(function (k) {
        return '<button type="button" class="f-chip' + (state.rel === k ? ' on' : '') +
          '" data-rel="' + k + '"><i class="dot" style="background:' + REL[k].color + '"></i>' +
          REL[k].label + ' ' + (counts[k] || 0) + '</button>';
      }).join('');
  }

  function setGView(v) {
    state.gview = v;
    $$('#gViewSeg [data-gview]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-gview') === v);
    });
    var stage = $('.graph-stage'), list = $('#gList');
    if (stage) stage.style.display = v === 'graph' ? '' : 'none';
    if (list) list.hidden = v !== 'list';
    if (v === 'list') renderGraphList();
    else renderGraph();
  }

  /* 列表视图：按关系类型分组，行内 a—rel—b，可搜可点 */
  function gvRows() {
    var q = ($('#gListSearch').value || '').trim().toLowerCase();
    var rows = D.relations.map(function (r) {
      return { a: byId[r.a], b: byId[r.b], label: r.label, cat: r.group, chapter: r.chapter };
    }).filter(function (r) {
      if (!r.a || !r.b) return false;
      if (state.rel !== 'all' && r.cat !== state.rel) return false;
      if (state.group !== 'all' && r.a.group !== state.group && r.b.group !== state.group) return false;
      if (!q) return true;
      return (r.a.name + ' ' + r.b.name + ' ' + r.label + ' ' + REL[r.cat].label).toLowerCase().indexOf(q) >= 0;
    });
    rows.sort(function (x, y) {
      var d = REL_ORDER.indexOf(x.cat) - REL_ORDER.indexOf(y.cat);
      return d || x.chapter - y.chapter;
    });
    return rows;
  }

  function renderGraphList() {
    var rows = gvRows();
    $('#gListCount').textContent = rows.length + ' 条关系';
    var last = null, html = '';
    rows.forEach(function (r) {
      if (r.cat !== last) {
        last = r.cat;
        html += '<div class="glist-head" style="color:' + REL[r.cat].color + '">' +
          REL[r.cat].label + '</div>';
      }
      html += '<button class="glist-row" data-a="' + r.a.id + '" data-b="' + r.b.id +
        '" data-label="' + esc(r.label) + '" data-ch="' + r.chapter + '">' +
        '<span class="gl-a">' + esc(r.a.name) + '</span>' +
        '<span class="gl-rel">' + esc(r.label) + '</span>' +
        '<span class="gl-b">' + esc(r.b.name) + '</span>' +
        '<span class="gl-ch">' + r.chapter + '回</span></button>';
    });
    $('#gListBody').innerHTML = html || '<div class="glist-empty">没有符合条件的关系。</div>';
    $$('#gListBody .glist-row').forEach(function (b) {
      b.addEventListener('click', function () {
        // 直接取原始关系对象（带 kind/group/inv），别在这儿重新拼
        var a = b.getAttribute('data-a'), lab = b.getAttribute('data-label');
        var rel = D.relations.filter(function (r) {
          return r.a === a && r.b === b.getAttribute('data-b') && r.label === lab;
        })[0];
        if (!rel) return;
        openRelation({ a: rel.a, b: rel.b, label: rel.label, inv: rel.inv,
          group: rel.group, chapter: rel.chapter, kind: 'relation' });
      });
    });
  }

  /* 两人共同出场的事件（红楼的关系卡就是这么做的） */
  function sharedEvents(a, b) {
    var ea = eventsByPerson[a] || [], eb = {};
    (eventsByPerson[b] || []).forEach(function (e) { eb[e.id] = 1; });
    return ea.filter(function (e) { return eb[e.id]; });
  }

  /* 点线：画布上浮出小面板，不打断看图；要看全的进弹窗 */
  function showEdgePanel(e) {
    var panel = $('#gEdgePanel');
    if (!panel) return;
    var A = byId[e.a], B = byId[e.b];
    if (!A || !B) return;
    state.edge = e;
    var pair = D.relations.filter(function (r) {
      return (r.a === e.a && r.b === e.b) || (r.a === e.b && r.b === e.a);
    });
    var extra = pair.filter(function (r) { return r.label !== e.label; });
    var shared = sharedEvents(e.a, e.b);
    panel.innerHTML =
      '<div class="ep-head"><button data-go="' + A.id + '">' + esc(A.name) + '</button>' +
      '<span class="ep-rel">' + esc(e.label) + '</span>' +
      '<button data-go="' + B.id + '">' + esc(B.name) + '</button></div>' +
      '<div class="ep-meta">' + REL[e.group].label + ' · ' + ch(e.chapter) + '</div>' +
      (extra.length ? '<p class="ep-also">同一对人物另有：' +
        extra.map(function (r) { return '「' + esc(r.label) + '」' + r.chapter + '回'; }).join(' ') + '</p>' : '') +
      (shared.length ? '<div class="ep-ev"><h4>共同事件（' + shared.length + '）</h4>' +
        shared.map(function (x) {
          return '<button data-go="' + x.id + '"><span>' + x.chapter + '</span>' + esc(x.name) + '</button>';
        }).join('') + '</div>'
        : '<p class="ep-none">两人在现有条目里没有共同出场的事件。</p>') +
      '<button class="ep-more" data-more="1">看完整关系卡 →</button>';
    panel.hidden = false;
    positionEdgePanel();
    $$('#gEdgePanel [data-go]').forEach(function (el) {
      el.addEventListener('click', function () { hideEdgePanel(); openItem(el.getAttribute('data-go')); });
    });
    var more = $('#gEdgePanel [data-more]');
    if (more) more.addEventListener('click', function () { hideEdgePanel(); openRelation(e); });
  }

  function positionEdgePanel() {
    var panel = $('#gEdgePanel');
    if (!panel || panel.hidden || !state.edge) return;
    var A = nodePos[state.edge.a], B = nodePos[state.edge.b];
    if (!A || !B) return;
    var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    var sx = r.width / vb.width, sy = r.height / vb.height;
    var mx = (A.x + B.x) / 2 * view.k + view.x, my = (A.y + B.y) / 2 * view.k + view.y;
    var w = panel.offsetWidth || 260, h = panel.offsetHeight || 140;
    panel.style.left = clamp(mx * sx - w / 2, 8, r.width - w - 8) + 'px';
    panel.style.top = clamp(my * sy - h / 2, 8, r.height - h - 8) + 'px';
  }

  function hideEdgePanel() {
    var panel = $('#gEdgePanel');
    if (panel) panel.hidden = true;
    state.edge = null;
  }

  /* 全屏：画布铺满视口，工具条浮在底部 */
  function setFs(on) {
    document.body.classList.toggle('xy-fs', on);
    if (on) {
      var stage = $('.graph-stage');
      var r = stage.getBoundingClientRect();
      G = { W: Math.round(r.width), H: Math.round(r.height) };
      svg.setAttribute('viewBox', '0 0 ' + G.W + ' ' + G.H);
      model = null;
      renderGraph();
    } else {
      geometry();
      model = null;
      renderGraph();
    }
  }

  function renderLegend() {
    $('#gLegend').innerHTML = D.groups.map(function (g) {
      return '<span><i style="background:' + g.color + '"></i>' + esc(g.name) + '</span>';
    }).join('') + REL_ORDER.map(function (k) {
      return '<span class="el"><i style="border-color:' + REL[k].color + '"></i>' + REL[k].label + '</span>';
    }).join('') +
      '<span class="el ring"><i></i>有隐语</span><span class="el ring t"><i></i>有难簿对照</span>';
  }

  function hover(id) {
    state.hover = id;
    if (!scene) return;
    var on = !id;
    $$('.g-node', scene).forEach(function (g) {
      var nid = g.getAttribute('data-n');
      g.classList.toggle('dim', !on && nid !== id && (neighbors[id] || []).indexOf(nid) < 0);
      g.classList.toggle('hot', !on && nid === id);
    });
    $$('.g-edge', scene).forEach(function (l) {
      var e = model.edges[+l.getAttribute('data-e')];
      var hit = !on && (e.a === id || e.b === id);
      l.classList.toggle('dim', !on && !hit);
      l.classList.toggle('hot', hit);
    });
  }

  function showTip(id, g) {
    var tip = $('#gTip'), n = byId[id];
    if (!tip || !n) return;
    var r = g.getBoundingClientRect(), s = svg.getBoundingClientRect();
    var body = n.kind === 'event'
      ? '<b>' + esc(n.name) + '</b><small>' + ch(n.chapter) + ' · 出场 ' + n.cast.length + ' 人</small>'
      : '<b>' + esc(n.name) + '</b>' + (n.alias ? '<small>' + esc(n.alias) + '</small>' : '') +
        '<small>' + esc((groupById[n.group] || {}).name || '') + ' · ' + esc(n.role) + '</small>';
    tip.innerHTML = body;
    tip.hidden = false;
    tip.style.left = clamp(r.left + r.width / 2 - 62, 6, window.innerWidth - 140) + 'px';
    tip.style.top = (r.top - 10) + 'px';
    tip.style.transform = 'translateY(-100%)';
  }

  function hideTip() { var t = $('#gTip'); if (t) t.hidden = true; }

  /* ---------------- 缩放平移 ---------------- */
  function applyZoom() {
    if (!scene) return;
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    var lbl = $('#gZoomLabel');
    if (lbl) lbl.textContent = Math.round(view.k * 100) + '%';
    var fs2 = $('#fsZoomLabel');
    if (fs2) fs2.textContent = Math.round(view.k * 100) + '%';
    positionEdgePanel();
  }

  function zoomBy(f, cx, cy) {
    var k0 = view.k, k = clamp(k0 * f, 0.5, 3);
    if (k === k0) return;
    if (cx != null) { view.x = cx - (cx - view.x) * (k / k0); view.y = cy - (cy - view.y) * (k / k0); }
    view.k = k;
    applyZoom();
  }

  function svgPoint(ev) {
    var r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * G.W, y: (ev.clientY - r.top) / r.height * G.H };
  }

  function bindGraphStage() {
    /* svg 在 renderGraph 里才建 scene，但事件要绑在 svg 本身：这里先拿到它，
       否则 bindChrome 会抛错，连带 hashchange 监听也注册不上（视图切不动）。 */
    svg = svg || $('#gSvg');
    var stage = $('.graph-stage');
    stage.addEventListener('wheel', function (e) {
      if (state.view !== 'graph') return;
      e.preventDefault();
      var pt = svgPoint(e);
      zoomBy(e.deltaY > 0 ? 0.9 : 1.1, pt.x, pt.y);
    }, { passive: false });

    svg.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('.g-hit')) hideEdgePanel();
      if (e.target.closest('.g-node') || e.target.closest('.g-hit')) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      dragMoved = false;
      if (Object.keys(ptrs).length === 1) {
        dragStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        svg.setPointerCapture(e.pointerId);
      } else if (Object.keys(ptrs).length === 2) {
        var k = Object.keys(ptrs);
        pinchStart = { d: dist(ptrs[k[0]], ptrs[k[1]]), k: view.k };
      }
    });
    svg.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 1 && dragStart) {
        var r = svg.getBoundingClientRect();
        var dx = (e.clientX - dragStart.x) / r.width * G.W;
        var dy = (e.clientY - dragStart.y) / r.height * G.H;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
        view.x = dragStart.vx + dx; view.y = dragStart.vy + dy;
        applyZoom();
      } else if (ids.length === 2 && pinchStart) {
        var d = dist(ptrs[ids[0]], ptrs[ids[1]]);
        zoomBy((d / pinchStart.d) * (pinchStart.k / view.k));
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      svg.addEventListener(t, function (e) {
        delete ptrs[e.pointerId];
        if (!Object.keys(ptrs).length) { dragStart = null; pinchStart = null; }
      });
    });

    $('#gZoom').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-zoom]');
      if (!b) return;
      var m = b.getAttribute('data-zoom');
      if (m === 'in') zoomBy(1.2);
      else if (m === 'out') zoomBy(1 / 1.2);
      else { view = { x: 0, y: 0, k: 1 }; applyZoom(); }
    });
  }

  function dist(a, b) { return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)); }

  /* ---------------- 图谱搜索 ---------------- */
  function bindSearch() {
    var input = $('#gSearch'), list = $('#gSearchList');
    input.addEventListener('input', function () {
      state.pq = input.value.trim();
      if (!state.pq) { list.hidden = true; hover(null); return; }
      var hits = D.characters.filter(function (c) {
        return (c.name + ' ' + (c.alias || '') + ' ' + c.summary).indexOf(state.pq) >= 0;
      }).slice(0, 8);
      list.hidden = !hits.length;
      list.innerHTML = hits.map(function (c) {
        return '<button type="button" data-pick="' + c.id + '"><i style="background:' +
          gcolor(c.group) + '"></i>' + esc(c.name) +
          (c.alias ? '<small>' + esc(c.alias) + '</small>' : '') + '</button>';
      }).join('');
      $$('[data-pick]', list).forEach(function (b) {
        b.addEventListener('click', function () {
          locate(b.getAttribute('data-pick'));
          list.hidden = true;
        });
      });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = $('[data-pick]', list);
        if (first) { locate(first.getAttribute('data-pick')); list.hidden = true; }
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.gsearch')) list.hidden = true;
    });
  }

  /* 定位：恢复全筛选、把该点移到视野中心并闪烁 */
  function locate(id) {
    if (state.view !== 'graph') { location.hash = '#graph'; }
    state.group = 'all';
    renderBars();
    renderGraph();
    var q = nodePos[id];
    if (!q) return;
    view.k = clamp(1.5, 0.5, 3);
    view.x = G.W / 2 - q.x * view.k;
    view.y = G.H / 2 - q.y * view.k;
    applyZoom();
    var g = $('.g-node[data-n="' + id + '"]', scene);
    if (g) {
      g.classList.add('flash');
      setTimeout(function () { g.classList.remove('flash'); }, 1400);
      hover(id);
    }
  }

  /* ---------------- 西行路线 ---------------- */
  /* 站点位置不写死：按 leg 分行、行内按回目自东（左）而西（右）排 */
  var ROUTE = { W: 1000, pad: 88, top: 142, rowH: 104, godTop: 22, godH: 52 };

  function routeSites(leg) {
    return D.places.filter(function (p) {
      return p.leg !== 9 && (leg === 'all' || p.leg === +leg);
    }).sort(function (a, b) { return a.chapter - b.chapter || String(a.id).localeCompare(b.id); });
  }

  function legRows() {
    var legs = [0, 1, 2, 3, 4, 5, 6];
    return legs.map(function (l) {
      return { leg: l, sites: D.places.filter(function (p) { return p.leg === l; })
        .sort(function (a, b) { return a.chapter - b.chapter; }) };
    }).filter(function (r) { return r.sites.length; });
  }

  function layoutRoute() {
    var rows = legRows();
    var inner = ROUTE.W - ROUTE.pad * 2;
    var pos = {};
    rows.forEach(function (r, ri) {
      r.ri = ri;
      var n = r.sites.length;
      var step = n > 1 ? inner / (n - 1) : 0;
      var y = ROUTE.top + ri * ROUTE.rowH;
      r.sites.forEach(function (s, i) {
        pos[s.id] = { x: n > 1 ? ROUTE.pad + step * i : ROUTE.W / 2, y: y, row: ri };
      });
      r.y = y;
    });
    return { rows: rows, pos: pos };
  }

  /* 站点符号：山用三角、水用波纹、城用城垛、寺用重檐、洞用拱门、庄用简屋 */
  function siteGlyph(kind, x, y, color, big) {
    var s = big ? 1.25 : 1;
    var g = '<g class="r-site-glyph" transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    if (kind === 'mountain' || kind === 'ridge') {
      g += '<path class="rg-fill" fill="' + color + '" d="M-13 9 L-4-8 L2-1 L8-9 L13 9 Z"/>';
    } else if (kind === 'river') {
      g += '<path class="rg-line" stroke="' + color + '" d="M-14 2q4.5-5 9 0t9 0 9 0"/>' +
        '<path class="rg-line" stroke="' + color + '" d="M-14 8q4.5-5 9 0t9 0 9 0"/>';
    } else if (kind === 'city') {
      g += '<path class="rg-fill" fill="' + color + '" d="M-13 9v-9h4v-3h4v3h6v-3h4v3h4v9z"/>';
    } else if (kind === 'temple') {
      g += '<path class="rg-fill" fill="' + color + '" d="M-14-1 L0-11 L14-1z"/>' +
        '<path class="rg-fill" fill="' + color + '" d="M-10 9v-7h20v7z" opacity=".72"/>';
    } else if (kind === 'cave') {
      g += '<path class="rg-fill" fill="' + color + '" d="M-12 9v-6a12 12 0 0 1 24 0v6z" opacity=".85"/>' +
        '<path class="rg-hole" d="M-4 9v-5a4 4 0 0 1 8 0v5z"/>';
    } else {
      g += '<path class="rg-fill" fill="' + color + '" d="M-12 9v-8L0-11 12 1v8z"/>';
    }
    return g + '</g>';
  }

  function renderRoute(leg) {
    if (['0', '1', '2', '3', '4', '5', '6', 'all'].indexOf(String(leg)) >= 0) state.leg = String(leg);
    var box = $('#rLeg');
    box.innerHTML = '<button type="button" class="f-chip' + (state.leg === 'all' ? ' on' : '') +
      '" data-leg="all">全程</button>' + [0, 1, 2, 3, 4, 5, 6].map(function (l) {
        var meta = LEGS.filter(function (m) { return m.id === l; })[0];
        return '<button type="button" class="f-chip' + (state.leg === String(l) ? ' on' : '') +
          '" data-leg="' + l + '">' + esc(meta.name) + '</button>';
      }).join('');
    $$('[data-leg]', box).forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#route/' + b.getAttribute('data-leg'); });
    });

    var L = layoutRoute();
    var rows = state.leg === 'all' ? L.rows : L.rows.filter(function (r) { return String(r.leg) === state.leg; });
    /* viewBox 高度随行数变：单段视图不必留一屏空白 */
    var bottom = ROUTE.top + (state.leg === 'all' ? L.rows.length : 1) * ROUTE.rowH + 26;
    $('#rSvg').setAttribute('viewBox', '0 0 ' + ROUTE.W + ' ' + bottom);
    var out = [];

    /* 图题在左上，神界带在右上，两者不叠 */
    out.push('<text class="r-title" x="40" y="46">西天取经路</text>' +
      '<text class="r-sub" x="40" y="68">按回目排布 · 自左（东）而右（西）· 示意，非实测地理</text>');
    /* 方向标紧贴图题右侧；神界带从 x≈360 起，两者不叠 */
    out.push('<g class="r-compass">' +
      '<text class="rc-e" x="252" y="46">东</text>' +
      '<path class="rc-line" d="M274 42H322"/><path class="rc-head" d="M322 42l-6-3v6z"/>' +
      '<text class="rc-s" x="332" y="46">西</text></g>');

    var gods = D.places.filter(function (p) { return p.leg === 9; });
    if (gods.length) {
      var gw = 104, pad0 = 62;
      var bandW = gods.length * gw + pad0 + 16;
      var gx0 = ROUTE.W - 40 - bandW;
      out.push('<g class="r-god-band"><rect x="' + gx0 + '" y="' + ROUTE.godTop + '" width="' +
        bandW + '" height="' + ROUTE.godH + '" rx="9"/>' +
        '<text class="r-god-lb" x="' + (gx0 + 12) + '" y="' + (ROUTE.godTop + 33) + '">神界</text>');
      gods.forEach(function (p, i) {
        var x = gx0 + pad0 + i * gw + 22;
        out.push('<g class="r-site god" data-p="' + p.id + '">' +
          '<title>' + esc(p.name + '\n' + p.summary) + '</title>' +
          siteGlyph(p.kind, x, ROUTE.godTop + 20, '#8d8574') +
          '<text class="r-name sm" x="' + x + '" y="' + (ROUTE.godTop + 46) + '">' + esc(p.name) + '</text></g>');
      });
      out.push('</g>');
    }

    /* 每段：带底 + 主线 + 站点 */
    rows.forEach(function (r) {
      var meta = LEGS.filter(function (m) { return m.id === r.leg; })[0];
      var y = L.pos[r.sites[0].id].y;
      out.push('<g class="r-row">');
      out.push('<rect class="r-band" x="40" y="' + (y - 34) + '" width="920" height="82" rx="10"/>');
      out.push('<text class="r-leg-lb" x="52" y="' + (y - 42) + '">' + esc(meta.name) +
        '<tspan class="r-leg-sub"> ' + esc(meta.sub) + '</tspan></text>');

      /* 连线 */
      for (var i = 0; i < r.sites.length - 1; i++) {
        var a = L.pos[r.sites[i].id], b = L.pos[r.sites[i + 1].id];
        out.push('<path class="r-road" d="M' + (a.x + 16) + ' ' + a.y + ' H' + (b.x - 16) + '"/>');
      }
      /* 段间过渡（虚线折角） */
      if (state.leg === 'all' && r.ri + 1 < L.rows.length) {
        var nxt = L.rows[r.ri + 1];
        var c = L.pos[nxt.sites[0].id];
        var xEnd = L.pos[r.sites[r.sites.length - 1].id].x;
        out.push('<path class="r-transfer" d="M' + xEnd + ' ' + y + ' v26 H' + c.x + ' V' + (y + 58) + '"/>');
      }

      r.sites.forEach(function (p) {
        var q = L.pos[p.id];
        var color = (KIND[p.kind] || KIND.city).color;
        var ev = eventsByPlace[p.id] || [];
        var isEnd = p.id === 'lingshan' || p.id === 'huaguo-shan';
        out.push('<g class="r-site' + (isEnd ? ' end' : '') + '" data-p="' + p.id + '">');
        out.push('<title>' + esc(p.name + ' · ' + ch(p.chapter) + '\n' + p.summary) + '</title>');
        if (ev.length) out.push('<circle class="r-halo" cx="' + q.x + '" cy="' + q.y + '" r="20"/>');
        out.push(siteGlyph(p.kind, q.x, q.y + 6, color, isEnd));
        out.push('<text class="r-name" x="' + q.x + '" y="' + (q.y - 16) + '">' + esc(p.name) + '</text>');
        out.push('<text class="r-ch" x="' + q.x + '" y="' + (q.y + 34) + '">' + p.chapter + '回</text>');
        out.push('</g>');
      });
      out.push('</g>');
    });

    $('#rSvg').innerHTML = out.join('');
    $$('#rSvg [data-p]').forEach(function (g) {
      g.addEventListener('click', function () { openItem(g.getAttribute('data-p')); });
    });

    /* 站点清单：名目 / 回目 / 类型 / 主人 / 依据 */
    var sites = routeSites(state.leg);
    $('#rCount').textContent = sites.length + ' 处站点';
    $('#rList').innerHTML = sites.map(function (p) {
      var owner = p.owner && byId[p.owner];
      var evs = (eventsByPlace[p.id] || []).map(function (e) {
        return '<button class="rl-ev" data-go="' + e.id + '">' + esc(e.name) + '</button>';
      }).join('');
      return '<div class="rl-row">' +
        '<span class="rl-ch">' + p.chapter + '</span>' +
        '<span class="rl-n">' + esc(p.name) + '</span>' +
        '<span class="rl-k" style="color:' + (KIND[p.kind] || KIND.city).color + '">' +
        esc((KIND[p.kind] || KIND.city).label) + '</span>' +
        (owner ? '<button class="rl-o" data-go="' + owner.id + '">' + esc(owner.name) + '</button>'
              : '<span class="rl-o none">—</span>') +
        '<span class="rl-s">' + esc(p.summary) + (evs ? ' ' + evs : '') + '</span>' +
        '</div>';
    }).join('');
    $$('#rList [data-go]').forEach(function (b) {
      b.addEventListener('click', function () { openItem(b.getAttribute('data-go')); });
    });

    $('#rLegend').innerHTML = Object.keys(KIND).map(function (k) {
      return '<span><svg viewBox="-20 -16 40 32" aria-hidden="true">' +
        siteGlyph(k, 0, 0, KIND[k].color) + '</svg>' + KIND[k].label + '</span>';
    }).join('') + '<span class="lg-hint">数字为该处首次发生回目</span>';

    $('#rNote').innerHTML = '<p>路线按回目分段排布，段内自左（东）而右（西）；' +
      '「神界」带内的凌霄殿、兜率宫、落伽山、幽冥地府、碧波潭不在西行路上，故不入主线。' +
      '站点只标「首次发生回目」，一处多事者见下方清单。</p>';
  }

  /* ---------------- 难簿 ---------------- */
  function renderTrials(verdict) {
    if (TV_ORDER.indexOf(verdict) >= 0) state.verdict = verdict;
    var cur = state.verdict;
    var items = D.trials.items;
    var counts = {};
    TV_ORDER.forEach(function (k) { counts[k] = items.filter(function (t) { return t.verdict === k; }).length; });

    var box = $('#tVerdict');
    box.innerHTML = '<button type="button" class="f-chip' + (cur === 'all' ? ' on' : '') +
      '" data-v="all">全部 ' + items.length + '</button>' + TV_ORDER.map(function (k) {
        return '<button type="button" class="f-chip' + (cur === k ? ' on' : '') +
          '" data-v="' + k + '">' + k + ' ' + counts[k] + '</button>';
      }).join('');
    $$('[data-v]', box).forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#trials/' + b.getAttribute('data-v'); });
    });

    $('#tSum').innerHTML = TV_ORDER.map(function (k) {
      return '<span class="t-pill ' + TV[k].cls + '"><b>' + counts[k] + '</b>' + TV[k].txt + '</span>';
    }).join('');

    var list = items.filter(function (t) { return cur === 'all' || t.verdict === cur; });
    $('#tCount').textContent = list.length + ' 条对照';
    $('#tList').innerHTML = list.map(function (t, i) {
      var v = TV[t.verdict];
      return '<article class="t-card ' + v.cls + '">' +
        '<div class="t-head"><span class="t-no">' + (i + 1) + '</span>' +
          '<h3>' + esc(t.name) + '</h3>' +
          '<span class="t-badge ' + v.cls + '">' + esc(t.verdict) + '</span></div>' +
        '<dl class="t-dl">' +
          '<dt>名目所指</dt><dd>' + esc(t.omen) + '</dd>' +
          '<dt>书中经过</dt><dd>' + esc(t.actual) + '</dd>' +
        '</dl>' +
        (t.note ? '<p class="t-note">' + esc(t.note) + '</p>' : '') +
        '<div class="t-foot"><span>' + ch(t.chapter) + '</span>' +
          (t.who || []).map(function (id) {
            var c = byId[id];
            return c ? '<button class="t-who" data-go="' + id + '">' + esc(c.name) + '</button>' : '';
          }).join('') + '</div>' +
      '</article>';
    }).join('');
    $$('#tList [data-go]').forEach(function (b) {
      b.addEventListener('click', function () { openItem(b.getAttribute('data-go')); });
    });

    $('#tNote').innerHTML = '<p>' + esc(D.trials.note) + '</p>' +
      '<ul class="m-refs">' + D.trials.refs.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
  }

  /* ---------------- 隐语 ---------------- */
  function renderWords(kind) {
    if (WK_ORDER.indexOf(kind) >= 0) state.kind = kind;
    var cur = state.kind;
    var all = D.wordplay;
    var kinds = [];
    all.forEach(function (w) { if (kinds.indexOf(w.kind) < 0) kinds.push(w.kind); });
    kinds.sort(function (a, b) { return WK_ORDER.indexOf(a) - WK_ORDER.indexOf(b); });

    var box = $('#wKind');
    box.innerHTML = '<button type="button" class="f-chip' + (cur === 'all' ? ' on' : '') +
      '" data-k="all">全部 ' + all.length + '</button>' + kinds.map(function (k) {
        return '<button type="button" class="f-chip' + (cur === k ? ' on' : '') +
          '" data-k="' + k + '">' + esc(k) + ' ' + all.filter(function (w) { return w.kind === k; }).length + '</button>';
      }).join('');
    $$('[data-k]', box).forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#wordplay/' + b.getAttribute('data-k'); });
    });

    var list = all.filter(function (w) { return cur === 'all' || w.kind === cur; });
    $('#wCount').textContent = list.length + ' 条';
    $('#wGrid').innerHTML = list.map(function (w) {
      var cls = WV[w.verdict];
      var who = w.person && byId[w.person];
      return '<article class="w-card ' + cls + '">' +
        '<div class="w-kind">' + esc(w.kind) + '<span class="w-badge ' + cls + '">' + esc(w.verdict) + '</span></div>' +
        '<div class="w-head"><span class="w-word">' + esc(w.word) + '</span>' +
          '<span class="w-arrow">→</span><span class="w-mean">' + esc(w.meaning) + '</span></div>' +
        '<p class="w-basis"><b>依据</b>' + esc(w.basis) + '</p>' +
        (w.note ? '<p class="w-note">' + esc(w.note) + '</p>' : '') +
        '<div class="w-foot"><span class="w-lv">' + WV_TXT[w.verdict] + '</span>' +
          (who ? '<button class="w-go" data-go="' + who.id + '">' + esc(who.name) + ' 词条 →</button>' : '') +
        '</div></article>';
    }).join('');
    $$('#wGrid [data-go]').forEach(function (b) {
      b.addEventListener('click', function () { openItem(b.getAttribute('data-go')); });
    });
  }

  /* ---------------- 人物 ---------------- */
  function renderPeople() {
    var q = ($('#peopleSearch').value || '').trim();
    var list = D.characters.filter(function (c) {
      if (state.group !== 'all' && c.group !== state.group) return false;
      if (!q) return true;
      return (c.name + ' ' + (c.alias || '') + ' ' + c.summary + ' ' + (c.tags || []).join(' ')).indexOf(q) >= 0;
    });
    $('#peopleCount').textContent = list.length + ' / ' + D.counts.characters + ' 人';
    $('#peopleGrid').innerHTML = list.map(function (c) {
      var g = groupById[c.group];
      return '<article class="p-card" data-go="' + c.id + '">' +
        '<div class="p-top"><span class="p-dot" style="background:' + g.color + '"></span>' +
          '<h3>' + esc(c.name) + '</h3>' + (c.alias ? '<span class="p-alias">' + esc(c.alias) + '</span>' : '') + '</div>' +
        '<div class="p-meta">' + esc(g.name) + ' · ' + esc(c.role) + ' · ' +
          c.chapters.slice(0, 4).map(function (n) { return n; }).join('、') + '回</div>' +
        '<p class="p-sum">' + esc(c.summary) + '</p>' +
        (c.tags && c.tags.length ? '<div class="p-tags">' + c.tags.map(function (t) {
          return '<span>' + esc(t) + '</span>';
        }).join('') + '</div>' : '') +
        '</article>';
    }).join('');
    $$('#peopleGrid [data-go]').forEach(function (el) {
      el.addEventListener('click', function () { openItem(el.getAttribute('data-go')); });
    });
  }

  /* ---------------- 行程（事件） ---------------- */
  function renderEvents() {
    var list = D.events.filter(function (e) {
      if (state.group === 'all') return true;
      return e.cast.some(function (pid) {
        var c = byId[pid];
        return c && c.group === state.group;
      });
    });
    $('#eventCount').textContent = list.length + ' 事';
    var lastLeg = null;
    $('#timeline').innerHTML = list.map(function (e) {
      var p = placeById[e.place];
      var leg = p ? p.leg : 9;
      var head = '';
      if (leg !== lastLeg) {
        lastLeg = leg;
        var meta = LEGS.filter(function (m) { return m.id === leg; })[0] || { name: '神界', sub: '' };
        head = '<div class="tl-leg">' + esc(meta.name) + '<small>' + esc(meta.sub) + '</small></div>';
      }
      return head + '<article class="tl-item" data-go="' + e.id + '">' +
        '<div class="tl-ch">' + e.chapter + '</div>' +
        '<div class="tl-body"><h3>' + esc(e.name) + '</h3>' +
          '<p>' + esc(e.summary) + '</p>' +
          '<div class="tl-meta">' + (p ? '<span class="tl-place">' + esc(p.name) + '</span>' : '') +
            e.cast.map(function (pid) {
              var c = byId[pid];
              return c ? '<span class="tl-who" style="border-color:' + gcolor(c.group) + '">' + esc(c.name) + '</span>' : '';
            }).join('') + '</div>' +
          (e.note ? '<p class="tl-note">' + esc(e.note) + '</p>' : '') +
        '</div></article>';
    }).join('');
    $$('#timeline [data-go]').forEach(function (el) {
      el.addEventListener('click', function () { openItem(el.getAttribute('data-go')); });
    });
  }

  /* ---------------- 详情弹窗 ---------------- */
  function kindOf(id) {
    if (byId[id]) {
      var x = byId[id];
      if (x.chapters) return 'person';
      if (x.kind && x.leg != null) return 'place';
      if (x.cast) return 'event';
      if (x.omen) return 'trial';
      if (x.meaning) return 'word';
    }
    return '';
  }

  function relBlock(id) {
    var rows = (relByPerson[id] || []).slice().sort(function (a, b) {
      return REL_WEIGHT[a.rel.group] - REL_WEIGHT[b.rel.group] || a.rel.chapter - b.rel.chapter;
    });
    if (!rows.length) return '';
    var byGroup = {};
    rows.forEach(function (x) {
      var r = x.rel;
      var other = r.a === id ? r.b : r.a;
      (byGroup[r.group] = byGroup[r.group] || []).push({
        other: other, label: x.dir === 'in' ? (r.inv || r.label) : r.label, chapter: r.chapter
      });
    });
    return '<div class="m-sec m-block"><h3>关系（' + rows.length + ' 条）</h3>' +
      REL_ORDER.filter(function (k) { return byGroup[k]; }).map(function (k) {
        return '<div class="grp"><span class="lb" style="color:' + REL[k].color + '">' +
          REL[k].label + '</span>' + byGroup[k].map(function (x) {
            var c = byId[x.other];
            if (!c) return '';
            return '<button data-go="' + c.id + '">' + esc(c.name) +
              '<small>' + esc(x.label) + ' · ' + x.chapter + '回</small></button>';
          }).join('') + '</div>';
      }).join('') + '</div>';
  }

  function loreBlock(id) {
    var out = '';
    var ws = wordsByPerson[id] || [];
    if (ws.length) {
      out += '<div class="m-sec m-block m-word"><h3>名号隐语</h3>' + ws.map(function (w) {
        return '<div class="m-word-line"><span class="mw-k">' + esc(w.kind) + '</span>' +
          '<b>' + esc(w.word) + '</b><span class="mw-a">→</span><b class="mw-s">' + esc(w.meaning) + '</b>' +
          '<span class="w-badge ' + WV[w.verdict] + '">' + esc(w.verdict) + '</span>' +
          '<p class="mw-b">' + esc(w.basis) + '</p></div>';
      }).join('') + '</div>';
    }
    var ts = trialsByPerson[id] || [];
    if (ts.length) {
      out += '<div class="m-sec m-block m-trial"><h3>难簿对照 <span class="t-badge ' +
        TV[ts[0].verdict].cls + '">' + esc(ts[0].verdict) + '</span></h3>' + ts.map(function (t) {
        return '<div class="m-quote">' + esc(t.name) + '</div>' +
          '<dl class="t-dl"><dt>名目</dt><dd>' + esc(t.omen) + '</dd>' +
          '<dt>经过</dt><dd>' + esc(t.actual) + '</dd></dl>' +
          (t.note ? '<p class="m-detail">' + esc(t.note) + '</p>' : '');
      }).join('') + '<p class="m-more"><a href="#trials">看全部难簿对照 →</a></p></div>';
    }
    var ps = placesByOwner[id] || [];
    if (ps.length) {
      out += '<div class="m-home"><span class="lb">相关地点</span>' + ps.map(function (p, i) {
        return (i ? '、' : '') + '<a href="#route/' + (p.leg === 9 ? 'all' : p.leg) + '">' + esc(p.name) + '</a>';
      }).join('') + '</div>';
    }
    return out;
  }

  function bodyFor(id) {
    var x = byId[id];
    var k = kindOf(id);
    if (k === 'person') {
      var g = groupById[x.group];
      var evs = (eventsByPerson[id] || []);
      return '<div class="m-eyebrow">' + esc(g.name) + ' · ' + esc(x.role) + '</div>' +
        '<h2 id="modalTitle">' + esc(x.name) + '</h2>' +
        (x.alias ? '<div class="m-sub">' + esc(x.alias) + '</div>' : '') +
        '<div class="m-tags"><span class="tag f">' + esc(g.name) + '</span>' +
          (x.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
        (x.detail ? '<div class="m-detail">' + esc(x.detail) + '</div>'
                  : '<div class="m-lead">' + esc(x.summary) + '</div>') +
        (x.detail ? '<p class="m-sum">' + esc(x.summary) + '</p>' : '') +
        loreBlock(id) +
        relBlock(id) +
        (evs.length ? '<div class="m-sec m-block"><h3>相关事件（' + evs.length + '）</h3>' +
          evs.map(function (e) {
            return '<div class="m-ev" data-go="' + e.id + '"><span>' + e.chapter + '</span>' +
              esc(e.name) + '</div>';
          }).join('') + '</div>' : '') +
        '<div class="m-chips">出场回次：' + x.chapters.map(function (n) {
          return '<span>' + n + '</span>';
        }).join('') + '</div>';
    }
    if (k === 'place') {
      var owner = x.owner && byId[x.owner];
      var e2 = eventsByPlace[id] || [];
      return '<div class="m-eyebrow">' + esc((KIND[x.kind] || {}).label || '地点') + ' · ' + ch(x.chapter) + '</div>' +
        '<h2 id="modalTitle">' + esc(x.name) + '</h2>' +
        '<div class="m-lead">' + esc(x.summary) + '</div>' +
        (x.renamed ? '<p class="m-note">后改称「' + esc(x.renamed) + '」。</p>' : '') +
        (owner ? '<div class="m-home"><span class="lb">此处主人 / 相关</span>' +
          '<button class="m-link" data-go="' + owner.id + '">' + esc(owner.name) + '</button></div>' : '') +
        (e2.length ? '<div class="m-sec m-block"><h3>此处所发生</h3>' + e2.map(function (e) {
          return '<div class="m-ev" data-go="' + e.id + '"><span>' + e.chapter + '</span>' + esc(e.name) + '</div>';
        }).join('') + '</div>' : '') +
        '<p class="m-note">路线为回目排布的示意图，非实测地理。</p>';
    }
    if (k === 'event') {
      var p = placeById[x.place];
      return '<div class="m-eyebrow">情节 · ' + ch(x.chapter) + '</div>' +
        '<h2 id="modalTitle">' + esc(x.name) + '</h2>' +
        (p ? '<div class="m-sub">' + esc(p.name) + '</div>' : '') +
        '<div class="m-lead">' + esc(x.summary) + '</div>' +
        (x.detail ? '<div class="m-detail">' + esc(x.detail) + '</div>' : '') +
        (x.note ? '<div class="m-sec m-block"><h3>按</h3><p class="m-detail">' + esc(x.note) + '</p></div>' : '') +
        '<div class="m-rel"><div class="grp"><span class="lb">出场</span>' + x.cast.map(function (pid) {
          var c = byId[pid];
          return c ? '<button data-go="' + pid + '">' + esc(c.name) + '<small>' + esc(c.role) + '</small></button>' : '';
        }).join('') + '</div></div>' +
        '<p class="m-note">情节名为项目自撰概括，不冒充回目原文。</p>';
    }
    if (k === 'trial') {
      var v = TV[x.verdict];
      return '<div class="m-eyebrow">难簿对照 · ' + ch(x.chapter) + '</div>' +
        '<h2 id="modalTitle">' + esc(x.name) + ' <span class="t-badge ' + v.cls + '">' + esc(x.verdict) + '</span></h2>' +
        '<dl class="t-dl"><dt>名目所指</dt><dd>' + esc(x.omen) + '</dd>' +
        '<dt>书中经过</dt><dd>' + esc(x.actual) + '</dd></dl>' +
        (x.note ? '<p class="m-detail">' + esc(x.note) + '</p>' : '') +
        ((x.who || []).length ? '<div class="m-rel"><div class="grp"><span class="lb">相关人物</span>' +
          x.who.map(function (pid) {
            var c = byId[pid];
            return c ? '<button data-go="' + pid + '">' + esc(c.name) + '</button>' : '';
          }).join('') + '</div></div>' : '') +
        '<p class="m-more"><a href="#trials/' + encodeURIComponent(x.verdict) + '">看同类判定 →</a></p>';
    }
    if (k === 'word') {
      var who = x.person && byId[x.person];
      return '<div class="m-eyebrow">' + esc(x.kind) + ' · ' + esc(x.verdict) + '</div>' +
        '<h2 id="modalTitle">' + esc(x.word) + '</h2>' +
        '<div class="m-quote">' + esc(x.meaning) + '</div>' +
        '<div class="m-sec m-block"><h3>依据</h3><p class="m-detail">' + esc(x.basis) + '</p></div>' +
        (x.note ? '<div class="m-sec m-block"><h3>按</h3><p class="m-detail">' + esc(x.note) + '</p></div>' : '') +
        (who ? '<div class="m-rel"><div class="grp"><span class="lb">词条</span>' +
          '<button data-go="' + who.id + '">' + esc(who.name) + '</button></div></div>' : '') +
        '<p class="m-more"><a href="#wordplay/' + encodeURIComponent(x.kind) + '">看同类隐语 →</a></p>';
    }
    return '<h2 id="modalTitle">未找到条目</h2>';
  }

  function openItem(id) {
    modal = modal || $('#modal');
    if (!byId[id]) return;
    lastFocus = document.activeElement;
    $('#modalBody').innerHTML = bodyFor(id);
    modal.hidden = false;
    document.body.classList.add('modal-open');
    $$('#modalBody [data-go]').forEach(function (el) {
      el.addEventListener('click', function () { openItem(el.getAttribute('data-go')); });
    });
    $('#modalClose').focus();
  }

  function openRelation(e) {
    if (!e || e.kind !== 'relation') return;
    var A = byId[e.a], B = byId[e.b];
    if (!A || !B) return;
    var others = D.relations.filter(function (r) {
      return (r.a === e.a && r.b === e.b) || (r.a === e.b && r.b === e.a);
    });
    modal = modal || $('#modal');
    lastFocus = document.activeElement;
    var shared = sharedEvents(e.a, e.b);
    $('#modalBody').innerHTML =
      '<div class="m-eyebrow">关系 · ' + (REL[e.group] || REL.rival).label + ' · ' + ch(e.chapter) + '</div>' +
      '<h2 id="modalTitle">' + esc(A.name) + '<span class="rel-arrow">—' + esc(e.label) + '→</span>' + esc(B.name) + '</h2>' +
      '<div class="m-sub">从' + esc(A.name) + '这边看，对方是「' + esc(e.label) + '」；' +
        '从' + esc(B.name) + '这边看，对方是「' + esc(e.inv || e.label) + '」</div>' +
      (others.length > 1 ? '<div class="m-sec m-block"><h3>同一对人物另有</h3><div class="m-rel">' +
        others.map(function (r) {
          return '<div class="grp"><span class="lb" style="color:' + REL[r.group].color + '">' +
            REL[r.group].label + '</span><span class="m-alt">' + esc(r.label) +
            (r.inv && r.inv !== r.label ? '（对方称「' + esc(r.inv) + '」）' : '') +
            ' · ' + r.chapter + '回</span></div>';
        }).join('') + '</div></div>' : '') +
      '<div class="m-rel"><div class="grp">' +
        '<button data-go="' + A.id + '">' + esc(A.name) + '<small>' + esc(A.role) + '</small></button>' +
        '<button data-go="' + B.id + '">' + esc(B.name) + '<small>' + esc(B.role) + '</small></button>' +
      '</div></div>' +
      (shared.length
        ? '<div class="m-sec m-block"><h3>共同事件（' + shared.length + '）</h3>' +
          shared.map(function (x) {
            return '<div class="m-ev" data-go="' + x.id + '"><span>' + x.chapter + '</span>' + esc(x.name) + '</div>';
          }).join('') + '</div>'
        : '<div class="m-sec m-block"><h3>共同事件</h3><p class="m-note">两人在现有条目里没有共同出场的事件。</p></div>');
    modal.hidden = false;
    document.body.classList.add('modal-open');
    $$('#modalBody [data-go]').forEach(function (el) {
      el.addEventListener('click', function () { openItem(el.getAttribute('data-go')); });
    });
    $('#modalClose').focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------------- 启动 ---------------- */
  function bindChrome() {
    $$('.mainnav button').forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#' + b.getAttribute('data-view'); });
    });
    $('#modalClose').addEventListener('click', closeModal);
    modal = $('#modal');
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('.modal-card') === null) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!modal.hidden) { closeModal(); return; }
        if (document.body.classList.contains('xy-fs')) { setFs(false); return; }
        hideEdgePanel();
      }
    });
    $('#evToggle').addEventListener('click', function () {
      state.showEvents = !state.showEvents;
      this.classList.toggle('on', state.showEvents);
      model = null;
      renderGraph();
    });
    $('#peopleSearch').addEventListener('input', renderPeople);
    renderBars();
    bindGroupBars();

    var relBox = $('#gRelBar');
    if (relBox) relBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rel]');
      if (!b) return;
      state.rel = b.getAttribute('data-rel');
      if (state.gview === 'list') renderGraphList(); else renderGraph();
    });

    $$('#gViewSeg [data-gview]').forEach(function (b) {
      b.addEventListener('click', function () { setGView(b.getAttribute('data-gview')); });
    });
    var gs = $('#gListSearch');
    if (gs) gs.addEventListener('input', renderGraphList);

    $('#fsBtn').addEventListener('click', function () { setFs(true); });
    $('#fsExit').addEventListener('click', function () { setFs(false); });
    $('#stageTools').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-zoom]');
      if (!b) return;
      zoomBy(b.getAttribute('data-zoom') === 'in' ? 1.2 : 1 / 1.2);
    });
    bindGraphStage();
    bindSearch();
    window.addEventListener('resize', function () {
      if (state.view !== 'graph') return;
      if (document.body.classList.contains('xy-fs')) { model = null; setFs(true); }
      else { model = null; renderGraph(); }
    });
  }

  fetch('../../api/works/xiyou.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('数据加载失败（' + r.status + '）');
      return r.json();
    })
    .then(function (data) {
      D = data;
      /* 难簿与隐语也进 byId，供弹窗与链接使用 */
      D.trials.items.forEach(function (t, i) { t.id = 'trial-' + i; byId[t.id] = t; });
      D.wordplay.forEach(function (w, i) { w.id = 'word-' + i; byId[w.id] = w; });
      buildIndices();
      fillStatic();
      bindChrome();
      route();
      window.addEventListener('hashchange', route);
    })
    .catch(function (err) {
      document.body.insertAdjacentHTML('beforeend',
        '<div style="max-width:620px;margin:14vh auto;padding:26px;border:1px solid #d8cfbc;' +
        'border-left:4px solid #9a3a2f;background:#fffdf7;font-size:14px;line-height:1.9">' +
        '<b>西游数据加载失败</b><p>' + esc(err.message) + '</p>' +
        '<pre style="background:#27241e;color:#f6f1e6;padding:12px;border-radius:4px">' +
        'python3 tools/build_xiyou.py\npython3 tools/build_static.py</pre>' +
        '<p>本地预览请用 <b>http://127.0.0.1:8600/works/xiyou/</b>，不要直接双击 index.html。</p></div>');
    });
})();
