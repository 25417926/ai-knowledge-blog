---
title: JUC 线程池核心参数
category: Java
tags: [Java, 并发, 线程池, JUC]
date: 2026-09-05
summary: 从 corePoolSize 到拒绝策略，把七个参数讲成一条任务在池中的完整生命周期。
---

# JUC 线程池核心参数

`ThreadPoolExecutor` 的七个构造参数如果只背结论，遇到线上问题一定会卡住。把它们串成一条任务的生命周期就清楚多了。

## 一条任务的完整路径

1. 核心线程未满 → 直接新建核心线程执行。
2. 核心线程已满 → 任务进阻塞队列排队。
3. 队列已满 → 新建非核心线程，直到达到 `maximumPoolSize`。
4. 连最大线程数也满了 → 触发拒绝策略。

注意第 2 步和第 3 步的**顺序反直觉**：线程池是先排队、再扩容，而不是先扩容。这解释了为什么用无界队列（如 `LinkedBlockingQueue` 不传容量）时 `maximumPoolSize` 永远用不上。

## 参数怎么定

| 参数 | 经验取值 | 说明 |
|---|---|---|
| corePoolSize | CPU 核数 ± 1 | CPU 密集型 |
| maximumPoolSize | 2 × CPU 核数 | IO 密集型可更高 |
| keepAliveTime | 60s | 非核心线程回收 |
| workQueue | 有界队列 | 禁止无界，避免问题被掩盖 |
| handler | CallerRunsPolicy | 让调用方降速，形成反压 |

按上表落成一个能直接用的构造：

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    4,                              // corePoolSize：CPU 密集型取核数 ±1
    8,                              // maximumPoolSize：IO 密集型可放宽到 2×核数
    60L, TimeUnit.SECONDS,          // 非核心线程空闲 60s 后回收
    new ArrayBlockingQueue<>(200),  // 有界队列，容量见下
    Executors.defaultThreadFactory(),
    new ThreadPoolExecutor.CallerRunsPolicy()  // 满了让调用方自己跑，天然限流
);
```

队列容量别拍脑袋，它的含义是「最多容忍多少任务积压」——按峰值 QPS 乘以可接受的排队延迟估。
估不准就先设小一点，让拒绝策略早一点暴露出来，比默默堆在队列里直到 OOM 好。

## 拒绝策略怎么选

- `AbortPolicy`：默认，抛异常。核心链路不希望静默丢任务时用。
- `CallerRunsPolicy`：由提交任务的线程自己执行，天然限流。
- `DiscardPolicy`：静默丢弃，只在日志类任务上可接受。

## 与并发地图的关系

线程池只是并发的一条主线，锁与内存模型的坑更隐蔽，回到 [[Java 并发编程知识地图]] 看全景。

延伸阅读：[[JVM 内存结构与垃圾回收]]
