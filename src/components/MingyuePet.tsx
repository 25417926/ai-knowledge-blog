'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Application, Sprite as PixiSprite, Texture } from 'pixi.js';
import { site } from '@/lib/site';
import { OPEN_ASSISTANT_EVENT } from './BlogAssistant';

/** 显示高度（CSS px）。素材按 384px 高导出，2 倍屏也够清晰 */
const PET_H = 112;
/** 位移小于它就还算「点了一下」而不是拖拽 */
const DRAG_THRESHOLD = 5;
/** 地面高度：松手后落回这里 */
const GROUND = 8;
/** 吃完一顿要等这么久才可能再煮一次 */
const COOK_COOLDOWN_MS = 45_000;
const IDLE_MIN_MS = 3_000;
const IDLE_MAX_MS = 8_000;
/** 气泡停留时长 */
const SAY_MS = 4_000;

type Mood = 'idle' | 'blink' | 'click' | 'hover' | 'head' | 'lifted' | 'walk' | 'cook' | 'eat' | 'rest';

/**
 * 一个动作 = 一组帧 + 播放节奏。
 * next 有值表示一次性动作，播完自动流转；hold 覆盖停留时长（循环动作靠它收尾）。
 */
type Clip = {
  frames: string[];
  ms: number;
  loop?: boolean;
  next?: Mood;
  hold?: number;
};

/**
 * 状态表。
 *
 * 素材路径由 public/pets/mingyue 下的目录决定（流水线产出：同组同尺寸、
 * 底边中点就是内容底边中点，所以按底边中点摆位就不会上下跳）。
 * 吃饭用的是 cook_3~cook_6 —— 素材里没有独立的 eat_rice 目录，
 * 吃饭的动作本来就长在 cook 后半段，不再单独抽帧。
 */
const CLIPS: Record<Mood, Clip> = {
  idle: { frames: ['idle/idle_0'], ms: 900, loop: true },
  blink: { frames: ['blink/blink_0', 'blink/blink_1'], ms: 150, next: 'idle' },
  click: { frames: ['click/click_0', 'click/click_1', 'click/click_2'], ms: 650, next: 'idle' },
  hover: { frames: ['hover/hover_0', 'hover/hover_1', 'hover/hover_2'], ms: 380, loop: true },
  head: { frames: ['pet_head/pet_head_0', 'pet_head/pet_head_1'], ms: 420, next: 'idle' },
  lifted: { frames: ['lifted/lifted_0'], ms: 900, loop: true },
  walk: { frames: ['walk/walk_0', 'walk/walk_1'], ms: 190, loop: true },
  cook: { frames: ['cook_rice/cook_0', 'cook_rice/cook_1', 'cook_rice/cook_2'], ms: 900, next: 'eat' },
  eat: {
    frames: ['cook_rice/cook_3', 'cook_rice/cook_4', 'cook_rice/cook_5', 'cook_rice/cook_6'],
    ms: 620,
    loop: true,
    hold: 5_000,
    next: 'rest',
  },
  rest: { frames: ['cook_rice/cook_7'], ms: 900, loop: true, hold: 15_000, next: 'idle' },
};

/** 会做呼吸浮动的状态 —— 帧本身不动，靠位移补出「活着」的感觉 */
const BREATHING = new Set<Mood>(['idle', 'hover', 'rest']);
/** 交互动作先预热，别等用户点下去才下载 */
const EAGER: Mood[] = ['idle', 'blink', 'click', 'hover', 'head', 'lifted', 'walk'];

const frameUrl = (name: string) => `/pets/mingyue/${name}.webp`;

/**
 * 桌宠「溟月」。
 *
 * 渲染走 PixiJS 帧动画（静态 import 会把 pixi 打进首屏包，所以放 useEffect 里动态加载），
 * 行为由状态表驱动：待机会眨眼、悬停换姿态、点击换表情、双击摸头、拖走会小碎步、
 * 松手重力落地弹跳，挂机到自己跑去煮饭、吃完定格满足。
 *
 * 指针事件挂在容器上、位置由 React 管 —— 没有用「全屏透明 canvas 接管鼠标」那套，
 * 那会把整页的点击和选择一起吞掉。
 */
