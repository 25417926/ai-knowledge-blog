---
category: clippings
date: '2026-10-15'
source: https://docs.python.org/3/tutorial/controlflow.html
summary: 介绍 Python 的控制流工具，包括 if、for、range、break/continue、循环 else、pass 和 match 语句。
tags:
- 收藏
title: 4. More Control Flow Tools
---

# 4. More Control Flow Tools

> 来源：[https://docs.python.org/3/tutorial/controlflow.html](https://docs.python.org/3/tutorial/controlflow.html) · 收藏于 2026-10-15 · 本文由收藏管道自动整理

## 三段式总结

### 是什么
介绍 Python 的控制流工具，包括 if、for、range、break/continue、循环 else、pass 和 match 语句。

### 核心观点
- `if` 语句支持零个或多个 `elif` 及可选的 `else`，可替代其他语言的 switch/case。
- Python 的 `for` 语句遍历任意序列的项，而非仅遍历数字等差数列；遍历时修改集合应改为遍历副本或创建新集合。
- `range()` 生成等差数列，终点不包含在内，可指定起点和步长；它返回可迭代对象而非列表，以节省空间。
- `break` 跳出最内层循环，`continue` 进入下一次迭代；循环的 `else` 子句仅在循环未被 `break` 终止时执行。
- `pass` 语句不做任何事，可用于语法需要但无需操作的占位；`match` 语句将表达式值与模式比较，表面类似 C 的 switch。

### 对我的启发
学习 Python 控制流时，应重点理解 `for` 遍历序列、`range()` 惰性生成、循环 `else` 与 `break` 的配对关系，这些概念有助于编写更简洁、高效的代码，也能与 Java 的循环和 switch 形成对比。

## 原文 PDF

本文的 AI 总结自以下文档；PDF 是收藏时留存的原文全文，原链接失效也能看：

- 《4. More Control Flow Tools》· 27383 字 · [打开原文 PDF](/api/clippings/pdf?url=https%3A//docs.python.org/3/tutorial/controlflow.html)