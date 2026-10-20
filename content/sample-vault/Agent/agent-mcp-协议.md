---
title: MCP：把工具从内置做成生态
category: Agent
tags: [Agent, MCP, 工具系统, 协议]
date: 2026-09-27
summary: 工具供给和 Agent 内核耦合，是扩展性的天花板：加一个工具要改代码、重编译、发版。MCP 用 USB 式的统一接口把 M×N 降到 M+N。
---

# MCP：把工具从内置做成生态

## 你迟早会遇到这个问题

前一篇给 MewCode 装上了安全刹车，现在工具可以放心用了。但工具系统本身有一个扩展性瓶颈。

如果用户想让 MewCode 帮忙查一下 GitHub 上的 Issue 呢？

你得写一个 GitHubIssueTool，实现 Tool 接口，调 GitHub API，处理 OAuth 认证、分页、rate limit、各种错误码。好不容易搞定了，用户又来了：「能不能查询阿里云SLS日志」「能不能操作 MySQL 数据库？」「能不能发 Slack 消息通知团队？」

每个需求都是同一个流程：写代码，实现接口，处理第三方 API 的认证和错误格式，注册到 ToolRegistry，重新编译，发布新版本。MewCode 的代码库越来越胖，但你永远追不上用户的需求。一个人想要 GitHub 集成，另一个想要 GitLab，第三个想要 Bitbucket。你不可能把全世界的 API 都实现一遍。

问题出在哪？

出在 **工具的供给和 Agent 的核心是耦合的**。Agent 想用新工具，必须由 Agent 的开发者来写代码、编译、发布。第三方开发者没有办法独立地给 MewCode 添加工具。

![图 1](/notes/agent-mcp-协议/01.webp)

换个角度想：有没有一种方式，让别人独立开发工具，MewCode 动态地接入这些工具，不需要改一行代码，不需要重新编译？

有。这就是 MCP。

---

## USB 的故事

MCP（Model Context Protocol）是一个开放协议，定义了 AI 应用如何和外部能力进行标准化通信。

光看名字可能觉得很抽象。我们用一个你一定熟悉的东西来类比：USB。

回忆一下 USB 出现之前的世界。键盘用 PS/2 接口，打印机用并口，鼠标用串口，扫描仪用 SCSI，每种外设都有自己专用的接口和驱动。你买了一台新电脑，光是接线就能让人头疼半天。更麻烦的是，假设有 M 种电脑接口和 N 种外设，总共需要 M x N 个适配器。这个数字增长得很恐怖。

USB 出现后呢？所有外设统一用一个接口。键盘插 USB，鼠标插 USB，打印机也插 USB。电脑厂商只需要支持 USB 标准，外设厂商也只需要支持 USB 标准。M + N 就搞定了。

![图 2](/notes/agent-mcp-协议/02.webp)

MCP 做的是同样的事情。在 MCP 之前，每个 Agent 想接入每个工具，都需要写专门的对接代码：

```plain text
之前：M x N 对接

Agent A ──专用代码──→ GitHub Tool
Agent A ──专用代码──→ MySQL Tool
Agent B ──专用代码──→ GitHub Tool
Agent B ──专用代码──→ MySQL Tool
```

有了 MCP 之后，Agent 只需要实现一次 MCP 客户端，工具只需要实现一次 MCP 服务端，双方就能通信：

```plain text

```

对 MewCode 来说，我们只需要实现一次 MCP Client。社区里有人写了 GitHub 的 MCP Server？直接接进来。有人写了数据库的 MCP Server？也直接接进来。不需要改 MewCode 的任何代码。

这就是标准化协议的威力。

---

## MCP 到底由哪些部分构成

很多文章一讲 MCP，就直接开始列 Tools、Resources、Prompts。但如果你只记住这三个词，很容易产生一个误解：MCP 好像只是「Server 提供几个接口给 Agent 调用」。这不完整。

MCP 至少要从两个角度看： **运行时角色**和 **协议层次**。

先看运行时角色。官方文档把 MCP 的参与者拆成三个：

- **Host**：真正的 AI 应用本体。比如 Claude Desktop、Codex、IDE 插件，或者我们正在构建的 MewCode。

