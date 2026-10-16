---
category: clippings
date: '2026-10-16'
source: https://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html
summary: 本期介绍 Jev 决策模型及其应用，并涵盖 Markdown 源码化、RSA 破解新纪录、工具与言论等科技动态。
tags:
- 收藏
title: 科技爱好者周刊（第 414 期）：Jev 决策模型有什么用
---

# 科技爱好者周刊（第 414 期）：Jev 决策模型有什么用

> 来源：[https://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html](https://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html) · 收藏于 2026-10-16 · 本文由收藏管道自动整理

> 本期介绍 Jev 决策模型及其应用，并涵盖 Markdown 源码化、RSA 破解新纪录、工具与言论等科技动态。

## 一、Jev 决策模型

- **返回概率**：Jev 模型不返回文字，而是返回一个浮点数表示概率，可处理是非题与选择题。
- **评分功能**：给定评分标准与原始材料，Jev 可自动打分，用于评估网页内容质量。
- **语义查找**：浏览器插件用 Jev 逐段判断段落与搜索词的相关度，实现 Ctrl+F 的语义化改造。
- **黑箱担忧**：西蒙·威利斯指出 Jev 是走向黑箱系统的倒退，只给浮点数而不解释来源，担忧被用于给求职者排名。

## 二、Markdown 正在变成源码

- **纯文本优势**：Markdown 差异比较、搜索、审查容易，AI 可像母语一样读写，人类无需工具即可编辑。
- **随源码提交**：既然代码由 Markdown 提示词生成，提示词就应与源码一起提交到 `/src` 目录。
- **已成事实**：Markdown 已作为 AGENTS.md 文件成为源码的一部分，需习惯文档也是源码。

## 三、其他科技动态

- **不能摄像的摄像头**：苹果将发布一款智能家居摄像头，不录制视频，完全依靠 AI 分析环境并报告文字描述。
- **RSA 破解新纪录**：Anthropic 工程师借助 Claude 将 CADO-NFS 移植到 GPU，在 2048 个 GPU 上运行 10 天，破解了 896 位 RSA 密钥，建议密钥最少 2048 位。
- **AI 重写 Adobe**：有人让 AI 用 Rust 重写 Adobe 套件，7 个主力产品全部开源，界面与 PhotoShop 几乎一致。

> [!tip] 一句话总结
> Jev 决策模型以返回概率的方式让 AI 输出可量化结果，使许多原本无法数字化处理的问题变得可用计算机处理，同时也引发黑箱与滥用的担忧。

## 原文 PDF

本文的 AI 摘抄自以下文档；PDF 是收藏时留存的原文全文，原链接失效也能看：

- 《科技爱好者周刊（第 414 期）：Jev 决策模型有什么用》· 4837 字 · [打开原文 PDF](/api/clippings/pdf?url=https%3A//www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html)