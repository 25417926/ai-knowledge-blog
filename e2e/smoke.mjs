#!/usr/bin/env node
/**
 * 六条冒烟 e2e（EXECUTION_PLAN §14.2 P5-3、§18、§20）。
 *
 * 为什么只有六条：`src/` 到这一轮为止没有任何前端测试，这里补的是**最容易整体崩掉、
 * 崩了最丢人**的路径，不是覆盖率。六条都刻意不碰 LLM——一次问答要等本机模型
 * 十几秒，把它塞进冒烟会让「跑一下看看」变成没人愿意跑的东西。
 *
 *   1. 首页三区块都在（博主资料 / 最新文章 / 主题导览），且文章数据是通的
 *   2. /posts/<不存在> 是**软 404**：HTTP 404 + 「这条街没有这栋楼」，不能是 500
 *   3. 未登录访问 /admin/* 会被闸门 replace 到 /admin/login，且不泄漏侧栏
 *   4. 文章页的助手有「只搜当前这篇」，首页没有
 *   5. 导航里的「图谱」能进 /graph，画出来的节点数与 /api/graph 一致，且 WebGL 画布真有像素
 *   6. 收藏稿的 `> [!tip]` 渲染成 callout 卡片，页面上不留字面残留
 *
 * 第 4 条是补漏出来的：`articleSlug` 的正则一直写着 `^/blog/(.+)$`，而路由早就是
 * `/posts/[slug]` —— 于是这个开关在文章页**从来没渲染过**，也没有任何报错。
 * 这类「路由改了、跟着它的字符串没改」的失效，只有 e2e 看得见。
 * 第 5 条同理：`/api/graph` 与 `getGraph()` 曾经长时间零调用，接口在、页面不在。
 * 这一条现在还负责盯住「画布空转」——见 §21，节点数对、像素全透明的那种。
 *
 * 依赖：前端 `next start`（:3401）与后端（:8000）都要在跑。脚本先探活，
 * 服务没起时直接给「先起服务」的提示，而不是抛一个看不懂的超时。
 *
 * 浏览器：用系统 Edge（`channel: 'msedge'`），不下载 Chromium。
 * playwright-core 优先取项目 node_modules，其次 PLAYWRIGHT_CORE / NODE_PATH，
 * 最后回落到托管工作区——本机就是靠这一档，仓库里不写死用户名。
 *
 * 用法：
 *   npm run e2e
 *   E2E_BASE=http://127.0.0.1:3401 E2E_CHANNEL=msedge node e2e/smoke.mjs
 */
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = (process.env.E2E_BASE ?? 'http://127.0.0.1:3401').replace(/\/+$/, '');
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const TIMEOUT = Number(process.env.E2E_TIMEOUT ?? 20_000);

const results = [];
const consoleErrors = [];

/**
 * 用例自己声明「这一次的 404 是预期的」。
 *
 * 不能用「含 404 就忽略」这种白名单：那会把首页 chunk 拉不到这类真问题一起吞掉。
 * 这里按**文档 URL** 精确豁免 —— 只有那次 `page.goto` 的目标地址能免。
 */
const expected404 = new Set();


