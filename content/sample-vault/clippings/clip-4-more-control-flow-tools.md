---
category: clippings
date: '2026-10-16'
source: https://docs.python.org/3/tutorial/controlflow.html
summary: 本章介绍 Python 的控制流工具，涵盖 if、for、range、break/continue、循环 else、pass 与 match。
tags:
- 收藏
title: 4. More Control Flow Tools
---

# 4. More Control Flow Tools

> 来源：[https://docs.python.org/3/tutorial/controlflow.html](https://docs.python.org/3/tutorial/controlflow.html) · 收藏于 2026-10-16 · 本文由收藏管道自动整理

> 本章介绍 Python 的控制流工具，涵盖 if、for、range、break/continue、循环 else、pass 与 match。

## 一、条件与循环基础

- **if 语句**：可含零个或多个 elif，else 可选；elif 是 else if 的缩写，可避免过度缩进，并替代其他语言的 switch/case。
- **for 语句**：遍历任意序列（列表或字符串）的项，按出现顺序迭代，不同于 C 或 Pascal 的数值递进。
- **修改集合的陷阱**：迭代时修改同一集合易出错，通常改为遍历副本或新建集合。

## 二、range 与循环控制

- **range()**：生成算术级数，终点不包含在内；可指定起点与步长（含负步长）。
- **索引遍历**：可用 range() 与 len() 组合遍历序列索引，但多数情况更适合用 enumerate()。
- **range 对象**：行为类似列表但并非列表，迭代时才返回各项，从而节省空间，属于可迭代对象。
- **break 与 continue**：break 跳出最内层 for 或 while 循环；continue 进入下一次迭代。

## 三、循环 else 与 pass

- **循环 else 子句**：for 或 while 循环正常结束（未执行 break）时执行；被 break 终止则不执行，return 或异常同样会跳过。
- **else 归属**：循环的 else 属于循环而非其中的 if；其行为更接近 try 语句的 else（无异常时运行）。
- **pass 语句**：不做任何事，用于语法上需要语句但无需动作之处，如最小类、占位函数体；也可用省略号 ... 作占位。

## 四、match 语句

- **match 语句**：取一个表达式，将其值与一个或多个 case 块中的模式依次比较，表面上类似 C 的 switch 语句。

> [!tip] 一句话总结
> Python 控制流以 if/elif/else、序列遍历的 for、range()、break/continue、循环 else、pass 与 match 为核心工具。

## 原文 PDF

本文的 AI 摘抄自以下文档；PDF 是收藏时留存的原文全文，原链接失效也能看：

- 《4. More Control Flow Tools》· 27383 字 · [打开原文 PDF](/api/clippings/pdf?url=https%3A//docs.python.org/3/tutorial/controlflow.html)