- **Client**：Host 里的一个连接组件。它负责和某一个 MCP Server 建立连接、发送请求、接收响应。

- **Server**：对外暴露能力的程序。它可能运行在本地，也可能运行在远程。

注意这里有个非常容易混淆的点： **MewCode 本身是 Host，不是 Client**。更准确地说，MewCode 这个 Host 内部会创建一个或多个 MCP Client，每个 Client 对应一个 Server。

```plain text

```

为什么要这样拆？因为一个 Host 往往要同时连多个 Server。每个连接都有自己的能力协商、生命周期、请求 ID、连接状态。把它们都塞进一个大而全的对象里会很混乱。拆成一个 Host 管多个 Client，结构就清楚了。

再看协议层次。MCP 可以理解成两层：

- **Data Layer（数据层）**：定义消息长什么样、初始化怎么握手、有哪些能力、怎么列工具、怎么调工具。这里的核心是 JSON-RPC 2.0（ 规定“请求和响应写成什么 JSON 格式”，RPC = Remote Procedure Call，中文一般叫：**远程过程调用**），加上 lifecycle、tools/resources/prompts/notifications 这些语义。

- **Transport Layer（传输层）**：定义消息怎么在两边之间传过去。是走 `stdio` ，还是走 `Streamable HTTP` ，属于这一层。

你可以把它想成「信件内容」和「送信方式」的区别。Data Layer 规定信里写什么、格式是什么；Transport Layer 决定是快递送，还是自己跑腿送。内容不变，运输方式可以换。

这一章我们实现的是 MewCode 里的 **MCP Client**，重点放在两件事：

1. 理解 Data Layer：握手、工具发现、工具调用。

1. 理解 Transport Layer 如何按 server 类型选择不同接法，并先用 `stdio` 把主流程讲透。

---

## MCP 里双方各提供什么

MCP 最常被提到的是 Server 暴露的三种核心原语（primitives），也就是前面说的 **Tools、Resources、Prompts**。但如果只讲 Server 这一侧，学生很容易误以为 MCP 是单向的。实际上，Client 这一侧也有自己的能力声明。

先看 Server 这一侧。

第一种是 **Tools**，也是最核心的能力。一个 MCP Server 可以暴露一组工具，每个工具有名称、描述和参数的 JSON Schema 定义。比如一个 GitHub MCP Server 可能提供 `search_issues` 、 `create_issue` 、 `list_pull_requests` 这些工具。

```json

```

看着眼熟吗？这和我们之前实现的 Tool 接口定义几乎一模一样。名称、描述、参数 Schema，结构完全对得上。唯一的区别是：我们的工具在 MewCode 进程内执行，MCP 的工具在一个外部进程里执行。

第二种是 **Resources**，可以理解为可读取的数据源。比如一个数据库 MCP Server 可以暴露表结构作为 Resource，Agent 读取它就能了解有哪些表、哪些字段，不用自己去猜：

```json
{
  "uri": "db://myapp/schema",
  "name": "数据库表结构",
```

Agent 通过 `resources/read` 请求这个 URI，Server 就会返回对应的数据。这有点像 RAG 里的上下文源，用来给 Agent 补充背景信息。

第三种是 **Prompts**，是 MCP Server 提供的预定义提示词模板。比如一个 SQL MCP Server 可以提供一个引导 Agent 按正确格式生成查询的 Prompt：

```json

```

Agent 调用这个 Prompt 时传入参数，Server 返回一段组装好的提示词文本，Agent 拿着这段文本去生成 SQL。这和后面要做的 Skill 系统有异曲同工之处，只不过 Prompt 是由工具提供方定义的，而不是用户自己定义的。

再看 Client 这一侧。MCP 规范里，Client 也可以声明自己支持什么能力。比如：

- **Roots**：告诉 Server 当前项目的根目录或工作区边界。

- **Sampling**：允许 Server 反过来请求 Host 帮它调用 LLM。

- **Elicitation**：允许 Server 请求 Host 向用户追问额外信息。

这说明 MCP 不是一个“Server 只会被动挨打”的协议。它本质上是一个双向的、带能力协商的连接。只是对我们这一章来说，最有教学价值的仍然是 Server 暴露的 **Tools**。

