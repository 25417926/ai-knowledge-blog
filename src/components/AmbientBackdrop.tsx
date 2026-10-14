/**
 * 氛围背景层：固定铺满视口，不参与交互。
 * 所有坐标由确定性伪随机数（LCG）生成——服务端与客户端必须算出同一套值，
 * 否则 hydration 会不一致。
 */

/** 固定种子的线性同余发生器，保证 SSR / CSR 结果一致 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Particle = {
  left: number;
  top: number;
  size: number;
  delay: number;
  duration: number;
  peak: number;
  x: number;
};

function makeParticles(count: number, seed: number, opts: { topMax: number; sizeMin: number; sizeMax: number }): Particle[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    left: Number((rand() * 100).toFixed(3)),
    top: Number((rand() * opts.topMax).toFixed(3)),
    size: Number((opts.sizeMin + rand() * (opts.sizeMax - opts.sizeMin)).toFixed(2)),
    delay: Number((rand() * 24).toFixed(2)),
    duration: Number((18 + rand() * 22).toFixed(2)),
    peak: Number((0.35 + rand() * 0.5).toFixed(2)),
    x: Number((rand() * 80 - 40).toFixed(1)),
  }));
}

const STARS = makeParticles(56, 20261013, { topMax: 100, sizeMin: 1, sizeMax: 2.4 });
const FIREFLIES = makeParticles(16, 777100, { topMax: 92, sizeMin: 2.5, sizeMax: 5 });

export default function AmbientBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* 极光色团：缓慢漂移的大面积渐变 */}
      <div className="absolute inset-0 animate-aurora opacity-[var(--ambient-strength)]">
        <div
          className="absolute -left-[15%] -top-[20%] h-[70vh] w-[70vw] rounded-full blur-[110px]"
          style={{ background: 'radial-gradient(circle, rgb(var(--ambient-1) / 0.55), transparent 68%)' }}
        />
        <div
          className="absolute -right-[10%] top-[6%] h-[62vh] w-[58vw] rounded-full blur-[120px]"
          style={{
            background: 'radial-gradient(circle, rgb(var(--ambient-2) / 0.45), transparent 68%)',
            animationDelay: '-7s',
          }}
        />
        <div
          className="absolute bottom-[-18%] left-[22%] h-[58vh] w-[62vw] rounded-full blur-[130px]"
          style={{
            background: 'radial-gradient(circle, rgb(var(--ambient-3) / 0.38), transparent 70%)',
            animationDelay: '-14s',
          }}
        />
      </div>

      {/* 星点：仅暗色主题可见 */}
      <div className="absolute inset-0 hidden dark:block">
        {STARS.map((s, i) => (
          <span
            key={`star-${i}`}
            className="absolute rounded-full bg-white animate-twinkle"
            style={
              {
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDelay: `${s.delay}s`,
                '--twinkle-dur': `${3 + (i % 5)}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* 流萤：向上飘散，双主题都在，暗色下更明显 */}
      <div className="absolute inset-0 opacity-70 dark:opacity-100">
        {FIREFLIES.map((f, i) => (
          <span
            key={`fly-${i}`}
            className="absolute rounded-full bg-[rgb(var(--ambient-3))] animate-drift shadow-[0_0_10px_2px_rgb(var(--ambient-3)/0.55)]"
            style={
              {
                left: `${f.left}%`,
                top: `${f.top}%`,
                width: `${f.size}px`,
                height: `${f.size}px`,
                animationDelay: `-${f.delay}s`,
                '--drift-dur': `${f.duration}s`,
                '--drift-x': `${f.x}px`,
                '--drift-peak': `${f.peak}`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* 顶部渐隐，让导航浮起来 */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink-bg to-transparent" />
      {/* 轻微噪点，消除渐变的塑料感 */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay dark:opacity-[0.05]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%273%27/%3E%3C/filter%3E%3Crect width=%27120%27 height=%27120%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")',
        }}
      />
    </div>
  );
}