export function MingyuePet() {
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState({ x: 20, y: GROUND });
  const [box, setBox] = useState({ w: 90, h: PET_H });
  const [mood, setMood] = useState<Mood>('idle');
  const [line, setLine] = useState<string | null>(null);
  /** 只用来重排待机定时器：setMood('idle') 在已待机时不触发副作用 */
  const [idleTick, setIdleTick] = useState(0);

  const hostRef = useRef<HTMLButtonElement>(null);
  const appRef = useRef<Application | null>(null);
  const spriteRef = useRef<PixiSprite | null>(null);
  const texturesRef = useRef(new Map<string, Texture>());
  /** 每次进入新状态 +1，用来作废异步加载的回调 */
  const runRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const moodRef = useRef<Mood>('idle');
  const posRef = useRef(pos);
  const boxRef = useRef(box);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const fallRef = useRef<number | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const lastCookRef = useRef(0);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      clearTimeout(id);
      clearInterval(id);
    }
    timersRef.current = [];
  }, []);

  const load = useCallback(async (name: string) => {
    const cached = texturesRef.current.get(name);
    if (cached) return cached;
    const { Assets } = await import('pixi.js');
    const texture = await Assets.load<Texture>(frameUrl(name));
    texturesRef.current.set(name, texture);
    return texture;
  }, []);

  const place = useCallback((x: number, y: number) => {
    const maxX = Math.max(8, window.innerWidth - boxRef.current.w - 8);
    const maxY = Math.max(GROUND, window.innerHeight - PET_H - 8);
    posRef.current = {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(GROUND, y), maxY),
    };
    setPos(posRef.current);
  }, []);

  const say = useCallback((text: string) => {
    setLine(text);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setLine(null), SAY_MS);
  }, []);

  /** 单击与键盘回车都走这里：换个表情、说一句邀请，再把助手面板叫出来 */
  const openAssistant = () => {
    setMood('click');
    say(site.pet.askLines[Math.floor(Math.random() * site.pet.askLines.length)]);
    window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
  };

  /** 摸头：它唯一还肯说闲话的时刻 */
  const petHead = () => {
    setMood('head');
    say(site.pet.lines[Math.floor(Math.random() * site.pet.lines.length)]);
  };

  // 建 Pixi 应用；卸载时连同 canvas 一起销毁
  useEffect(() => {
    setMounted(true);
    let disposed = false;
    let app: Application | null = null;

    (async () => {
      const PIXI = await import('pixi.js');
      const host = hostRef.current;
      if (disposed || !host) return;
      app = new PIXI.Application();
      await app.init({
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        width: boxRef.current.w,
        height: PET_H,
      });
      if (disposed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      const sprite = new PIXI.Sprite();
      sprite.anchor.set(0.5, 1);
      sprite.position.set(boxRef.current.w / 2, PET_H);
      app.stage.addChild(sprite);
      app.ticker.add(() => {
        const breath = BREATHING.has(moodRef.current) ? Math.sin(app!.ticker.lastTime / 420) * 2 : 0;
        sprite.y = PET_H + breath;
      });
      appRef.current = app;
      spriteRef.current = sprite;
      setReady(true);
    })();

    return () => {
      disposed = true;
      runRef.current += 1;
      clearTimers();
      app?.destroy(true, { children: true });
      appRef.current = null;
      spriteRef.current = null;
    };
  }, [clearTimers]);

  // 首屏稳下来再预热交互用的帧，不跟首屏抢带宽
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      for (const name of EAGER) {
        if (name === 'idle') continue;
        for (const frame of CLIPS[name].frames) void load(frame);
      }
    }, 1_200);
    return () => clearTimeout(timer);
  }, [ready, load]);

  // 切状态：换帧序列、按该组的尺寸重设画布、排好自动流转
  useEffect(() => {
    if (!ready) return;
    const clip = CLIPS[mood];
    const token = runRef.current + 1;
    runRef.current = token;
    moodRef.current = mood;
    clearTimers();

    (async () => {
      const frames = await Promise.all(clip.frames.map(load));
      const sprite = spriteRef.current;
      const app = appRef.current;
      if (token !== runRef.current || !sprite || !app) return;

      const first = frames[0];
      const width = Math.max(1, Math.round((PET_H * first.width) / first.height));
      boxRef.current = { w: width, h: PET_H };
      setBox(boxRef.current);
      app.renderer.resize(width, PET_H);
      // 素材是 384px 高的，必须缩到显示高度，否则精灵会撑出画布只露出下半身
      sprite.scale.set(PET_H / first.height);
      sprite.position.set(width / 2, PET_H);

      let index = 0;
      const show = () => {
        sprite.texture = frames[index % frames.length];
      };
      show();
      if (frames.length > 1) {
        timersRef.current.push(window.setInterval(() => { index += 1; show(); }, clip.ms));
      }
      if (clip.next) {
        const next = clip.next;
        const wait = clip.hold ?? clip.ms * frames.length;
        timersRef.current.push(window.setTimeout(() => {
          if (token === runRef.current) setMood(next);
        }, wait));
      }
    })();

    return () => {
      runRef.current += 1;
      clearTimers();
    };
  }, [mood, ready, load, clearTimers]);

  // 待机时随机做点自己的事：眨眼为主，冷却满了就跑去煮饭
  useEffect(() => {
    if (!ready || mood !== 'idle') return;
    const timer = window.setTimeout(() => {
      if (dragRef.current) {
        setIdleTick((value) => value + 1);
        return;
      }
      const roll = Math.random();
      if (Date.now() - lastCookRef.current > COOK_COOLDOWN_MS && roll < 0.3) {
        lastCookRef.current = Date.now();
        setMood('cook');
      } else if (roll < 0.82) {
        setMood('blink');
      } else {
        setIdleTick((value) => value + 1);
      }
    }, IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS));
    return () => clearTimeout(timer);
  }, [mood, ready, idleTick]);

  /** 松手后重力落地，弹两下再停 */
  const drop = useCallback(() => {
    if (fallRef.current) cancelAnimationFrame(fallRef.current);
    let velocity = 0;
    let bounces = 0;
    const step = () => {
      velocity += 0.9;
      let y = posRef.current.y - velocity;
      let landed = false;
      if (y <= GROUND) {
        y = GROUND;
        landed = true;
        bounces += 1;
        velocity = bounces < 3 ? velocity * 0.32 : 0;
      }
      place(posRef.current.x, y);
      fallRef.current = !landed || velocity > 0.6 ? requestAnimationFrame(step) : null;
    };
    fallRef.current = requestAnimationFrame(step);
  }, [place]);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (fallRef.current) {
      cancelAnimationFrame(fallRef.current);
      fallRef.current = null;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      sx: event.clientX,
      sy: event.clientY,
      ox: posRef.current.x,
      oy: posRef.current.y,
      moved: false,
    };
    setLine(null);
    setMood('lifted');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.sx;
    const dy = drag.sy - event.clientY;
    if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      drag.moved = true;
      setMood('walk');
    }
    if (drag.moved) place(drag.ox + dx, drag.oy + dy);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      setMood('idle');
      drop();
      return;
    }
    // 没挪动就是点了一下：叫出助手
    openAssistant();
  };

  if (!mounted) return null;

  return (
    <>
      {line && (
        <div
          role="status"
          className="glass pointer-events-none fixed z-40 max-w-[210px] rounded-2xl border border-ink-line px-3 py-2 text-[12.5px] leading-5 text-ink-text shadow-lg"
          style={{ left: Math.min(pos.x + box.w + 6, window.innerWidth - 226), bottom: pos.y + PET_H - 40 }}
        >
          {line}
        </div>
      )}

      <button
        ref={hostRef}
        type="button"
        data-pet-state={mood}
        aria-label={`${site.pet.name}：点一下叫出 AI 助手，双击摸头，也可以拖走`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={() => {
          if (!dragRef.current && moodRef.current === 'idle') setMood('hover');
        }}
        onPointerLeave={() => {
          if (!dragRef.current && moodRef.current === 'hover') setMood('idle');
        }}
        onDoubleClick={petHead}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          // 键盘的主操作与单击保持一致：叫助手，而不是摸头
          openAssistant();
        }}
        style={{ left: pos.x, bottom: pos.y, width: box.w, height: box.h }}
        className="fixed z-40 cursor-grab touch-none select-none active:cursor-grabbing"
      />
    </>
  );
}
