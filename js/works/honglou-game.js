/* 红楼梦 · 入府（第一人称文字小游戏）
 *
 * 设计约束：
 *  1) 纯文本、无依赖、无后端；断网可玩，进度存 localStorage。
 *  2) 选择只改三条暗线（分寸/情分/风评）与旗标，不改判词与人物结局。
 *  3) 文案全部在 scenes.json，引擎不写死剧情，便于逐部作品复用。
 *  4) 剧本的可达性由 tools/validate_game.py 把关（穷举所有路线），改剧本后跑一遍。
 */
(function () {
  'use strict';

  var SAVE_KEY = 'honglou-game-v1';
  var ENDINGS_KEY = 'honglou-game-endings-v1';
  var DATA = null;
  var state = null;
  var sceneIndex = {};
  var sceneDepth = {};
  var journalTotal = 0;
  var els = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function emptyState() {
    return {
      version: 1,
      scene: null,
      meters: { fen: 0, qing: 0, feng: 0 },
      flags: [],
      journal: [],
      turns: 0,
      ended: null
    };
  }

  function hasFlag(f) { return state.flags.indexOf(f) >= 0; }
  function addFlag(f) { if (f && !hasFlag(f)) state.flags.push(f); }
  function addJournal(entry) {
    if (!entry || !entry.title) return;
    if (state.journal.some(function (j) { return j.title === entry.title; })) return;
    state.journal.push({
      title: entry.title,
      text: entry.text || '',
      source: entry.source || ''
    });
  }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式或配额不足时静默失败 */ }
  }
  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1) return null;
      if (!s.ended && (!s.scene || !sceneIndex[s.scene])) return null;
      if (!s.meters) s.meters = { fen: 0, qing: 0, feng: 0 };
      if (!s.journal) s.journal = [];
      if (!s.flags) s.flags = [];
      if (typeof s.turns !== 'number') s.turns = 0;
      return s;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  /* 走到过的结局：跨周目累积，结局页显示「已走到 n / 总数」 */
  function seenEndings() {
    try {
      var raw = localStorage.getItem(ENDINGS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function markEnding(id) {
    if (!id) return;
    var arr = seenEndings();
    if (arr.indexOf(id) >= 0) return;
    arr.push(id);
    try { localStorage.setItem(ENDINGS_KEY, JSON.stringify(arr)); } catch (e) { /* ignore */ }
  }

  /* ---------------- 条件与效果 ---------------- */
  function condMet(cond) {
    if (!cond) return true;
    if (cond.flags && cond.flags.length) {
      var ok = cond.flags.every(function (f) { return hasFlag(f); });
      if (!ok) return false;
    }
    if (cond.notFlags && cond.notFlags.some(function (f) { return hasFlag(f); })) return false;
    if (typeof cond.fenMin === 'number' && state.meters.fen < cond.fenMin) return false;
    if (typeof cond.fenMax === 'number' && state.meters.fen > cond.fenMax) return false;
    if (typeof cond.qingMin === 'number' && state.meters.qing < cond.qingMin) return false;
    if (typeof cond.qingMax === 'number' && state.meters.qing > cond.qingMax) return false;
    if (typeof cond.fengMin === 'number' && state.meters.feng < cond.fengMin) return false;
    if (typeof cond.fengMax === 'number' && state.meters.feng > cond.fengMax) return false;
    return true;
  }

  var METER_MAX = 8;
  function applyEffects(effects) {
    if (!effects) return;
    Object.keys(effects).forEach(function (k) {
      if (!(k in state.meters)) return;
      state.meters[k] = Math.max(-METER_MAX, Math.min(METER_MAX, state.meters[k] + effects[k]));
    });
  }

  function visibleChoices(scene) {
    return (scene.choices || []).filter(function (c) { return condMet(c.if); });
  }

  /* ---------------- 渲染 ---------------- */
  function show(id) {
    ['intro', 'play', 'ending'].forEach(function (k) { els[k].hidden = k !== id; });
  }

  function renderProgress(sid) {
    if (!els.gprog) return;
    var total = Object.keys(sceneDepth).length;
    var here = (sceneDepth[sid] || 0) + 1;
    var dots = '';
    for (var i = 0; i < total; i++) {
      dots += '<i class="' + (i < here ? 'on' : '') + (i === here - 1 ? ' now' : '') + '"></i>';
    }
    els.gprog.innerHTML = '<span class="gprog-num">第 ' + here + ' 幕 / 共 ' + total + ' 幕</span>' +
      '<span class="gprog-dots" aria-hidden="true">' + dots + '</span>';
  }

  function renderScene(id) {
    var scene = sceneIndex[id];
    if (!scene) { renderIntro(); return; }
    state.scene = id;
    state.ended = null;
    save();
    show('play');

    els.sceneChapter.textContent = scene.chapter || '';
    els.scenePlace.textContent = scene.place || '';
    els.sceneTitle.textContent = scene.title || '';
    els.sceneText.innerHTML = (scene.text || []).map(function (p) {
      return '<p>' + esc(p) + '</p>';
    }).join('');
    renderProgress(id);

    var list = visibleChoices(scene);
    els.choices.innerHTML = list.map(function (c, i) {
      return '<button type="button" class="choice" data-i="' + i + '">' +
        '<span class="num">' + (i + 1) + '</span>' +
        '<span class="label">' + esc(c.label) + '</span>' +
        (c.detail ? '<span class="detail">' + esc(c.detail) + '</span>' : '') +
        '</button>';
    }).join('');

    els.turnHint.textContent = list.length
      ? '选一个。没有提示，按你自己的性子来。'
      : '';
    /* 换场后把焦点交给标题：读屏会念出新的一幕，键盘也能直接按数字键 */
    if (els.sceneTitle) els.sceneTitle.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    renderJournalCount();
  }

  function choose(i) {
    var scene = sceneIndex[state.scene];
    if (!scene) return;
    var list = visibleChoices(scene);
    var choice = list[i];
    if (!choice) return;

    applyEffects(choice.effects);
    (choice.set || []).forEach(addFlag);
    addJournal(choice.journal);
    state.turns += 1;

    if (choice.next === 'end' || !choice.next) {
      finish();
      return;
    }
    renderScene(choice.next);
  }

  function meterWord(kind, v) {
    var table = {
      fen: [[-99, '毛躁'], [0, '还生疏'], [2, '知进退'], [4, '很稳当']],
      qing: [[-99, '没人替你说话'], [0, '泛泛'], [2, '有人肯理你'], [4, '有人记着你']],
      feng: [[-99, '没人提你'], [0, '不出挑'], [2, '下人间有你的话'], [4, '名字传得快']]
    };
    var rows = table[kind] || [];
    var out = rows[0][1];
    rows.forEach(function (r) { if (v >= r[0]) out = r[1]; });
    return out;
  }

  function endingById(id) {
    return (DATA.endings || []).filter(function (e) { return e.id === id; })[0];
  }

  /* 结局页：正文 + 三条暗线 + 册子与结局的收集进度 */
  function renderEnding(ending) {
    show('ending');
    els.endingTitle.textContent = ending ? ending.title : '完';
    els.endingText.innerHTML = ((ending && ending.text) || []).map(function (p) {
      return '<p>' + esc(p) + '</p>';
    }).join('');

    var meterHtml = Object.keys(DATA.meters || {}).map(function (k) {
      var v = (state.meters && state.meters[k]) || 0;
      return '<span class="meter"><b>' + esc(DATA.meters[k]) + '</b>' +
        esc(meterWord(k, v)) + '</span>';
    }).join('');
    var got = state.journal ? state.journal.length : 0;
    var endingsGot = seenEndings().length;
    var totals = '<span class="meter"><b>册子</b>' + got + ' / ' + journalTotal + ' 条</span>' +
      '<span class="meter"><b>结局</b>已走到 ' + endingsGot + ' / ' + (DATA.endings || []).length + ' 个</span>';
    els.endingMeters.innerHTML = meterHtml + totals;

    if (els.endingNote) {
      var totalEndings = (DATA.endings || []).length;
      els.endingNote.textContent = endingsGot < totalEndings
        ? '册子记下 ' + got + ' 条，全本 ' + journalTotal + ' 条；四个去处，你走到了 ' + endingsGot + ' 个。换几条路，还会听见别的话。'
        : '四个去处你都走到了。册子里还有没听过的话——那是站在别处才听得见的。';
    }
    renderJournalCount();
    window.scrollTo({ top: 0 });
    if (els.endingTitle) els.endingTitle.focus({ preventScroll: true });
  }

  function finish() {
    var ending = (DATA.endings || []).filter(function (e) { return condMet(e.if); })[0] ||
      (DATA.endings || [])[DATA.endings.length - 1];
    state.scene = null;
    state.ended = ending ? ending.id : 'end';
    save();
    markEnding(state.ended);
    renderEnding(ending);
  }

  function renderIntro() {
    show('intro');
    els.gameTitle.textContent = DATA.title || '入府';
    els.gameIntro.textContent = DATA.intro || '';
    var saved = loadSave();
    els.resumeBtn.hidden = !saved;
    if (saved && saved.ended) {
      var e = endingById(saved.ended);
      els.resumeBtn.textContent = '看上次的结局' + (e ? '：' + e.title : '');
    } else if (saved) {
      var s = sceneIndex[saved.scene];
      els.resumeBtn.textContent = '继续上次' + (s && s.title ? '：' + s.title : '');
    }
    renderJournalCount();
  }

  function startNew() {
    state = emptyState();
    clearSave();
    renderScene(DATA.start);
  }

  function resume() {
    var saved = loadSave();
    if (!saved) { startNew(); return; }
    state = saved;
    if (state.ended) { renderEnding(endingById(state.ended)); return; }
    renderScene(state.scene);
  }

  /* ---------------- 册子 ---------------- */
  function renderJournalCount() {
    if (!els.journalCount) return;
    var got = state && state.journal ? state.journal.length : 0;
    els.journalCount.textContent = got + '/' + journalTotal;
  }

  function openJournal() {
    if (!state) return;
    var list = state.journal || [];
    els.journalList.innerHTML = list.length ? list.map(function (j) {
      return '<article class="jentry"><h3>' + esc(j.title) + '</h3>' +
        (j.text ? '<p>' + esc(j.text) + '</p>' : '') +
        (j.source ? '<small>' + esc(j.source) + '</small>' : '') + '</article>';
    }).join('') : '<p class="jempty">册子还是空的。你听见的话，会记在这里。</p>';
    if (els.journalNote) {
      els.journalNote.textContent = '这一遍记下 ' + list.length + ' 条，全本共 ' + journalTotal + ' 条。';
    }
    els.journal.hidden = false;
    document.body.classList.add('drawer-open');
    els.journalClose.focus();
  }
  function closeJournal() {
    els.journal.hidden = true;
    document.body.classList.remove('drawer-open');
    if (els.journalBtn) els.journalBtn.focus();
  }

  /* 册子里 Tab 只在面板内循环，Escape 合上 */
  function trapTab(e) {
    if (els.journal.hidden || e.key !== 'Tab') return;
    var items = els.journal.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    els.choices.addEventListener('click', function (e) {
      var b = e.target.closest('.choice');
      if (b) choose(Number(b.getAttribute('data-i')));
    });
    $('startBtn').addEventListener('click', startNew);
    els.resumeBtn.addEventListener('click', resume);
    $('againBtn').addEventListener('click', startNew);
    $('restartBtn').addEventListener('click', function () {
      if (state && state.turns > 0 && !window.confirm('重开会把这一遍的册子清空，确定吗？')) return;
      startNew();
    });
    els.journalBtn.addEventListener('click', openJournal);
    els.journalClose.addEventListener('click', closeJournal);
    els.journal.addEventListener('click', function (e) {
      if (e.target === els.journal) closeJournal();
    });
    /* 点画布任意处合上（顶栏上的「册子」按钮除外，避免开了又关） */
    document.addEventListener('click', function (e) {
      if (els.journal.hidden) return;
      if (els.journal.contains(e.target) || els.journalBtn.contains(e.target)) return;
      closeJournal();
    }, true);

    document.addEventListener('keydown', function (e) {
      trapTab(e);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var k = e.key.toLowerCase();
      if (k === 'j') { e.preventDefault(); els.journal.hidden ? openJournal() : closeJournal(); return; }
      if (k === 'r') { e.preventDefault(); $('restartBtn').click(); return; }
      if (e.key === 'Escape' && !els.journal.hidden) { closeJournal(); return; }
      if (!els.play.hidden && /^[1-9]$/.test(e.key)) {
        var i = Number(e.key) - 1;
        var b = els.choices.querySelectorAll('.choice')[i];
        if (b) { e.preventDefault(); choose(i); }
      }
    });
  }

  /* 从 start 出发算每一场戏的深度：进度条按它显示「第 n 幕」 */
  function buildDepth(start) {
    var depth = {};
    var queue = [[start, 0]];
    depth[start] = 0;
    while (queue.length) {
      var cur = queue.shift();
      var scene = sceneIndex[cur[0]];
      if (!scene) continue;
      (scene.choices || []).forEach(function (c) {
        var n = c.next;
        if (n && n !== 'end' && sceneIndex[n] && depth[n] == null) {
          depth[n] = cur[1] + 1;
          queue.push([n, cur[1] + 1]);
        }
      });
    }
    return depth;
  }

  function init() {
    els = {
      intro: $('intro'), play: $('play'), ending: $('ending'),
      sceneChapter: $('sceneChapter'), scenePlace: $('scenePlace'),
      sceneTitle: $('sceneTitle'), sceneText: $('sceneText'),
      choices: $('choices'), turnHint: $('turnHint'), gprog: $('gprog'),
      endingTitle: $('endingTitle'), endingText: $('endingText'),
      endingMeters: $('endingMeters'), endingNote: $('endingNote'),
      gameTitle: $('gameTitle'), gameIntro: $('gameIntro'),
      resumeBtn: $('resumeBtn'),
      journal: $('journal'), journalList: $('journalList'), journalNote: $('journalNote'),
      journalCount: $('journalCount'), journalBtn: $('journalBtn'),
      journalClose: $('journalClose')
    };

    fetch('scenes.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('剧本加载失败');
      return r.json();
    }).then(function (data) {
      if (!data || !data.scenes || !data.scenes.length) throw new Error('剧本为空');
      DATA = data;
      DATA.scenes.forEach(function (s) { sceneIndex[s.id] = s; });
      sceneDepth = buildDepth(DATA.start);
      var titles = {};
      DATA.scenes.forEach(function (s) {
        (s.choices || []).forEach(function (c) {
          if (c.journal && c.journal.title) titles[c.journal.title] = 1;
        });
      });
      journalTotal = Object.keys(titles).length;
      state = emptyState();
      bind();
      renderIntro();
    }).catch(function (err) {
      var p = $('loadError');
      p.hidden = false;
      p.textContent = err.message + '。请通过本地服务打开，而不是双击 HTML。';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
