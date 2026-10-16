---
category: clippings
date: '2026-10-16'
source: https://docs.python.org/3/tutorial/controlflow.html
summary: 本章介绍 Python 的更多控制流工具，涵盖 if、for、range、break/continue、循环 else、pass 与 match。
tags:
- 收藏
title: 4. More Control Flow Tools
---

# 4. More Control Flow Tools

> 来源：[https://docs.python.org/3/tutorial/controlflow.html](https://docs.python.org/3/tutorial/controlflow.html) · 收藏于 2026-10-16 · 本文由收藏管道自动整理

> 本章介绍 Python 的更多控制流工具，涵盖 if、for、range、break/continue、循环 else、pass 与 match。

## 一、条件与循环基础

- **if 语句**：可含零个或多个 `elif`，`else` 可选；`elif` 是 else if 的缩写，用于避免过度缩进，可替代其他语言的 switch/case。
- **for 语句**：遍历任意序列（列表或字符串）的项，按出现顺序迭代，而非算术递进。
- **迭代时修改集合**：遍历同一集合时修改易出错，通常改为遍历副本或新建集合。

## 二、range 与循环控制

- **range()**：生成算术级数，终点不包含在序列内；可指定起点与步长（含负步长）。
- **遍历索引**：可组合 `range()` 与 `len()`，但多数情况用 `enumerate()` 更方便。
- **range 对象**：行为类似列表但并非列表，迭代时逐个返回项而不真正生成列表，节省空间，属于可迭代对象。
- **break 与 continue**：`break` 跳出最内层 for/while 循环；`continue` 进入下一次迭代。

## 三、循环 else、pass 与 match

- **循环 else 子句**：for/while 循环正常结束（未执行 break）时执行；被 break 终止则不执行，其他提前结束方式（return、异常）也会跳过。
- **else 的语义**：与 try 语句的 else 更相似——无异常则运行，循环 else 则是无 break 则运行。
- **pass 语句**：不做任何事，用于语法上需要语句但无需动作之处，如最小类、占位函数体；占位也常用省略号 `...`。
- **match 语句**：取一个表达式，将其值与一个或多个 case 块中的模式依次比较，表面类似 C 的 switch。

> 循环的 else 子句在循环未被 break 终止时执行，这是 Python 中容易被忽视却很有用的特性。

## 原文 PDF

本文的 AI 摘抄自以下文档；PDF 是收藏时留存的原文全文，原链接失效也能看：

- 《4. More Control Flow Tools》· 27383 字 · [打开原文 PDF](/api/clippings/pdf?url=https%3A//docs.python.org/3/tutorial/controlflow.html)