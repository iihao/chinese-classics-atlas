#!/usr/bin/env node
/*
 * 小红书竖图生成器 · 系列站版（1080×1440，3:4）
 * ---------------------------------------------------------------
 * 从 honglou-atlas/tools/xhs_shots.js 迁移而来，改成支持三部作品。
 *
 * 为什么按手机视口渲染再裁 3:4：
 *   桌面截图（1192×700 那种）发到小红书会被裁成一条、字缩成蚂蚁。
 *   这里用 432 CSS 宽（≈ iPhone 逻辑宽度）渲染，页面走移动端布局，
 *   视口本身就是 432×576 的 3:4 取景框，DPR 2.5 → 1080×1440。
 *   图里的字号 = 用户真机刷到的字号。
 *
 * 用法：
 *   python3 server/app.py                       # 默认 8600
 *   npm i --no-save puppeteer-core
 *   node tools/xhs_shots.js --work=xiyou
 *   node tools/xhs_shots.js --work=all
 *
 * 环境变量：BASE_URL（默认 http://127.0.0.1:8600）、OUT_ROOT（默认 docs/xhs）
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8600';
const OUT_ROOT = process.env.OUT_ROOT || path.join(__dirname, '..', 'docs', 'xhs');

const FRAME = { w: 432, h: 576 };
const DPR = 1080 / FRAME.w; // 2.5
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------- 作品配置 */

