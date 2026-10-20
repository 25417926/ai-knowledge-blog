---
title: 写了却没生效：Next.js 里五个不报错的时序坑
category: 踩坑
tags: [Next.js, React, 调试, e2e, 踩坑]
date: 2026-10-20
summary: 代码在、样式在、控制台干净，功能就是不动。五个坑的共同点是「两层东西各自都对，只是发生在错的时刻」——组件没重挂、清单被缓存、事件早于 hydration、字符串没跟着路由改、断言抢在被测行为之前。
---

# 写了却没生效：Next.js 里五个不报错的时序坑

后台新建文章并保存，接口 200、文件落了盘、索引重建、跳转也发生了。但页面上那句「已保存到 Vault，索引已重建」从来没出现过，地址栏里的 `?saved=1` 也一直挂着不走。

第一反应是样式问题：提示是不是被挡住了、颜色和背景同色、或者 `transition` 把 opacity 卡在 0。都不是。那段代码只有十几行，`setNotice` 也在，`notice && <p>` 也在。

真正的原因不在那段代码里，而在于**它没有第二次机会执行**。顺着这条线摸下去，同一天里又撞出四个同类问题。它们的共同点很一致：两段各自都对的逻辑，只是发生在错的时刻。浏览器不会报错，`next build` 也是绿的，所以只能靠人看出来。

## 坑一：同一路由段换参数，组件不会重挂

后台的保存流程是这样的：新建页在 `/admin/posts/new`，保存成功后后端返回真实 slug，前端再跳到那篇文章的编辑页。

```tsx
// src/app/admin/posts/[slug]/page.tsx
if (isNew) {
  const auto = result.summaryGenerated ? '&summary=auto' : '';
  router.replace(`/admin/posts/${encodeURIComponent(result.slug)}?saved=1${auto}`);
}
```

`new` 和真实的 slug 是**同一个路由段** `[slug]` 的两个参数值。App Router 在段没变、只换参数时，会复用同一个组件实例——`useState` 保留、`useRef` 保留、组件的 mount 生命周期也不会重跑。于是下面这段就成了死代码：

```tsx
// 改之前：依赖是空数组，永远不会再跑一次
useEffect(() => {
  const flags = new URLSearchParams(window.location.search);
  if (!flags.has('saved')) return;
  setNotice('已保存到 Vault，索引已重建');
  window.history.replaceState(null, '', window.location.pathname);
}, []);   // ← 问题在这一行
```

组件只在「从别的路由进来」时挂载一次，那时 URL 上还没有 `?saved=1`，effect 里的 `flags.has('saved')` 直接 return。之后 `router.replace` 换了参数，组件没重挂，effect 自然不会重跑。表现就是回执不出现、参数也清不掉。

改法只有一行——把 `slug` 加进依赖：

```tsx
}, [slug]);
```

这件事真正麻烦的地方在于**它看起来像一切正常**。文章内容确实是新的，因为加载数据的那个 effect 依赖 `slug`，参数一变就重新拉了。如果只验「保存后内容对不对」，这条会一直漏过去；要验的是「保存后有没有那句提示」。

由此得到一条还算通用的判据：只要在 App Router 里用 `router.replace` 换同一段的参数，就该把「我想只执行一次」的念头按下去。一次性副作用（回执、清 URL、滚动定位）的依赖里，必须带上那个变了的参数。

## 坑二：`next start` 缓存了 public 的文件清单

往 `public/notes/<slug>/` 下放了一批图片，正文里的 `<img>` 路径也对，但页面上的图全是 404。翻磁盘——文件在；`ls` 有；大小也不是 0。于是开始怀疑路径大小写、怀疑中文编码、怀疑 Next 的 rewrites 把 `/notes/*` 拦走了。

最后发现是服务没重启。`next start` 在启动那一刻就把 `public/` 的文件清单记下来了，进程活着的时候，新加进去的文件不在清单里，请求直接 404——**文件在磁盘上，但服务器认为它不存在**。

这条没有代码可改，只有纪律可立：`public/` 下新增目录或文件，重启进程再验收。少这一次重启，能白查半小时路径问题。

## 坑三：hydration 之前派出去的事件，是打给没人听的电话

博客助手的入口是左下角那个桌宠。点它，桌宠派一个 window 事件，助手面板监听它并打开：

```tsx
// src/components/BlogAssistant.tsx
export const OPEN_ASSISTANT_EVENT = 'blog-assistant:open';

useEffect(() => {
  const openPanel = () => setOpen(true);
  window.addEventListener(OPEN_ASSISTANT_EVENT, openPanel);
  return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, openPanel);
}, []);
```

注意 `addEventListener` 在 `useEffect` 里——要等 hydration 之后才挂上。而 e2e 里最直觉的写法是：打开页面，立刻派事件，然后等面板出现。

```js
// 改之前
await page.goto(url);
await page.evaluate(() => window.dispatchEvent(new Event('blog-assistant:open')));
const panel = page.locator('section[aria-label="博客助手"]');
await panel.waitFor({ state: 'visible', timeout: 20_000 });   // 20 秒后超时
```

事件确实派了，只是那一刻还没有任何监听器。事件不排队、不会有第二次投递，**错过就是错过**，而且不报错。于是断言只表现为「20 秒后超时」，看起来像面板坏了。

改法是把「派发」变成可以重复的动作，直到真的有人在听：

