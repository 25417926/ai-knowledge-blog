---
title: 从 SubAgent 到 Agent Teams
category: Agent
tags: [Agent, 多智能体, 协作, 架构]
date: 2026-09-27
summary: SubAgent 是星型拓扑，所有信息必须经主 Agent 中转，任务一复杂它就成了瓶颈。Agent Teams 换网状结构，代价是协调复杂度。
---

# 从 SubAgent 到 Agent Teams

## SubAgent 够用了吗？

前两章我们给 MewCode 装上了两个重要能力。SubAgent 章节让主 Agent 可以把任务委派给子 Agent，在独立上下文中执行。Worktree 章节提供了文件隔离能力，需要时可以给子 Agent 分配独立的工作目录，避免并行修改的冲突。

这套组合在很多场景下工作得很好。你说「帮我做个安全审查」，主 Agent 派一个 `Explore` 去扫描代码，拿到结果，汇报给你。整个过程是线性的：派出去，等结果，拿回来。

但有些场景不是这样的。

想象你正在做一个大规模重构。涉及四个模块，每个模块的改动量都不小。你让主 Agent 开始工作，它派了一个子 Agent 去改模块 A。改完了，返回结果。主 Agent 再派一个子 Agent 去改模块 B。改完了，又回来。然后 C，然后 D。

四个模块串行改完，花了 20 分钟。

但仔细想想，模块 A 和模块 B 的改动互不依赖。C 依赖 A 的结果，D 依赖 B 的结果。如果 A 和 B 能同时开工，C 在 A 完成后立刻开始，D 在 B 完成后立刻开始，总时间可以缩短将近一半。

![图 1](/notes/agent-多智能体协作/01.webp)

更复杂的场景：你让 Agent 帮你调查一个诡异的 bug。一个 Agent 在查日志，另一个在读代码，第三个在检查配置文件。查日志的 Agent 发现了一条可疑记录，它需要告诉读代码的 Agent：「你去看一下 `handler.go` 的第 47 行，那里有个条件判断可能是问题根源。」

在 SubAgent 模型里，这种 Agent 之间的横向通信做不到。每个子 Agent 只能和主 Agent 通信，把结果返回去，子 Agent 之间是看不见彼此的。所有信息必须经过主 Agent 中转，主 Agent 成了瓶颈。

这就像一个团队里所有人只能跟经理汇报，同事之间不能直接说话。小团队可以这样运作，但任务一复杂、人一多，经理就成了信息中转站，效率直线下降。

![图 2](/notes/agent-多智能体协作/02.webp)

我们需要的是一种新模式：多个 Agent 组成一个团队，能并行工作，能直接交流，能自主协调谁做什么。

---

## 从 SubAgent 到 Agent Team：关键区别

先把这两种模式的区别说清楚。

SubAgent 是「星型」拓扑。主 Agent 在中心，子 Agent 在周围。所有通信都经过主 Agent。子 Agent 完成任务后，结果回到主 Agent 的上下文里。子 Agent 之间没有任何通道。

Agent Team 接近「网状」结构，每个队员有自己的上下文窗口，可以直接给其他队员发消息，不必绕回 Lead 中转。不过这里要先说清楚一个细节，所谓「直接发消息」并不是网络层面的实时直连，底层走的是共享文件邮箱加轮询，进程内的队员每 500 毫秒扫一次收件箱，开在独立窗格里的队员间隔更长一些。换句话说，队员之间可以直接寻址，但通信本质上是异步的。共享任务列表加这套异步邮箱，就是 Team 的协调底座。

![图 3](/notes/agent-多智能体协作/03.webp)

两种模式各有适用场景。SubAgent 适合明确的、一次性的子任务。「帮我查一下这个函数的调用方」「帮我写一下这个测试」。任务边界清晰，不需要中间交流，做完拿结果就行。

Agent Team 适合需要协作的、持续性的工作。「重构这四个模块」「从三个角度分析这个 bug」「同时做 UX 评审和架构评审」。任务之间有依赖或需要信息共享，Agent 之间需要直接沟通。

---