为什么？因为 Tools 最直接对应到 Coding Agent 的”手”。Agent 想查 Issue、查数据库、操作浏览器，最后都落在”调用一个外部能力”这件事上。

所以这篇的聚焦顺序是：

1. 先把 `Tools` 跑通。

1. 建立对 `Resources` 和 `Prompts` 的概念理解。

1. 知道 `Roots / Sampling / Elicitation` 这些 Client 能力存在，但不在这篇展开实现。

---

## 传输层：stdio 和 Streamable HTTP

MCP 的 Data Layer 规定了消息语义，但消息总得有个地方传。这个“怎么传”，就是 Transport Layer 的职责。

截至 `2025-11-25` 版规范，MCP 当前定义的 **标准传输只有两种**：

1. `stdio`

1. `Streamable HTTP`

这里有一个特别容易踩坑的历史问题：你在很多旧资料里会看到 `HTTP+SSE` 、 `SSE transport` 这样的说法。那是旧版本协议里的表述。 **在新规范里，HTTP+SSE 已经被 Streamable HTTP 取代了。**SSE 在新规范里已经降级为 `Streamable HTTP` 内部可选的流式机制，不再作为独立的标准传输存在。

那 WebSocket 呢？规范允许实现自定义 transport，但 **WebSocket 不是当前标准传输的一部分**。所以讲课时不要把它和 `stdio` 、 `Streamable HTTP` 并列成“官方标准的三四种传输”。

这两个标准传输的区别在于 **Host 和 Server 进程之间怎么通信**：

- **stdio**：Host 把 MCP Server 作为子进程启动，通过 stdin/stdout 管道读写消息。Server 本身可以访问任何远程服务，比如 GitHub API、数据库、云平台，管道只管 Host 和 Server 之间那一段通信。

- **Streamable HTTP**：MCP Server 是一个独立运行的 HTTP 服务，Host 用 HTTP `POST` / `GET` 和它通信，必要时用 SSE 做流式消息。Server 可能在本机，也可能在远端。

注意 stdio 并不意味着「只能做本地的事」。GitHub MCP Server 就是用 stdio 启动的，但它背后调的全是 GitHub 的远程 API。stdio 描述的是 Host 到 Server 的通信方式，跟 Server 自己访问什么资源无关。

真实产品里，这两种通常都要支持。官方 SDK 已经把这层接线封装得比较完整了，所以工程上真正要注意的就一点： **别把 transport 选择和后面的 MCP 主流程耦死**。

换句话说，如果你直接使用 MCP SDK，接 `stdio` server 和接 `Streamable HTTP` server，最大的区别通常只是”构造不同的 transport 对象”；后面的 `connect` 、能力协商、 `tools/list` 、 `tools/call` ，走的还是同一套 Client 流程。

---

## stdio 传输：没有网络，没有端口

在 Coding Agent 这个场景下， `stdio` 依然非常值得先讲，因为它最适合第一次把 MCP Client 的骨架讲清楚。产品里 HTTP 同样重要，但 stdio 没有网络、认证、部署这些额外复杂度，能让你专注于协议本身。

stdio 传输是怎么工作的？非常简单：MewCode 启动一个子进程来运行 MCP Server，然后通过这个子进程的 stdin 和 stdout 管道来通信。MewCode 往子进程的 stdin 写请求，从子进程的 stdout 读响应。就这样。

```plain text
MewCode 进程
    │
    ├── 持有 Pipe 的写端 ──写入请求──→  MCP Server 子进程的 stdin
    │                              │
    │                              ▼
    │                        MCP Server 处理请求
    │                              │
    └── 持有 Pipe 的读端 ←──读取响应──  MCP Server 子进程的 stdout
```

为什么说它巧妙？因为 **不需要网络，不需要端口，不需要服务发现**。

## 相关

- [[agent-system-prompt-设计|System Prompt 如何设计]] —— 工具怎么被选中，靠的是描述怎么写
- [[agent-多智能体协作|从 SubAgent 到 Agent Teams]] —— 工具生态铺开后，协作才成为瓶颈

> 整理自 MewCode Agent 第 7 章的课程笔记，仅作个人学习记录。