const WORKS = {
  /* 红楼：路由与取景参数沿用单仓库时期调好的那一套 */
  honglou: {
    ready: "!!(document.querySelector('#footerCount') && document.querySelector('#footerCount').textContent.trim())",
    shots: [
      { file: '01-cover.png', cover: 'honglou', hash: '#graph', wait: 3200,
        graph: { fullscreen: true, zoomIn: 1 } },
      { file: '02-lineage-rong.png', hash: '#lineage/rong', wait: 900, panel: '#lgScroll',
        lineage: { zoomOut: 2, centerOn: '贾政' } },
      { file: '03-lineage-ning.png', hash: '#lineage/ning', wait: 900, panel: '#lgScroll',
        lineage: { zoomOut: 2, centerOn: '贾珍' } },
      { file: '04-graph-baoyu.png', hash: '#graph', wait: 3200,
        graph: { fullscreen: true, zoomIn: 1, locate: '贾宝玉' } },
      { file: '05-chapters.png', hash: '#chapters', wait: 900, panel: '#chapterList' },
      { file: '06-person-baoyu.png', hash: '#item/pl-baoyu', wait: 900 },
      { file: '07-person-relations.png', hash: '#item/pl-baoyu', wait: 900,
        modalScrollTo: '人物关系' },
      { file: '08-person-daiyu.png', hash: '#item/pl-daiyu', wait: 900,
        modalScrollTo: '谶语' },
      { file: '09-fate.png', hash: '#fate', wait: 900, panel: '#fateGrid',
        scrollToText: { sel: '#fateGrid .fate', text: '贾探春' } },
      { file: '10-map.png', hash: '#map', wait: 900, panel: '.map-box' },
      { file: '11-riddle.png', hash: '#riddle', wait: 900, panel: '.riddle-grid' },
      { file: '12-riddle-foreshadow.png', hash: '#riddle/foreshadow', wait: 900, panel: '.riddle-grid' },
      { file: '13-places.png', hash: '#places', wait: 900, panel: '#placeGrid' },
      // 停在候选列表那一瞬：展示「搜别号也能定位」这个动作本身
      { file: '14-search.png', hash: '#people', wait: 700, panel: '#peopleGrid',
        search: { sel: '#searchBtn', text: '蕉下客', enter: false, viaBtn: true } },
    ],
  },

  sanguo: {
    ready: "!!(document.querySelector('#statChars') && document.querySelector('#statChars').textContent !== '—')",
    shots: [
      { file: '01-cover.png', cover: 'sanguo', hash: '#graph', wait: 2600 },
      { file: '02-graph.png', hash: '#graph', wait: 2600, panel: '.graph-stage' },
      { file: '03-graph-shu.png', hash: '#graph', wait: 2600, panel: '.graph-stage',
        click: '[data-faction="shu"]' },
      { file: '04-figure-liu-bei.png', hash: '#figure/liu-bei', wait: 900 },
      { file: '05-figure-cao-cao.png', hash: '#figure/cao-cao', wait: 900 },
      { file: '06-event-fire.png', hash: '#event/ev-fire', wait: 900 },
      { file: '09-place-longzhong.png', hash: '#place/longzhong', wait: 900 },
      { file: '07-people.png', hash: '#people', wait: 900, panel: '.pgrid' },
      { file: '08-events.png', hash: '#events', wait: 900, panel: '.timeline' },
    ],
  },

  xiyou: {
    ready: "!!(document.querySelector('#statChars') && document.querySelector('#statChars').textContent !== '—')",
    shots: [
      { file: '01-cover.png', cover: 'xiyou', hash: '#route', wait: 1200 },
      { file: '02-route-full.png', hash: '#route', wait: 1000, panel: '.route-stage' },
      { file: '03-route-last.png', hash: '#route/6', wait: 900, panel: '.route-stage' },
      { file: '04-graph-yao.png', hash: '#graph', wait: 1000, panel: '.graph-stage',
        click: '#gGroup [data-group="yao"]' },
      { file: '05-graph-all.png', hash: '#graph', wait: 1000, panel: '.graph-stage' },
      { file: '06-trials.png', hash: '#trials', wait: 900, panel: '.trial-list' },
      { file: '07-trials-split.png', hash: '#trials/拆分', wait: 900, panel: '.trial-list' },
      { file: '08-wordplay.png', hash: '#wordplay', wait: 900, panel: '.word-grid' },
      { file: '09-wordplay-neidan.png', hash: '#wordplay/内丹代号', wait: 900, panel: '.word-grid' },
      { file: '10-person-wukong.png', hash: '#item/wu-kong', wait: 900 },
      { file: '11-person-bajie.png', hash: '#item/ba-jie', wait: 900, modalScrollTo: '难簿对照' },
      { file: '12-place-lingshan.png', hash: '#item/lingshan', wait: 900 },
      { file: '13-event-fan.png', hash: '#item/ev-fan', wait: 900 },
      { file: '14-events.png', hash: '#events', wait: 900, panel: '.timeline' },
      { file: '15-search.png', hash: '#graph', wait: 1000, panel: '.graph-stage',
        search: { sel: '#gSearch', text: '心猿' } },
      // 点一条关系线：展示「同一对人物有多重关系」的详情卡
      { file: '16-edge-multi.png', hash: '#graph', wait: 1000, panel: '.graph-stage',
        click: '#gGroup [data-group="yao"]', clickEdge: true },
      // 关系列表视图（203 条按类型分组，可检索）
      { file: '17-list.png', hash: '#graph', wait: 1000, panel: '.glist',
        click: '#gViewSeg [data-gview="list"]' },
      // 敌对·降服 一类：一眼看清「谁跟谁打过」
      { file: '18-rel-rival.png', hash: '#graph', wait: 1000, panel: '.glist',
        click: '#gViewSeg [data-gview="list"]', click2: '#gRelBar [data-rel="rival"]' },
    ],
  },
};

/* ------------------------------------------------- 封面层（自绘，不用产品截图） */

const COVER_STYLE = `
  position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;justify-content:space-between;
  padding:44px 38px 40px;font-family:var(--sans);color:var(--ink);
  background:radial-gradient(120% 70% at 80% 0%,rgba(252,247,238,.97),rgba(246,241,230,.94) 58%,rgba(239,231,214,.95)),rgba(246,241,230,.95)`;