讲到这里你可能想：业界已经有 AutoGen、CrewAI、LangGraph 这些多 Agent 框架，MewCode 的 Team 模型和它们什么关系？大方向上是「去中心化协调」和「中心化编排」的差别。AutoGen 的 GroupChat 由一个调度者按规则决定谁说话，CrewAI 用一个 Crew 对象编排任务流转，LangGraph 干脆把多 Agent 协作直接写成状态机。这几条路线都把「谁在什么时候做什么」的决策权集中在框架里。MewCode 走的是另一条路，协调能力以工具的形式注入到每个队员的工具集，谁做什么由 LLM 自己看共享任务列表和消息判断。框架不裁判，只提供基础设施。代价是行为可预测性弱一些；收益是新增协作模式只需要加工具，不用动调度器。这一点在后面讲协调机制和 Coordinator Mode 时会反复看到。

---

## Team 的核心结构

想想你组建一个项目小组需要什么。得有个组名，得知道谁是负责人，得有个花名册记录每个人的角色和状态。Agent Team 的数据结构就是这三样东西的直接映射：

```plain text

```

花名册里每个队员长这样：

```plain text

```

我们重点看这几个字段。

`backendType` 决定队员在哪里运行。 `"tmux"` 和 `"iterm2"` 意味着队员在独立的终端 pane 里作为单独进程运行，和 Lead 完全隔离。 `"in-process"` 意味着队员和 Lead 跑在同一个进程内，更轻量但隔离性弱。三种后端的细节在后面「三种执行后端」一节展开。

这里要注意的是， `backendType` 是 member 级别的。同一个团队里，队员 alice 可以跑在独立进程中，队员 bob 可以跑在主进程内。后端选择是每个队员独立决定的。

你可能觉得 `isActive` 应该是一个 `"active" | "idle" | "terminated"` 三值枚举？实际上它只是一个可选 boolean。 `undefined` 或 `true` 表示活跃， `false` 表示空闲。没有 `"terminated"` 状态，队员终止后直接从 members 列表移除，不留墓碑。

列表里有的就是活的或暂停的，没有的就是不存在的，清理逻辑因此变得很简洁。

`worktreePath` 是可选字段。Lead 在 spawn 队员时可以通过 `isolation: "worktree"` 让队员获得独立的 Git Worktree，文件系统完全隔离。不指定时队员和 Lead 共享工作目录。

`planModeRequired` 让 Lead 可以给特定队员加一道审批门槛：这个队员在执行任何修改操作前，必须先提交计划给 Lead 审批通过才能动手。适合风险较高的修改任务。

Team Lead 就是当前主 Agent 本身，它在创建团队后自动承担 Lead 的角色。当你对 MewCode 说「创建一个团队来做这件事」，主 Agent 就变成了 Team Lead。它负责创建团队、派生队员、分解任务、协调进度。

队员是真正干活的。每个队员是一个独立的 Agent 实例，有自己的上下文窗口和工作环境。队员可以是定义式的，从预定义的 Agent 角色创建；也可以是 Fork 式的，直接继承 Lead 的配置。

团队配置持久化到 `~/.mewcode/teams/{name}/config.json` ，每个团队一个目录。

SubAgent 章节的 Agent 工具用一个统一的 Tool 接口实现了子 Agent 的创建和运行。到了团队模式，复杂度上升了一个台阶。团队本身有创建、运行、清理的生命周期，队员的 spawn 需要关联到特定团队，Lead 还需要在团队存续期间进入特殊的协调模式。

如果把这些逻辑全塞进 Agent 工具的参数分支里，这个工具的职责就太重了。

所以团队模式引入了 **独立的顶层工具**。 `TeamCreate` 负责创建团队， `Agent` 工具的 `team_name` 参数负责往已有团队里 spawn 队员。两者配合，职责清晰：

```plain text
// 第一步：创建团队，用 TeamCreate 工具
TeamCreate(team_name="refactor-auth", description="重构认证模块")

// 第二步：spawn 队员
Agent(subagent_type="worker", team_name="refactor-auth", name="alice", prompt="重构数据层")
Agent(subagent_type="worker", team_name="refactor-auth", name="bob", prompt="重构服务层")
```

`TeamCreate` 的参数只有两个， `team_name` 必填， `description` 可选，用来说明这个团队要干什么。如果同名团队已存在，系统自动在名称后追加序号避免冲突。

`TeamCreate` 做的事情不多：检测执行后端、创建 config.json 配置文件 、初始化共享任务列表、把 Lead 注册进团队。但它作为一个独立工具存在，是因为团队的创建是一个有明确边界的操作，它会改变 Lead 的运行模式，不应该作为 Agent 工具的副作用偷偷发生。

