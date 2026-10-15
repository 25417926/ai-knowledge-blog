---
category: clippings
date: '2026-10-15'
source: https://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html
summary: 科技爱好者周刊（第 414 期）：Jev 决策模型有什么用
tags:
- 收藏
title: 科技爱好者周刊（第 414 期）：Jev 决策模型有什么用
---

# 科技爱好者周刊（第 414 期）：Jev 决策模型有什么用

> 来源：[https://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html](https://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html) · 收藏于 2026-10-15 · 本文由收藏管道自动整理

## 三段式总结

> ⚠️ 未配置 LLM，以下是原文开头节选，不是转述。在 server/.env 配好 LLM_API_KEY 后重新收藏即可生成三段式总结。

### 是什么
科技爱好者周刊（第 414 期）：Jev 决策模型有什么用

### 核心观点
> 这里记录每周值得分享的科技内容，周五发布。
> 本杂志开源，欢迎投稿。另有《谁在招人》服务，发布程序员招聘信息。合作请邮件联系（\[email protected\]）。

### 对我的启发
（配置 LLM 后生成）

## 原文 PDF

本文的 AI 总结自以下文档；PDF 是收藏时留存的原文存档，原链接失效也能看：

- 《科技爱好者周刊（第 414 期）：Jev 决策模型有什么用》· 4837 字 · [打开原文 PDF](/api/clippings/pdf?url=https%3A//www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html)

## 原文

这里记录每周值得分享的科技内容，周五发布。

本杂志开源，欢迎投稿。另有《谁在招人》服务，发布程序员招聘信息。合作请邮件联系（\[email protected\]）。

### 封面图

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100816.webp)

国产首列数字地铁列车 VELLINK，完全无人驾驶，车头改成了大幅玻璃，用于观光。（via）

### Jev 决策模型有什么用

上个月，最大的 AI 新闻不是 GPT 或 Claude 模型的新版本，而是一家名不见经传的公司 TypeSafe AI 发布了一种新类型的模型 Jev。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100817.webp)

这种新模型跟以前的模型截然不同，叫做"决策模型"。

我看了以后，觉得不可置信，这么有用又这么（概念）简单的东西，以前怎么会没人想到？

Jev 模型的最大特点就是，其他模型返回文字，**它返回一个浮点数，表示概率**。

为什么返回概率就有用呢？因为我们可以用它处理"是非题"了。你问它"'明天下雨'这句话对不对"。它返回 0，表示正确的概率为0，即明天肯定不下雨；如果返回0.99，表示有99%的可能，这句话是真的，也就是明天必定下雨。

除了是非题，它还能处理"选择题"。你给它 ABCD 四个选项，它会返回每个选项正确的概率，因此你马上知道哪个选项最可能为真。

最后，它还有一个神奇的功能，叫做"评分"（score）。你告诉它一组评分标准，然后再给它一篇原始材料，它就会根据评分标准，对原始材料进行打分。

下面，我给大家看两个真实例子，你就会知道这个模型多么有用。它们都是使用 Jev 模型的浏览器插件。

第一个例子是《我用 Ctrl + F 寻找答案》。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100818.webp)

大家知道，Ctrl + F 是浏览器的"查找"快捷键，用来查找某个单词或句子出现在哪里。

但是，作者把这个快捷键改造成"语义查找"。比如，在一个人物传记网页上，你按 Ctrl + F 输入"青少年时代"，查找的不是这个词，而真的是讲述人物小时候经历的那个段落。

它的实现原理很简单，就是依次拿出文章的每个段落，去问 Jev 模型"本段落是否跟用户的搜索词相关？"（是非题）。Jev 会返回一个相关度的概率，那么相关度最高的几个段落，就是用户需要的语义查找结果。

第二个是例子《我用 Jev 为网页打分》。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100819.webp)

作者给出了一组标准，从低分到高分。

- 论点缺乏依据，或者纯粹在堆砌辞藻。
- 理由寥寥，或论证松散、流于修辞。
- 理由清晰，逻辑结构连贯。
- 推理结构严密，有实据支撑，并回应了反方观点。

他让 Jev 根据这些标准，自动为新打开的网页打分（评分题）。这样一来，他不用读网页，就能知道内容的质量。

上面两篇文章，里面都有代码，大家可以自己去看。看完你就明白了，**一旦 AI 模型返回量化的结果，许多以前无法数字化处理的问题，顿时都能用计算机处理了**。

著名开发者西蒙·威利斯（Simon Willison）的 Jev 介绍文章，我也推荐大家阅读。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100820.webp)

他的评价一针见血："Jev 实际上代表着机器学习系统的倒退，走向黑箱系统。以前的大模型虽然不能保证正确，但至少你可以要求它们解释它们的决定。Jev 甚至连这点都不给你：你只会得到一个浮点数，这个数字是怎么来的，不知道。"

他很担忧，有人会用 Jev 给求职者排名。

有了 Jev 以后，公司筛选简历、挑选面试人从未如此容易，复杂的评估被简化成一个评分题。

### Markdown 正在变成源码