function coverHTML(work) {
  const head = (seal, kicker, title, sub) => `
    <div>
      <div style="display:flex;align-items:center;gap:11px">
        <span style="width:30px;height:1px;background:var(--red);opacity:.5"></span>
        <span style="font-size:12px;letter-spacing:.3em;color:var(--red);font-weight:600">${kicker}</span>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:26px">
        <span style="width:52px;height:52px;flex:0 0 auto;display:grid;place-items:center;border-radius:6px;color:#fbeee1;
          font-family:var(--serif);font-size:27px;background:linear-gradient(160deg,#a02832,#74161f);
          box-shadow:0 2px 0 rgba(255,255,255,.22) inset,0 8px 18px -10px rgba(110,20,26,.9)">${seal}</span>
        <div style="font-family:var(--serif);font-size:46px;letter-spacing:.04em;line-height:1.15;white-space:nowrap">${title}</div>
      </div>
      <div style="font-family:var(--serif);font-size:22px;line-height:1.7;color:var(--ink-2);margin-top:20px">${sub}</div>
    </div>`;
  const stats = (rows) => `
    <div>
      <div style="display:flex;border-top:1px solid var(--line-2);padding-top:20px">
        ${rows.map(([n, l]) => `
          <div style="flex:1">
            <div style="font-family:var(--serif);font-size:33px;color:var(--red);line-height:1.1">${n}</div>
            <div style="font-size:12.5px;letter-spacing:.14em;color:var(--ink-3);margin-top:5px">${l}</div>
          </div>`).join('')}
      </div>
      <div style="margin-top:18px;font-size:13.5px;letter-spacing:.06em;color:var(--ink-3)">
        手机可开 · 免注册 · 无需下载 · 开源</div>
    </div>`;

  if (work === 'xiyou') {
    return `<div id="xhsCover" style="${COVER_STYLE}">
      ${head('西', '西 游 记 · 图 谱', '西游记',
        `八十一难，<span style="color:var(--red)">谁在背后</span><br>一条路线图看得清`)}
      <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:15px;color:var(--ink-2)">
        ${['西行路线', '六界法脉', '难簿对照', '名号隐语', '人物关系', '行程']
          .map((t) => `<span style="padding:7px 14px;border:1px solid var(--line-2);border-radius:999px;background:rgba(255,255,255,.5)">${t}</span>`).join('')}
      </div>
      ${stats([['67', '人物'], ['127', '关系'], ['42', '站点'], ['21', '难簿对照']])}
    </div>`;
  }
  if (work === 'sanguo') {
    return `<div id="xhsCover" style="${COVER_STYLE}">
      ${head('三', '三 国 演 义 · 图 谱', '三国演义',
        `每条关系都标回目<br><span style="color:var(--red)">小说与史</span>分开写`)}
      ${stats([['39', '人物'], ['71', '关系'], ['28', '事件'], ['21', '地点']])}
    </div>`;
  }
  return `<div id="xhsCover" style="${COVER_STYLE}">
    ${head('红', '红 楼 梦 · 图 谱', '红楼梦图谱',
      `四百多人，谁是谁家的人<br><span style="color:var(--red)">这张图</span>一眼看清`)}
    ${stats([['173', '人物'], ['860', '关系'], ['50', '谱系'], ['15', '判词']])}
  </div>`;
}

/* ------------------------------------------------- 交互辅助 */

async function clickSafe(page, sel, quiet) {
  const ok = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.click();
    return true;
  }, sel);
  if (!ok && !quiet) console.log('  ! 找不到元素', sel);
  return ok;
}

async function scrollToText(page, cfg) {
  await page.evaluate(({ sel, text }) => {
    const el = [...document.querySelectorAll(sel)].find((n) => (n.textContent || '').trim().startsWith(text));
    if (!el) return;
    const bar = document.querySelector('.topbar');
    const barH = bar ? bar.getBoundingClientRect().height : 56;
    window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - barH - 10));
  }, cfg);
}

/* 红楼谱系：还原到 100% 再退 N 档，把指定人物横向居中 */
async function lineageFrame(page, { zoomOut = 0, centerOn }) {
  await clickSafe(page, '#lgZoom [data-lgzoom="fit"]');
  await sleep(320);
  for (let i = 0; i < zoomOut; i++) {
    await clickSafe(page, '#lgZoom [data-lgzoom="out"]');
    await sleep(240);
  }
  await page.evaluate((name) => {
    const sc = document.querySelector('#lgScroll');
    const bar = document.querySelector('.topbar');
    const barH = bar ? bar.getBoundingClientRect().height : 56;
    const anchor = document.querySelector('.lg-toolbar') || sc;
    window.scrollTo(0, Math.max(0, anchor.getBoundingClientRect().top + window.scrollY - barH - 6));
    if (!name) return;
    const node = [...document.querySelectorAll('.lg-node')].find((n) =>
      (n.textContent || '').replace(/\s+/g, '').includes(name));
    if (node) {
      const r = node.getBoundingClientRect();
      const c = sc.getBoundingClientRect();
      sc.scrollLeft += r.left + r.width / 2 - (c.left + c.width / 2);
    }
  }, centerOn);
  await sleep(400);
}