对应的还有一个 `TeamDelete` 工具，负责团队的清理和销毁。

---

## 三种执行后端

在聊协调机制之前，先要解决一个更基础的问题：队员在哪里运行？

MewCode 支持三种执行后端，对应 `BackendType` 的三个取值： `tmux` 、 `iterm2` 、 `in-process` 。系统按优先级自动检测选择。Tmux 和 iTerm2 是 Pane 后端，每个队员在独立进程中运行。In-process 是进程内后端，所有队员共享同一个进程。

### Tmux 后端

如果你本来就在 tmux 会话里启动 MewCode，每个队员就在独立的 tmux pane 中运行。每个 pane 里是一个完整的 MewCode CLI 实例，拥有自己的进程、内存空间和配置。

```plain text
function spawnTmuxTeammate(team, name, config):
    // 1. 创建新的 tmux pane
    paneID = tmux.splitWindow(team.name + "-" + name)
```

Tmux 后端的好处是完全隔离。每个队员是独立进程，一个崩溃不影响其他，生命周期不依赖 Lead。

不过独立进程也意味着队员的工具集是在 worker 入口里单独搭的，而不是从 Lead 那边继承过来。搭出来的清单按队员该有的能力对齐，干活的文件和命令工具之外，还有工具检索、Worktree 切换、Skill 和 MCP 这些通用能力，再加上团队协作要用的 `SendMessage` 和共享任务板。

**队员没有****`Agent`**  **工具，所以它既不能 spawn 子 Agent，也不能往团队里加人。**这不是把 `team_name` 参数屏蔽掉，而是整个工具压根不在队员的工具集里，从源头上就没有这条路。往团队里加人始终是 Lead 的事，跟 Coordinator Mode 开没开没有关系，Lead 在普通模式下同样能派新队员。

### iTerm2 后端

macOS 用户如果在 iTerm2 里启动 MewCode，系统会用 iTerm2 原生 pane 作为后端，通过 osascript 驱动 AppleScript 新建标签页跑一个完整 CLI 实例。和 Tmux 一样，每个队员在独立的 iTerm2 pane 中运行，拥有自己的进程和内存空间。

隔离特性与 Tmux 后端一致：独立进程、同一份工具集、生命周期不依赖 Lead。区别只在于底层的终端多路复用实现。

### In-process 后端

如果当前既不在 tmux 会话里也不在 iTerm2 里，那 MewCode 就会自动落到 in-process 后端。队员在同一个进程内运行，通过 `startInProcessTeammate()` 启动，共享进程但拥有独立的工具池和消息邮箱。

```plain text

```

In-process 后端更轻量，启动快，不依赖外部工具。但限制也更多。队员的生命周期绑定在 Lead 身上，Lead 退出，所有 in-process 队员一起退出。

工具集这边的来路和 Pane 队员不同，它是从 Lead 的注册表复制一份再往下裁，所以 `ReadFile` 、 `Bash` 、 `EditFile` 这些干活的工具全都在。裁掉的是那批不该给任何子 Agent 的， `Agent` 在裁掉之列，建团队和删团队这两个也一样，所以 in-process 队员同样不能 spawn 子 Agent、也不能加人，这一点和 Pane 队员没有区别。

那系统具体怎么选后端，就看当前进程是不是已经身处一个终端复用器会话里，先看在不在 tmux 会话里，tmux 会给会话内的进程自动设一个环境变量，在就直接用 tmux，不在就看在不在 iTerm2 里，在就用 iTerm2 原生 pane，两者都不在就落到 in-process。

换句话说 in-process 是兜底选项，只有你本来就在 tmux 或 iTerm2 会话里启动 MewCode，队员才会开在独立窗格里，普通终端会直接走进程内，这跟本地有没有装 tmux 无关，装了但没进会话同样是进程内。

所以想让队员开在独立窗格里，办法是先进一个 tmux 会话或 iTerm2 再在里面启动 MewCode，而不是光把 tmux 装上，至于 Windows 因为没有这类会话环境，稳定走进程内。

## 相关

- [[agent-上下文预算|上下文预算：Agent 为什么越跑越慢]] —— 每个队员都有自己的窗口，预算要分开算
- [[agent-mcp-协议|MCP：把工具从内置做成生态]] —— 共享工具是团队协作的前提

> 整理自 MewCode Agent 第 15 章的课程笔记，仅作个人学习记录。