function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  \u2713 ${name}${detail ? `  \u2014 ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`  \u2717 ${name}  \u2014 ${detail}`);
}

/** 收一条断言，异常也变成一次失败而不是中断整轮（后面的用例还能跑）。 */
async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}

/** 静态资源/字体之类的噪音不算：只盯真正的 console.error 与未捕获异常。 */
function watch(page) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon|ERR_INTERNET_DISCONNECTED|net::ERR_ABORTED/i.test(text)) return;
    // 用例主动走了一条不存在的路径时，浏览器一定会报这条；按 URL 精确豁免
    if (expected404.has(msg.location().url) && /status of 404/i.test(text)) return;
    consoleErrors.push(`${page.url()} :: ${text.slice(0, 160)}`);
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`${page.url()} :: pageerror ${err.message.slice(0, 160)}`);
  });
}

async function loadChromium() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE) candidates.push(process.env.PLAYWRIGHT_CORE);
  candidates.push('playwright-core');
  for (const dir of (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, 'playwright-core', 'index.js'));
  }
  candidates.push(
    path.join(
      os.homedir(),
      '.workbuddy',
      'binaries',
      'node',
      'workspace',
      'node_modules',
      'playwright-core',
      'index.js',
    ),
  );

  const tried = [];
  for (const candidate of candidates) {
    const isPath = path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate);
    const specifier = isPath ? pathToFileURL(candidate).href : candidate;
    try {
      const mod = await import(specifier);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
      tried.push(`${candidate} \u2192 没有导出 chromium`);
    } catch (err) {
      tried.push(`${candidate} \u2192 ${err.code ?? err.message}`);
    }
  }
  throw new Error(`找不到 playwright-core，试过：\n    ${tried.join('\n    ')}`);
}

/** 服务没起的时候，「等了 20 秒超时」是最难排查的报错——提前一次说清楚。 */
async function preflight() {
  const targets = [
    { label: '前端', url: `${BASE}/` },
    // 走前端同源代理：既验代理 rewrites 还在，也验后端活着
    { label: '后端（经 /api 代理）', url: `${BASE}/api/health` },
  ];
  for (const target of targets) {
    try {
      // 20s 不是随手写的：`next start` 之后第一次访问 `/` 要现渲染 + 后端要现拉 GitHub
      // 热力图，冷启动实测能到 6~8s。给 5s 会让「刚起服务就跑 e2e」稳定误报成「前端不可达」。
      const res = await fetch(target.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      throw new Error(
        `${target.label}不可达：${target.url}\n` +
          `  ${err instanceof Error ? err.message : String(err)}\n` +
          `  先起服务：npm run start（前端 :3401）+ npm run server（后端 :8000）`,
      );
    }
  }
}

async function caseHome(page) {
  const response = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  if (!response || !response.ok()) {
    throw new Error(`首页 HTTP ${response?.status() ?? '无响应'}`);
  }

  const blocks = ['博主资料', '最新文章', '主题导览'];
  for (const label of blocks) {
    const locator = page.locator(`section[aria-label="${label}"]`).first();
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
  }

  // h1 是 sr-only（首页是一墙卡片，没有显眼主标题），但它必须存在，读屏与 SEO 都靠它
  const h1 = await page.locator('h1').first().textContent();
  if (!h1 || h1.trim() === '') throw new Error('h1 为空');

  // 三区块「在」还不够：数据断了它们照样在，只是里面全空
  const posts = await page.locator('section[aria-label="最新文章"] a[href^="/posts/"]').count();
  if (posts === 0) {
    throw new Error('最新文章区块里没有文章链接（后端数据没导入？先跑 npm run setup）');
  }

  return `3 区块 · ${posts} 个文章链接 · h1「${h1.trim()}」`;
}

async function caseSoft404(page) {
  const target = `${BASE}/posts/${encodeURIComponent('这条街肯定没有这篇文章')}`;
  // 先登记再跳：这一条的 404 是断言对象，不是错误
  expected404.add(target);

  const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
  const status = response?.status() ?? 0;
  if (status !== 404) {
    throw new Error(`期望 HTTP 404，实际 ${status}（500 说明渲染时抛错了）`);
  }

  const title = page.locator('text=这条街没有这栋楼').first();
  await title.waitFor({ state: 'visible', timeout: TIMEOUT });

  const code = await page.locator('text=ERROR 404').first().isVisible();
  if (!code) throw new Error('404 页少了 ERROR 404 标记');

  return 'HTTP 404 + 「这条街没有这栋楼」';
}

async function caseAdminGate(page) {
  // 直接进深层路由：闸门在 layout 上，/admin 根路径也要验，但深一层更能说明「整块受保护」
  await page.goto(`${BASE}/admin/posts`, { waitUntil: 'domcontentloaded' });

  // Next 软导航不触发 networkidle，只能盯 URL
  await page.waitForURL(/\/admin\/login\/?$/, { timeout: TIMEOUT });

  const heading = page.locator('h1', { hasText: '后台登录' }).first();
  await heading.waitFor({ state: 'visible', timeout: TIMEOUT });

  // 跳转期间不能先闪出后台内容：侧栏若出现过，说明闸门漏了
  const leaked = await page.locator('nav a', { hasText: '访客意图' }).count();
  if (leaked > 0) throw new Error('登录页仍渲染了后台侧栏');

  return `replace 到 ${new URL(page.url()).pathname}`;
}

/**
 * 打开助手面板。
 *
 * 面板靠一个 window 自定义事件打开（桌宠与导航都用它），但**事件派发早于 hydration
 * 就等于打给没人听的电话**——面板不会开，也不报错。所以轮询重发，直到真的可见；
 * 真开不起来时给一句人话，而不是一句 locator 超时。
 */
async function openAssistant(page) {
  const panel = page.locator('section[aria-label="博客助手"]').first();
  for (let i = 0; i < 20; i += 1) {
    if ((await panel.count()) > 0 && (await panel.isVisible())) return panel;
    await page.evaluate(() => window.dispatchEvent(new Event('blog-assistant:open')));
    await page.waitForTimeout(300);
  }
  throw new Error('助手面板打不开：派发 blog-assistant:open 后仍不可见');
}

async function caseScopedAsk(page) {
  // 幂等：这条要读首页的文章链接，别依赖上一条用例把页面留在哪儿
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  // slug 从首页现取：文章会变，写死的话这条会先因为「文章没了」而红，掩盖真正要盯的东西
  const href = await page.getAttribute(
    'section[aria-label="最新文章"] a[href^="/posts/"]',
    'href',
  );
  if (!href) throw new Error('首页拿不到文章链接，没法进文章页');

  await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
  const panel = await openAssistant(page);

  // 面板里唯一的范围开关：文案会随状态在两种之间翻转
  const toggle = panel.getByRole('button', { name: /只搜当前这篇|搜索全部文章/ });
  await toggle.waitFor({ state: 'visible', timeout: TIMEOUT });
  const label = (await toggle.textContent())?.trim();

  // 反向：首页不该有。正则要是写成 `/(.+)$` 这种什么都匹配的，这里才会红
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const homePanel = await openAssistant(page);
  const onHome = await homePanel
    .getByRole('button', { name: /只搜当前这篇|搜索全部文章/ })
    .count();
  if (onHome > 0) throw new Error('首页也出现了「只搜本文」开关');

  return `文章页有「${label}」，首页没有`;
}

async function caseGraphPage(page) {
  // 期望值取自接口：只数「画了几个点」证明不了图里画的真是这篇文章的数据
  const res = await fetch(`${BASE}/api/graph`);
  if (!res.ok) throw new Error(`/api/graph HTTP ${res.status}`);
  const data = await res.json();
  const expected = data.nodes.length;

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const navLink = page.locator('nav a[href="/graph"]').first();
  await navLink.waitFor({ state: 'visible', timeout: TIMEOUT });
  await navLink.click();
  await page.waitForURL(/\/graph\/?$/, { timeout: TIMEOUT });

  const drawn = page.locator('[data-graph-node]');
  await drawn.first().waitFor({ state: 'visible', timeout: TIMEOUT });
  const count = await drawn.count();
  if (count !== expected) {
    throw new Error(`图上 ${count} 个节点，接口 ${expected} 个（渲染层与数据层对不上）`);
  }

  // 节点数对得上，不代表画布上真有东西：three.js 那条路曾经「45 次 draw call、0 个像素」
  // 地空转了一整轮（扁平面朝向被投影翻转当背面剔掉）。所以再数一次真实像素。
  // 先给画布一点时间挂上来（动态 import + WebGL 探测约 200ms），等不到才认「SVG 兜底」。
  await page
    .locator('canvas.block')
    .first()
    .waitFor({ state: 'visible', timeout: 3000 })
    .catch(() => {});
  const painted = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const canvas = document.querySelector('canvas.block');
        const gl = canvas?.getContext('webgl2');
        if (!canvas || !gl) return resolve(-1); // 没有 WebGL 就走 SVG 兜底，不算失败
        const px = new Uint8Array(canvas.width * canvas.height * 4);
        let tries = 0;
        const tick = () => {
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let opaque = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] > 8) opaque += 1;
          tries += 1;
          if (opaque > 1000 || tries > 60) resolve(opaque);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  if (painted !== -1 && painted < 1000) {
    throw new Error(`画布在，但只有 ${painted} 个不透明像素（WebGL 层在空转）`);
  }

  return `${count} 个节点 · ${data.edges.length} 条连线 · ${painted === -1 ? 'SVG 兜底' : `${painted} 个像素`}`;
}

async function caseCallout(page) {
  const res = await fetch(`${BASE}/api/posts`);
  if (!res.ok) throw new Error(`/api/posts HTTP ${res.status}`);
  const posts = await res.json();
  const post = (Array.isArray(posts) ? posts : []).find((item) => item.category === 'clippings');
  if (!post) throw new Error('库里没有收藏稿，这条用例没有样本（先跑 npm run setup）');

  await page.goto(`${BASE}/posts/${encodeURIComponent(post.slug)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.callout').first().waitFor({ state: 'visible', timeout: TIMEOUT });

  // 反面：`[!tip]` 字面量漏到正文，说明 remark 插件没接上
  const text = await page.locator('main').innerText();
  if (text.includes('[!tip]')) throw new Error(`正文残留 [!tip] 字面量（《${post.title}》）`);

  return `《${post.title}》的 callout 已渲染`;
}

async function main() {
  console.log(`\nsmoke e2e \u2192 ${BASE}（${CHANNEL}）\n`);

  try {
    await preflight();
  } catch (err) {
    console.error(`\u2717 预检失败\n  ${err.message}\n`);
    process.exit(1);
  }

  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({ channel: CHANNEL });
  } catch (err) {
    console.error(
      `\u2717 启动浏览器失败（channel=${CHANNEL}）\n  ${err.message}\n` +
        `  这台机器上没有 Edge 的话，用 E2E_CHANNEL=chrome 或 msedge 指定一个已装的。\n`,
    );
    process.exit(1);
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch(page);

  await step('首页三区块 + 数据通路', () => caseHome(page));
  await step('文章页才有「只搜本文」', () => caseScopedAsk(page));
  await step('图谱页节点数与接口一致', () => caseGraphPage(page));
  await step('收藏稿 callout 已渲染', () => caseCallout(page));
  await step('不存在的文章走软 404', () => caseSoft404(page));
  await step('未登录访问后台跳登录', () => caseAdminGate(page));

  await context.close();
  await browser.close();

  if (consoleErrors.length > 0) {
    fail(`控制台零错误`, `捕获 ${consoleErrors.length} 条`);
    for (const line of consoleErrors.slice(0, 6)) console.log(`      ${line}`);
  } else {
    pass('控制台零错误');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} 通过${failed.length ? `，${failed.length} 条失败` : ''}\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main().catch((err) => {
  console.error(`\u2717 未捕获异常：${err?.stack ?? err}\n`);
  process.exit(1);
});