/* 红楼关系图全屏 + 定位（视口先改成取景框高度，fit 才按 3:4 铺满） */
async function dragStage(page, dx, dy) {
  await page.evaluate(([x, y]) => {
    const svg = document.querySelector('#gSvg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, bubbles: true }));
    for (let i = 1; i <= 10; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: cx + (x * i) / 10, clientY: cy + (y * i) / 10, bubbles: true }));
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [dx, dy]);
}

async function nodeCenter(page, name) {
  return page.evaluate((n) => {
    const el = [...document.querySelectorAll('#gSvg .g-node')].find((e) => (e.textContent || '').includes(n));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, name);
}

async function panTo(page, name, tx, ty) {
  const p0 = await nodeCenter(page, name);
  if (!p0) return;
  await dragStage(page, 0, -40);
  await sleep(220);
  const p1 = await nodeCenter(page, name);
  if (!p1) return;
  const k = (p1.y - p0.y) / -40 || 1;
  await dragStage(page, (tx - p1.x) / k, (ty - p1.y) / k);
  await sleep(260);
  const p2 = await nodeCenter(page, name);
  if (p2) { await dragStage(page, (tx - p2.x) / k, (ty - p2.y) / k); await sleep(220); }
}

/* ------------------------------------------------- 主流程 */

async function shoot(work, page) {
  const cfg = WORKS[work];
  const out = path.join(OUT_ROOT, work);
  fs.mkdirSync(out, { recursive: true });

  for (const shot of cfg.shots) {
    // 复位
    await page.evaluate(() => {
      const modal = document.querySelector('#modal');
      if (modal && !modal.hidden) {
        const btn = modal.querySelector('#modalClose,.modal-close,[data-close]');
        if (btn) btn.click();
      }
      const fs2 = document.querySelector('#fsExit');
      if (fs2 && document.body.classList.contains('graph-fs')) fs2.click();
    });
    await page.setViewport({ width: FRAME.w, height: FRAME.h, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    // 复位筛选：否则上一张的「妖魔界 / 敌对」会残留到这一张的计数里
    await clickSafe(page, '#gGroup [data-group="all"]', true);
    await clickSafe(page, '#gRelBar [data-rel="all"]', true);
    await clickSafe(page, '[data-faction="all"]', true);

    await page.evaluate((h) => {
      if (location.hash !== h) location.hash = h;
      else window.dispatchEvent(new HashChangeEvent('hashchange'));
    }, shot.hash);
    await sleep(shot.wait);

    if (shot.lineage) await lineageFrame(page, shot.lineage);

    if (shot.graph) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '全屏');
        if (btn) btn.click();
      });
      await sleep(1500);
      for (let i = 0; i < (shot.graph.zoomIn || 0); i++) {
        await clickSafe(page, '#stageTools [data-zoom="in"]');
        await sleep(350);
      }
      if (shot.graph.locate) {
        await page.evaluate((q) => {
          const i = document.querySelector('#gSearch');
          if (!i) return;
          i.focus(); i.value = q;
          i.dispatchEvent(new Event('input', { bubbles: true }));
          i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, shot.graph.locate);
        await sleep(900);
        await panTo(page, shot.graph.locate, FRAME.w * 0.5, FRAME.h * 0.46);
      }
    }

    for (let i = 0; i < (shot.zoomIn || 0); i++) {
      await clickSafe(page, '#gZoom [data-zoom="in"]', true);
      await sleep(320);
    }
    if (shot.click) { await clickSafe(page, shot.click); await sleep(700); }
    if (shot.click2) { await clickSafe(page, shot.click2); await sleep(600); }
    if (shot.zoomIn) { await sleep(300); }

    if (shot.clickEdge) {
      // 找一条连到「有后台」妖魔的边（统属类），点它弹出关系详情
      const ok = await page.evaluate(() => {
        const hits = [...document.querySelectorAll('.g-hit')];
        if (!hits.length) return false;
        hits[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      });
      if (!ok) console.log('  ! 没有可点的关系线');
      await sleep(600);
    }

    if (shot.scrollToText) { await scrollToText(page, shot.scrollToText); await sleep(400); }

    if (shot.modalScrollTo) {
      const ok = await page.evaluate((name) => {
        const body = document.querySelector('#modalBody');
        if (!body) return false;
        const sec = [...body.querySelectorAll('.m-sec,h3')].find((s) => (s.textContent || '').trim().startsWith(name));
        if (!sec) return false;
        // 真正的滚动容器不一定是 #modalBody：往上找第一个能滚的祖先
        let box = body;
        while (box && box.scrollHeight <= box.clientHeight + 4) box = box.parentElement;
        if (!box) return false;
        box.scrollTop += sec.getBoundingClientRect().top - box.getBoundingClientRect().top - 10;
        return true;
      }, shot.modalScrollTo);
      if (!ok) console.log('  ! 弹窗里没找到「' + shot.modalScrollTo + '」');
      await sleep(500);
    }

    if (shot.search) {
      const s = typeof shot.search === 'string' ? { sel: '#searchBtn', text: shot.search, viaBtn: true } : shot.search;
      if (s.viaBtn) { await clickSafe(page, s.sel); await sleep(500); }
      else { await page.evaluate((sel) => { const i = document.querySelector(sel); if (i) i.focus(); }, s.sel); }
      await page.keyboard.type(s.text, { delay: 40 });
      await sleep(700);
      if (s.enter !== false) await page.keyboard.press('Enter');
      await sleep(500);
    }

    if (!shot.cover) {
      // 西游/三国的 hero 很高，不对齐就会截到首屏空白；把内容区顶到 sticky 顶栏下沿
      await page.evaluate((sel) => {
        const bar = document.querySelector('.topbar');
        const barH = bar ? bar.getBoundingClientRect().height : 52;
        /* 红楼用 .view.active 切换，西游/三国用 hidden —— 两种机制都要兼容，
           否则 '.view:not([hidden])' 会永远匹配第一个视图，滚动位置全错。 */
        const view = document.querySelector('.view.active') ||
          document.querySelector('.view:not([hidden])') || document.body;
        const el = (sel && view.querySelector(sel)) ||
          view.querySelector('.graph-stage, .route-stage, .toolbar, .lg-toolbar, .stage') || view;
        window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - barH - 6));
      }, shot.panel || null);
      await sleep(380);
    }

    if (shot.cover) {
      await page.evaluate((html) => {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        document.body.appendChild(holder.firstElementChild);
        document.body.style.overflow = 'hidden';
      }, coverHTML(shot.cover));
      await sleep(300);
    }

    const file = path.join(out, shot.file);
    await page.screenshot({ path: file });

    if (shot.cover) {
      await page.evaluate(() => {
        const el = document.querySelector('#xhsCover');
        if (el) el.remove();
        document.body.style.overflow = '';
      });
    }
    console.log('✓', path.relative(process.cwd(), file));
  }
  return cfg.shots.length;
}

