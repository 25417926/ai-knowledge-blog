---
title: 一次线上 OOM 的排查记录
slug: 一次线上OOM的排查记录
date: 2026-08-12
mood: calm
tags: [Java, JVM, 排查]
excerpt: 从告警到定位，花了两个小时，最后是一行缓存的事。
---

凌晨收到的告警：服务在半小时内重启了三次。记录一下过程。

## 第一步：先看是不是内存真不够

`jstat -gcutil` 看了下，老年代十分钟就满了，Full GC 之后几乎没释放。**不是不够，是泄漏。**

## 第二步：拿堆快照

```bash
jmap -dump:live,format=b,file=heap.hprof <pid>
```

用 MAT 打开，按 Retained Heap 排序，第一名是一个 `ConcurrentHashMap`，占了 60% 的堆。

## 第三步：找到是谁在往里塞

看引用链，是我们自己写的一个「本地缓存」，key 是用户 ID，**没有过期也没有上限**。

```java
private static final Map<Long, UserProfile> CACHE = new ConcurrentHashMap<>();
```

写的时候想的是「读多写少，先缓存着」。上线三个月，用户量翻了几倍。

## 结论

1. 手写本地缓存的第一个问题永远是：**它不会自己清理**。
2. 要么用 `Caffeine` 带上限和过期，要么别缓存。
3. 告警里的「重启」是结果，不是原因——别一上来就加内存。

改动只有一行：换成 `Caffeine.newBuilder().maximumSize(10_000).expireAfterWrite(Duration.ofMinutes(10)).build()`。