```js
async function openAssistant(page) {
  const panel = page.locator('section[aria-label="博客助手"]').first();
  for (let i = 0; i < 20; i += 1) {
    if ((await panel.count()) > 0 && (await panel.isVisible())) return panel;
    await page.evaluate(() => window.dispatchEvent(new Event('blog-assistant:open')));
    await page.waitForTimeout(300);
  }
  throw new Error('助手面板打不开：派发 blog-assistant:open 后仍不可见');
}
```

轮询的间隔和次数都写得很朴素，因为目的不是快，而是**把「时机不确定」这件事在测试里显式化**。顺带把报错信息改成人话：超时和「派了事件但没人接」是两种完全不同的故障，应该给两种不同的提示。

## 坑四：路由改了，跟着它的字符串没改

助手有个「只搜当前这篇」的开关：在文章页上，它只检索当前文章，而不是整站。它靠一段正则从 `usePathname()` 里认当前文章：

```tsx
// 改之前
const match = /^\/blog\/(.+)$/.exec(pathname);
const articleSlug = match ? decodeURIComponent(match[1]) : null;
```

而站点的路由早就从 `/blog/[slug]` 改成了 `/posts/[slug]`。于是 `match` 恒为 `null`，`articleSlug` 恒为 `null`，整个开关被 `{articleSlug && …}` 挡掉——**这个功能从来没在文章页出现过**，而且没有任何报错。它不崩、不警告，只是安静地不存在。

改的时候顺手收紧了一处：`(.+)` 会把 `/posts/a/b` 也整段吞进来，而 slug 只有一段。

```tsx
const match = /^\/posts\/([^/]+)\/?$/.exec(pathname);
```

这类失效最难靠自测发现，因为自测时你验的是「点开关能不能切换」，而开关根本没渲染出来，你只会得出「这功能不常用」的错觉。真正管用的是**反向断言**：不仅要求文章页有这个开关，还要求首页没有。正则若被写成什么都匹配的宽松版本，首页就会一起出现，那时反向断言才会红。

## 坑五：断言自己也会被时序骗

修完坑一，想给它补一条 e2e：保存之后，页面上应该出现那句回执。于是写了：

```js
await page.click('button:has-text("保存")');
await page.waitForURL('**?saved=1');    // 扑空
```

扑空的原因是那段 effect 跑完之后立刻 `history.replaceState` 把参数抹掉了。等 `waitForURL` 去轮询时，参数已经不在 URL 上——**被测行为本身就在删证据**。

同一类问题还有两个：

- `page.url()` 在客户端跳转之后会滞后一小会儿，脚本里读到的是上一页的地址。要读就读 DOM 上的真相：`page.evaluate(() => location.pathname + location.search)`。
- 保存完立刻查 DOM 里有没有提示，多半是 `false`——React 还没把这一帧提交上去。该等的是 `waitForFunction` 里那个条件真的成立，而不是等固定毫秒数。

第三个更阴：截图撞上入场动画。气泡淡入 280ms，`waitForSelector` 一返回就截图，拍到的可能是 `opacity ≈ 0.096` 的中间态，看起来像「背景完全透明、CSS 没生效」。整页缩略图（1440 缩到 1080）还会把邻卡的文字糊成「透出来的内容」，把判断带偏。判这类问题必须等动画结束，并且用元素级 1:1 截图。

## 怎么证明「不是碰巧好了」

上面五条修完，测试全绿。但绿有个前提条件：**断言本身有能力红**。否则你得到的只是「跑通了一条永远会通过的用例」。

所以每修一条，刻意做一次反向验证——把修复撤掉、重新构建、看它是不是真的红：

| 动作 | 期望 | 实际 |
|---|---|---|
| 正则改回 `^/blog/(.+)$` | 该条超时失败，其余照跑 | 4/5 通过，退出码 1 |
| 目录吸顶去掉 `lg:h-full` | 目录 `top` 变负值 | `top=-813`，7/8，退出码 1 |
| 画布材质 `DoubleSide` 改回 `FrontSide` | 像素数为 0 | `0 个不透明像素`，6/7，退出码 1 |

然后按**字节**还原（文本模式下读出来再写回会把 CRLF 翻成 LF，md5 就变了，还原得「差不多」不是还原），重建，确认回到全绿。这一来一回的代价大概是两次构建，换到的是「这条断言以后真的会替你挡事」。

> [!tip] 一条能复用的判据
> 遇到「代码写了却不生效」，先别改代码，问一句：**这段逻辑还有没有机会被执行第二次？**
> 组件不重挂、清单被缓存、事件错过监听器、字符串不跟着路由走、断言跑在行为之前——这五个坑的答案都是「没有」。

## 剩下的

这五条里有四条属于同一类：**两套坐标系各自都对，但对不上**。路由是一套，字符串是另一套；服务启动时的清单是一套，磁盘是另一套；hydration 前后的 JS 是两套；测试的时钟和 UI 的时钟是两套。跨边界的地方不会报错，只会静默地不生效。

真正省时间的做法不是记住这五个具体坑，而是记住它们的形状：**凡是「同一个东西在两个地方各记了一份」，就该主动去验一次它们还一致吗**。这一条比任何一条单独的修法都耐用。

相关：[[检索的收尾-没找到还挂着出处|检索的收尾：为什么「没找到」下面还挂着四条出处]]
