import { site } from '@/lib/site';

/**
 * 背景弹幕：几条短句从右侧缓慢飘过。
 *
 * 坐标与节奏全部由固定种子的伪随机数生成——服务端与客户端必须得到同一套值，
 * 否则 hydration 会对不上。整个层 pointer-events-none，绝不能拦住底下的点击。
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Bar = {
  text: string;
  top: number;
  duration: number;
  delay: number;
  scale: number;
};

function makeBars(): Bar[] {
  const rand = seeded(20261014);
  return site.danmaku.map((text) => ({
    text,
    top: Number((6 + rand() * 78).toFixed(2)),
    duration: Number((34 + rand() * 30).toFixed(1)),
    delay: Number((rand() * 26).toFixed(2)),
    scale: Number((0.86 + rand() * 0.4).toFixed(2)),
  }));
}

const BARS = makeBars();

export function Danmaku() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden">
      {/* 移动端只留三条：小屏上飘太多会盖住正文 */}
      {BARS.map((bar, i) => (
        <span
          key={bar.text}
          className={`absolute left-full whitespace-nowrap font-mono text-[12px] text-ink-dim/45 animate-danmaku ${
            i >= 3 ? 'hidden sm:inline-block' : ''
          }`}
          style={
            {
              top: `${bar.top}%`,
              '--danmaku-dur': `${bar.duration}s`,
              animationDelay: `${bar.delay}s`,
              fontSize: `${(12 * bar.scale).toFixed(1)}px`,
            } as React.CSSProperties
          }
        >
          {bar.text}
        </span>
      ))}
    </div>
  );
}