(async () => {
  const arg = (process.argv.find((a) => a.startsWith('--work=')) || '--work=all').split('=')[1];
  const works = arg === 'all' ? Object.keys(WORKS) : [arg];
  works.forEach((w) => { if (!WORKS[w]) { console.error('未知作品：' + w + '（可选 honglou / sanguo / xiyou / all）'); process.exit(1); } });

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none', '--lang=zh-CN'],
  });
  const page = await browser.newPage();

  // 隐藏滚动条、关掉过渡动画（截图时不抖在中间态）
  await page.evaluateOnNewDocument(() => {
    const css = `html,body{scrollbar-width:none}::-webkit-scrollbar{display:none!important}
      *{animation-duration:.001s!important;transition-duration:.001s!important}
      html{scroll-behavior:auto!important}`;
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    });
  });

  let total = 0;
  for (const work of works) {
    const cfg = WORKS[work];
    await page.setViewport({ width: FRAME.w, height: FRAME.h, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/works/${work}/#graph`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(cfg.ready, { timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    console.log(`\n—— ${work}`);
    total += await shoot(work, page);
  }

  await browser.close();
  console.log(`\n完成 ${total} 张 → ${path.relative(process.cwd(), OUT_ROOT)}/<work>/`);
  console.log('尺寸均为 1080×1440（3:4），可直接上传小红书。');
})().catch((e) => { console.error(e); process.exit(1); });