Markdown 格式以前只用于写文档。最近，我看到一篇文章，作者提出一个大胆的命题：Markdown 正在变成源码。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100821.webp)

作者的理由听起来很有道理。

（1）Markdown 是纯文本，差异比较、搜索、审查都很容易。

（2）AI 可以像母语一样读写 Markdown。

（3）人类无需工具即可阅读和编辑 Markdown。

既然代码是 AI 根据 Markdown 提示词生成的，那么 Markdown 提示词就应该和生成的源码一起，提交到`/src`目录。

事实上，Markdown 已经作为 AGENTS.md 文件，成为了源码的一部分。

以后，我们必须要习惯，Markdown 文档也是源码。

### 不能摄像的摄像头

据传，苹果公司最近将发布一款智能家居摄像头。

这款产品最奇特的地方在于，它虽然是摄像头，但是不能录制视频。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100512.webp)

你能想象吗，摄像头不能摄像，那还叫摄像头吗？

它完全依靠 AI 分析周围环境，并报告检测到的内容。比如，陌生人敲门。其他摄像头会提供视频，它只会提供详细的文字描述。

虽然文字处理比较方便，但是很多时候确实需要视频记录（入室盗窃、包裹被盗等等），不知道苹果会如何处理这些情况。

### RSA 因素分解的新纪录

RSA 是一种常用的密钥算法。如果被破解，许多软件顿时就毫无秘密可言了。

RSA 的破解难度，完全取决于它的公钥能否被因数分解。加密位数越多，越难破解，RSA 密钥破解以前的最高纪录是768位（二进制位）。

就是今年9月20日，Anthropic 公司的一位软件工程师宣布，他在 Claude 模型的帮助下，破解了896位的 RSA 密钥。

下面就是他放出来的被破解的密钥，以及这个密钥分解后的两个质因子。

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092002.webp)

据他透露，他用 Claude 模型将质因数分解的软件库 CADO-NFS 移植到 GPU 运行，在2048个 GPU 上运行了10天，就得到了结果。

这件事的启示是，一个个人就能调用资源，破解这么长的密钥了，那么大机构可以破解多少位的密钥？都不敢想象啊。

所以，目前都建议，RSA 密钥最少也要2048位。

### 文章

1、JavaScript 技术栈2026最新动态（英文）

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092401.webp)

CodePen 和 CSS-Tricks 创始人克里斯·科耶（Chris Coyier）的文章，介绍 JS 技术栈各方面（语法、运行时、框架、工具等）的最新进展，推荐阅读。

2、我从 Deno 转投 Node.js（英文）

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100518.webp)

作者表达了对 Deno 的失望，认为该项目已经失败，反而是 Node.js 变得更好用。

3、example.com 更改页面的解释（英文）

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100513.webp)

example.com 是一个示例网站，只有一个页面，很少发生变化。

但是最近，这个页面突然发生了变动。本文告诉你，到底是谁架设了这个页面，又为什么要更改它。

4、AI 竞赛变得尴尬起来（英文）

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100815.webp)

本文认为，最近 Opus 5.5 和 GPT 6.1 Sol 的价格下降，完全是因为这两家公司偷偷使用了 DeepSeek 的开源成果。

5、C 语言的灵活整数大小不是设计失误（英文）

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026093001.webp)

一篇 C 语言科普文章，解释为什么它的数据类型的字节大小是可变的，比如 int 类型可以是4个字节，也可以是两个字节。

6、我如何让一个二维码指向两个应用商店（英文）

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026093002.webp)

作者为自己的产品设计了一个纸质卡片，只能印上一个下载二维码。

他介绍怎么设置服务器后端，区分扫描二维码手机是安卓还是苹果，然后重定向到各自的应用商店。

### 工具

有人让 AI 使用 Rust 语言重写了 Adobe 套件。Adobe 的7个主力产品，都有对应的重写版，而且全部开源。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100810.webp)

其中的 PhotoCraft，界面跟 PhotoShop 简直一模一样。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100811.webp)

我看到一条评论说，这件事的结果不是 Adobe 公司完蛋，就是美国修改版权法。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100508.webp)

苹果公司官方推出的一款二维码卡片设计软件，用来设计二维码的背景卡片。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100509.webp)

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026091901.webp)

一个可以自定义的终端面板，通过配置定义不同的布局和内容。（@lyuangg 投稿）

4、yovoice

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026091903.webp)

一个桌面的本地 TTS 配音工具，支持音色复刻和情绪调节，可以按照文稿生成配音，语音在本地生成。（@leemysw 投稿）

5、sh.cd

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026091905.webp)

一个服务器体检脚本，检查硬件、性能、IP 质量、网络质量等。（@gentpan 投稿）

6、AirStats

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092601.webp)

macOS 菜单栏上的系统监控器。（@byrencheema 投稿）

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092602.webp)

识别视频语音、并自动添加字幕的 Web 应用。通过本地模型完成识别，视频、字幕、导出结果均在本地完成，不上传服务器。（@anghunk 投稿）

另有一个同类应用 OpenSubs。（@open-subs 投稿）

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092603.webp)

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092604.webp)

