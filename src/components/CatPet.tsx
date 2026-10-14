'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { site } from '@/lib/site';

const POS_KEY = 'town:cat-pos';
const FED_KEY = 'town:cat-fed-at';
/** 喂食冷却：纯前端限制，目的是让它像个活物而不是按钮 */
const COOLDOWN_SECONDS = 30;
const DRAG_THRESHOLD = 5;

type ChatLine = { id: number; text: string; mine: boolean };

/**
 * 像素猫桌宠。
 *
 * 三件事凑成一个「活物」的感觉：能拖走、点它说话、喂它鱼干。
 * 位置与喂食时间都记在 localStorage —— 刷新之后它还在你放下的地方，鱼干也不会重新变满。
 *
 * 猫咪画在 13×11 的字符网格上：一个字符 = 一个像素，比引一张图省事，
 * 也保证任何缩放比例下都是硬边像素而不是糊掉的位图。
 */
const CAT_PIXELS = [
  '..F.......F..',
  '.FFF.....FFF.',
  '.FIF.....FIF.',
  'FFFFFFFFFFFFF',
  'FFDFFFFFFDFFF',
  'FFFFFFFFFFFFF',
  'FFFFFDDDFFFFF',
  'FFFFFFFFFFFFF',
  '.FFFFF.FFFFF.',
  '..FFFF.FFFF..',
  '...FFF.FFF...',
];

const CAT_COLORS: Record<string, string> = {
  F: '#dfa24c',
  I: '#f0b8a4',
  D: '#3a2c22',
};

function CatArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 13 11"
      shapeRendering="crispEdges"
      aria-hidden
      className={`[image-rendering:pixelated] ${className ?? ''}`}
    >
      {CAT_PIXELS.flatMap((row, y) =>
        [...row].map((cell, x) => {
          const fill = CAT_COLORS[cell];
          if (!fill) return null;
          return <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />;
        }),
      )}
    </svg>
  );
}

export function CatPet() {
  const [mounted, setMounted] = useState(false);
  // 默认落在左下角上方一点：右下角是博客助手，正左下角则是开发时的 Next 调试按钮
  const [pos, setPos] = useState({ x: 20, y: 88 });
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [hearts, setHearts] = useState<number[]>([]);
  const [cooldown, setCooldown] = useState(0);

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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines, busy]);

  const clamp = useCallback((x: number, y: number) => {
    const limitX = typeof window === 'undefined' ? x : window.innerWidth - 72;
    const limitY = typeof window === 'undefined' ? y : window.innerHeight - 72;
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

    const line = site.cat.lines[Math.floor(Math.random() * site.cat.lines.length)];
    setLines((prev) => [...prev, { id: now, text: line, mine: false }]);
    setHearts((prev) => [...prev, now]);
    setTimeout(() => setHearts((prev) => prev.filter((id) => id !== now)), 1500);
  };

  const ask = async () => {
    const message = draft.trim();
    if (message === '' || busy) return;
    setDraft('');
    setLines((prev) => [...prev, { id: Date.now(), text: message, mine: true }]);
    setBusy(true);
    try {
      const res = await fetch('/api/blog/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setLines((prev) => [
        ...prev,
        { id: Date.now() + 1, text: data.reply ?? data.error ?? '喵…出了点问题。', mine: false },
      ]);
    } catch {
      setLines((prev) => [...prev, { id: Date.now() + 2, text: '喵…连不上了。', mine: false }]);
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  const size = 44;

  return (
    <>
      {/* 小鱼干爱心粒子 */}
      <div
        className="pointer-events-none fixed z-40"
        style={{ left: pos.x + 8, bottom: pos.y + size }}
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

      {/* 对话面板 */}
      {open && (
        <div
          role="dialog"
          aria-label={`${site.cat.name} 的对话`}
          className="glass fixed z-40 flex w-[min(300px,calc(100vw-32px))] flex-col rounded-2xl border border-ink-line p-4 shadow-lg"
          style={{ left: pos.x, bottom: pos.y + size + 10 }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-semibold text-ink-text">
              {site.cat.name}
              <span className="ml-2 font-normal text-ink-dim">图书馆里的猫</span>
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭对话"
              className="grid h-6 w-6 place-items-center rounded-full text-ink-dim transition-colors hover:text-ink-text"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div ref={listRef} className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
            <p className="rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[12.5px] leading-6 text-ink-text">
              {site.cat.greeting}
            </p>
            {lines.map((line) => (
              <p
                key={line.id}
                className={
                  line.mine
                    ? 'ml-auto max-w-[86%] rounded-xl bg-accent px-3 py-2 text-[12.5px] leading-6 text-white'
                    : 'max-w-[92%] whitespace-pre-wrap rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[12.5px] leading-6 text-ink-text'
                }
              >
                {line.text}
              </p>
            ))}
            {busy && <p className="text-[12px] text-ink-dim">翻书架中…</p>}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void ask();
              }}
              placeholder="问我点什么…"
              aria-label="向猫咪提问"
              className="min-w-0 flex-1 rounded-full border border-ink-line bg-ink-panel/60 px-3 py-2 text-[12.5px] text-ink-text outline-none placeholder:text-ink-dim focus:border-accent/60"
            />
            <button
              type="button"
              onClick={() => void ask()}
              disabled={busy}
              className="shrink-0 rounded-full bg-accent px-3 py-2 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              问
            </button>
          </div>

          <button
            type="button"
            onClick={feed}
            disabled={cooldown > 0}
            className="mt-2 rounded-full border border-ink-line px-3 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink-text disabled:opacity-50"
          >
            {cooldown > 0 ? `鱼干冷却中 ${cooldown}s` : '喂一条小鱼干'}
          </button>
        </div>
      )}

      {/* 猫本体：可拖，点击开合对话 */}
      <button
        type="button"
        aria-label={open ? '收起猫咪对话' : `和${site.cat.name}说话`}
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
        className="fixed z-40 cursor-grab touch-none rounded-xl p-1.5 transition-transform duration-300 hover:-translate-y-0.5 active:cursor-grabbing"
      >
        <span className="block drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]">
          {/* 移动端缩一号：小屏上它更容易压到正文 */}
          <CatArt className="h-9 w-9 sm:h-11 sm:w-11" />
        </span>
      </button>
    </>
  );
}
