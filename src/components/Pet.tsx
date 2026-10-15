'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { site } from '@/lib/site';

// 键名沿用 cat-*：改名会让老访客存过的「宠物位置 / 鱼干冷却」一起丢掉，不值当
const POS_KEY = 'town:cat-pos';
const FED_KEY = 'town:cat-fed-at';
/** 喂食冷却：纯前端限制，目的是让它像个活物而不是按钮 */
const COOLDOWN_SECONDS = 30;
/** 多久没人理就开始打盹 */
const DOZE_MS = 30_000;
const DRAG_THRESHOLD = 5;
/** 宠物显示高度（px）：拖拽吸附时按这个给边缘留位 */
const PET_H = 80;
/** 边缘留白上限。宽高都按这个保守值算，免得算出屏 */
const EDGE = PET_H + 16;

/** 它自言自语的一句。宠物只有「它说」这一侧，不接问答，所以不用区分说话人 */
type Line = { id: number; text: string };
type Mood = 'idle' | 'smile' | 'sleepy' | 'happy-a' | 'happy-b';

/**
 * 五张表情各归其位。素材是一只鲸鱼娘的六个表情，落到状态上：
 *   待机 / 打开面板 / 打盹 / 喂食两帧（交替成小动画）
 * think.webp 留在 public/pets 里没被引用 —— 撤掉问答后就没有「思考中」这个状态了。
 * 换素材只要换这里的文件名，状态逻辑不用动。
 */
const FACES: Record<Mood, string> = {
  idle: '/pets/idle.webp',
  smile: '/pets/smile.webp',
  sleepy: '/pets/sleepy.webp',
  'happy-a': '/pets/happy-a.webp',
  'happy-b': '/pets/happy-b.webp',
};

/**
 * 桌宠「鱼干」。
 *
 * 它只负责陪伴：能拖走、点它开面板听它念叨、喂它鱼干、没人理就打盹。
 * **不接问答** —— 站内问答统一归右下的「知行」。宠物自己也挂一个输入框，
 * 只会把同一份会话、记忆和好感度搅在一起（曾经两边都在调 /api/ask 的
 * assistant 身份，等于两个入口共用一个人格）。
 * 位置与喂食时间都记在 localStorage —— 刷新之后它还在你放下的地方，鱼干也不会重新变满。
 */