免费开源的 Windows 11 桌面图标管理工具，整理桌面上的程序快捷方式、文件和文件夹。（@DayuanJiang 投稿）

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092605.webp)

基于 Cloudflare Worker 的私有 Skill 仓库，下载 Skill 需要口令，使用小团队内部使用。（@Qsnh 投稿）

10、Pebrel

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092606.webp)

一个跨平台的终端，适合 Windows 使用，以前的名字是 Nebula。（@Kuddev 投稿）

开源的 macOS 动态壁纸应用，在 Mac 上运行 Wallpaper Engine 壁纸。（@fzlzjerry 投稿）

12、LiteZip

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100602.webp)

免费开源的 macOS 压缩与解压工具，把打包、加密、分卷和查看压缩包内容等操作放进一个窗口。（@gentpan 投稿）

13、Burrow

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100603.webp)

面向小团队和自托管的轻量 OIDC 单点登录服务，使用密码和验证器登录，通过 OpenID Connect 接入支持该协议的应用。（@logic3579 投稿）

14、atv-core

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100604.webp)

让 iPhone 控制中心自带的 Apple TV 遥控器，可以直接操控 Android TV 和 Mac。iPhone 无需安装额外 App，也不需要购买 Apple TV。（@corvofeng 投稿）

15、open-compute

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100807.webp)

Cloudflare Workers 的开源兼容平台，让 worker 脚本不用修改就能跑在自己的机器上。（@elliothux 投稿）

16、Snitch

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100808.webp)

开源的实时网络流量可视化工具，查看你的电脑建立的每一个连接，什么程序正在与谁通信。（@aixisstudio 投稿）

17、EdgeChat

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100809.webp)

基于 Cloudflare 的开源自部署聊天系统，支持群聊与私信，可以与 Telegram 群组双向同步消息。（@aozorae 投稿）

18、DockTerm

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100601.webp)

让 Claude Code 的权限请求从 Mac 刘海里弹出，方便让其在后台工作。（@munvard 投稿）

### 资源

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026091902.webp)

手绘风格的 React SVG 图标库。（@guokaigdg 投稿）

2、阅古文

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026092001.webp)

免费的古籍阅读网站，不仅提供传统注释，还可以鼠标选中文本，进行 AI 解读。（@monsoonw 投稿）

3、艺术史步行之旅

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100812.webp)

这个网站将维基百科上面的画作，按照艺术流派，变成可以步行参观的 3D 画廊。

4、stillwet

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100510.webp)

这个网站提供 AI 生成的油画，它模仿人类的油画笔触，一笔笔绘制，非常逼真，根本看不出这是 AI 的作品。

### 图片

1、旧金山有轨电车

旧金山有很多古老的有轨电车，一直作为旅游项目在开行。

它们沿着太平洋海岸线开行，真的非常漂亮。下面都是今年拍摄的照片。

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026093013.webp)

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026093014.webp)

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026093015.webp)

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026093016.webp)

![](https://cdn.beekka.com/blogimg/asset/202609/bg2026093017.webp)

2、大公司的利润率

下图根据各大公司的年度报告，列出了它们每100美元的收入当中，有多少利润。

![](https://cdn.beekka.com/blogimg/asset/202610/bg2026100516.webp)

可以看到 IT 公司的利润率普遍非常高，最高的是英伟达，100美元收入可以获得55.6美元的利润，其次是微软36.1美元，第三是谷歌的32.8美元。

苹果公司的利润率26.9美元，只排名第五。但是，它是硬件公司，更新换代极快的 IT 制造业能有这样的利润率，其实更惊人。

### 言论

1、

致 AI 代理：去其他地方冲击高分吧，没必要黑我们。

-- Huggingface 的 security.txt 文件

2、

我的收入来自图书销售，2024年还足以维持我的生活，2026年却变为零。

我的博客和书籍都是免费在线阅读，它们的访问量增长迅猛，已经超出了我的承受能力。几乎所有流量都来自 AI 爬虫，所以没有任何广告收入。

因此，我决定将我的博客和书籍下线，以便决定下一步该怎么做。

-- Axel Rauschmayer，著名的技术作家，解释为什么将自己的网站下线

3、

我觉得，AI 个人助理用处不大。我一年也就点五次外卖，根本不需要它代劳，我平时也不怎么收到邮件，自己管理日程安排也挺方便的。

我真正觉得它好用的地方是，它可以自动收集和处理网上的大量数据。它能够快速扫描1000个 Youtube 频道，找到匹配我兴趣的视频。

4、

几乎所有人都夸大了中国模型对美国模型公司的威胁，其实那只是美国模型供不应求的结果。

5、

一个艺术家得了晚期癌症，即将死去。一位经常采访他的主持人问他：你现在对生死有什么新的理解吗？

他回答：你知道吗，吃三明治是一件多享受的事情。

我现在感觉生活更珍贵了，时刻提醒自己要珍惜每一份三明治，每一分钟，以及所有的一切。

-- 《尽情享用每一份三明治》

### 往年回顾

Nano Banana 的几个妙用（#367）

驴子、老虎和狮子的寓言（#317）

5G 的春天要来了（#267）

沙特的新未来城（#217）

（完）