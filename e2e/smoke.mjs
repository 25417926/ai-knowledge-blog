#!/usr/bin/env node
/**
 * 三条冒烟 e2e（EXECUTION_PLAN §14.2 P5-3）。
 *
 * 为什么只有三条：`src/` 到这一轮为止没有任何前端测试，这里补的是**最容易整体崩掉、
 * 崩了最丢人**的三条路径，不是覆盖率。三条都刻意不碰 LLM——一次问答要等本机模型
 * 十几秒，把它塞进冒烟会让「跑一下看看」变成没人愿意跑的东西。
 *
 *   1. 首页三区块都在（博主资料 / 最新文章 / 主题导览），且文章数据是通的
 *   2. /posts/<不存在> 是**软 404**：HTTP 404 + 「这条街没有这栋楼」，不能是 500
 *   3. 未登录访问 /admin/* 会被闸门 replace 到 /admin/login，且不泄漏侧栏
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
      const res = await fetch(target.url, { signal: AbortSignal.timeout(5000) });
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