export function Pet() {
  const [mounted, setMounted] = useState(false);
  // 默认落在左下角上方一点：右下角是博客助手，正左下角则是开发时的 Next 调试按钮
  const [pos, setPos] = useState({ x: 20, y: 88 });
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [hearts, setHearts] = useState<number[]>([]);
  const [cooldown, setCooldown] = useState(0);
  const [dozing, setDozing] = useState(false);
  const [flip, setFlip] = useState(false);
  /** 任何交互都 +1，用来重启打盹计时 */
  const [idleTick, setIdleTick] = useState(0);

  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 位置要等挂载后再读，否则服务端渲染出来的位置和客户端不一致
  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { x?: unknown; y?: unknown };
        if (typeof saved.x === 'number' && typeof saved.y === 'number') {
          setPos({ x: saved.x, y: saved.y });
        }
      }
    } catch {
      /* 读不到就用默认位置 */
    }
  }, []);

  // 其余表情等首屏稳下来再预热：首屏只拉待机那张，不让六张一起挤带宽
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const src of Object.values(FACES)) {
        if (src === FACES.idle) continue;
        const img = new Image();
        img.src = src;
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // 和 hearts 同时长：爱心粒子飞着的时候就是开心帧交替的时候
  const cheering = hearts.length > 0;
  useEffect(() => {
    if (!cheering) {
      setFlip(false);
      return;
    }
    const timer = setInterval(() => setFlip((value) => !value), 220);
    return () => clearInterval(timer);
  }, [cheering]);

  useEffect(() => {
    if (open) {
      setDozing(false);
      return;
    }
    const timer = setTimeout(() => setDozing(true), DOZE_MS);
    return () => clearTimeout(timer);
  }, [open, idleTick]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  const clamp = useCallback((x: number, y: number) => {
    const limitX = typeof window === 'undefined' ? x : window.innerWidth - EDGE;
    const limitY = typeof window === 'undefined' ? y : window.innerHeight - EDGE;
    return { x: Math.min(Math.max(8, x), Math.max(8, limitX)), y: Math.min(Math.max(8, y), Math.max(8, limitY)) };
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false,
    };
    setDozing(false);
    setIdleTick((value) => value + 1);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 纵向用 clientY 反向：屏幕往下拖，离底边的距离就变小
    const movedX = event.clientX - drag.startX;
    const movedY = drag.startY - event.clientY;
    if (Math.abs(movedX) > DRAG_THRESHOLD || Math.abs(movedY) > DRAG_THRESHOLD) drag.moved = true;
    setPos(clamp(drag.originX + movedX, drag.originY + movedY));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        /* 存不住就算了 */
      }
      return;
    }
    // 没挪动 = 点击：开合对话
    setOpen((value) => !value);
  };

  const feed = () => {
    const now = Date.now();
    let last = 0;
    try {
      last = Number(localStorage.getItem(FED_KEY) ?? 0);
    } catch {
      last = 0;
    }
    const remain = COOLDOWN_SECONDS * 1000 - (now - last);
    if (remain > 0) {
      setCooldown(Math.ceil(remain / 1000));
      return;
    }
    try {
      localStorage.setItem(FED_KEY, String(now));
    } catch {
      /* 忽略 */
    }
    setCooldown(COOLDOWN_SECONDS);
    setIdleTick((value) => value + 1);

    // 喂它就是听它念叨一句 —— 宠物不接问答，所以「它说的话」只有这一种来源
    const line = site.pet.lines[Math.floor(Math.random() * site.pet.lines.length)];
    setLines((prev) => [...prev, { id: now, text: line }]);
    setHearts((prev) => [...prev, now]);
    setTimeout(() => setHearts((prev) => prev.filter((id) => id !== now)), 1500);
  };

  if (!mounted) return null;

  const mood: Mood = cheering
    ? flip
      ? 'happy-b'
      : 'happy-a'
    : dozing
      ? 'sleepy'
      : open
        ? 'smile'
        : 'idle';

  return (
    <>
      {/* 小鱼干爱心粒子 */}
      <div
        className="pointer-events-none fixed z-40"
        style={{ left: pos.x + 8, bottom: pos.y + PET_H }}
        aria-hidden
      >
        {hearts.map((id, i) => (
          <span
            key={id}
            className="absolute animate-float-up text-[15px]"
            style={{ left: i % 3 === 0 ? -10 : i % 3 === 1 ? 18 : 4 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#f0709a" aria-hidden>
              <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20z" />
            </svg>
          </span>
        ))}
      </div>

      {/* 陪伴面板：全站只剩它自己念叨 + 喂食。没有输入框——问答归右下的知行 */}
      {open && (
        <div
          role="dialog"
          aria-label={`${site.pet.name} 的面板`}
          className="glass fixed z-40 flex w-[min(300px,calc(100vw-32px))] flex-col rounded-2xl border border-ink-line p-4 shadow-lg"
          style={{ left: pos.x, bottom: pos.y + PET_H + 10 }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-semibold text-ink-text">
              {site.pet.name}
              <span className="ml-2 font-normal text-ink-dim">图书馆里的小鲸鱼</span>
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="收起面板"
              className="grid h-6 w-6 place-items-center rounded-full text-ink-dim transition-colors hover:text-ink-text"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div ref={listRef} className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
            <p className="rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[12.5px] leading-6 text-ink-text">
              {site.pet.greeting}
            </p>
            {lines.map((line) => (
              <p
                key={line.id}
                className="max-w-[92%] rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[12.5px] leading-6 text-ink-text"
              >
                {line.text}
              </p>
            ))}
          </div>

          <button
            type="button"
            onClick={feed}
            disabled={cooldown > 0}
            className="mt-3 rounded-full border border-ink-line px-3 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink-text disabled:opacity-50"
          >
            {cooldown > 0 ? `鱼干冷却中 ${cooldown}s` : '喂一条小鱼干'}
          </button>

          <p className="mt-2 text-[11px] leading-5 text-ink-dim/80">
            我不答题。想问站里的内容，右下角找知行。
          </p>
        </div>
      )}

      {/* 宠物本体：可拖，点击开合面板 */}
      <button
        type="button"
        aria-label={open ? `收起${site.pet.name}的面板` : `打开${site.pet.name}的面板`}
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
        style={{ left: pos.x, bottom: pos.y }}
        className="fixed z-40 cursor-grab touch-none transition-transform duration-300 hover:-translate-y-0.5 active:cursor-grabbing"
      >
        <img
          src={FACES[mood]}
          alt=""
          draggable={false}
          // 移动端缩一号：小屏上它更容易压到正文
          className="h-16 w-auto select-none drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)] sm:h-20"
        />
      </button>
    </>
  );
}
