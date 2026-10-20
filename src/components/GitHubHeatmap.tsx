'use client';

import { useMemo, useRef, useState } from 'react';
import type { GithubHeatmap as HeatmapData } from '@/lib/api';

/**
 * GitHub 贡献热力图（过去一年）。
 *
 * 数据由后端代理第三方接口并缓存（见 server/app/api/routes/github.py），这里只管画：
 * 一列一周、一列七行，SVG 缩放不变形，鼠标停住弹一个日期提示。
 *
 * 用 SVG 而不是 div 网格：370 个格子用 div 会有 370 个盒模型参与布局，
 * SVG 是一次 viewBox 缩放，窗口变窄也不会重排。
 */

type Day = HeatmapData['days'][number];

/** 格子尺寸照 GitHub 自己的口径来：11px 方块 + 3px 缝 */
const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const ROWS = 7;
const LABEL_W = 24;
const HEAD = 16;

/** 0 级用主题描边色（深色模式下也看得见），1–4 级是同一个绿的四档浓度 */
const LEVEL_OPACITY = [1, 0.26, 0.46, 0.7, 1];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
/** 列固定是「周日→周六」，只在周一/三/五写标签，全写会挤成一团 */
const WEEKDAYS = ['', '一', '', '三', '', '五', ''];

type Hover = { x: number; y: number; below: boolean; date: string; count: number };

function layout(days: Day[]) {
  // 首日未必是周日，前面补空位让每一列都对齐「周日在上」
  const offset = new Date(`${days[0].date}T00:00:00`).getDay();
  const cells: (Day | null)[] = [...Array<Day | null>(offset).fill(null), ...days];
  while (cells.length % ROWS !== 0) cells.push(null);
  const weeks = cells.length / ROWS;

  // 月份标签落在一列的第一天；两列挨着会叠字（"1月"约 1.6 格宽），至少隔两列
  const months: { col: number; label: string }[] = [];
  let lastMonth = -1;
  let lastCol = -9;
  for (let col = 0; col < weeks; col += 1) {
    const first = cells.slice(col * ROWS, col * ROWS + ROWS).find(Boolean);
    if (!first) continue;
    const month = Number(first.date.slice(5, 7)) - 1;
    if (month === lastMonth) continue;
    lastMonth = month;
    if (col - lastCol < 2) continue;
    lastCol = col;
    months.push({ col, label: MONTHS[month] });
  }

  return {
    cells,
    months,
    width: LABEL_W + weeks * STEP - GAP,
    height: HEAD + ROWS * STEP - GAP,
  };
}

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

export function GitHubHeatmap({ data }: { data: HeatmapData }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const grid = useMemo(() => layout(data.days), [data.days]);

  // 数据为空（上游一次都没成功过时就压根不会渲染到这儿，这里是兜底）
  if (data.days.length === 0) return null;

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const node = (event.target as Element).closest('rect[data-date]');
    const host = hostRef.current;
    if (!node || !host) return;
    const date = node.getAttribute('data-date') ?? '';
    const cell = node.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    // 横向夹在容器里，否则首尾两列的提示框会被卡片裁掉
    const x = Math.min(Math.max(cell.left + cell.width / 2 - box.left, 56), box.width - 56);
    const y = cell.top - box.top;
    // 同一格内移动没有必要重渲染：370 个 rect 每次 mousemove 都 diff 会掉帧
    setHover((prev) =>
      prev && prev.date === date
        ? prev
        : { x, y, below: y < 28, date, count: Number(node.getAttribute('data-count') ?? 0) },
    );
  }

  return (
    <section className="card mt-10 p-6" aria-label="GitHub 贡献热力图">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <a
          href={`https://github.com/${data.username}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim transition-colors hover:text-accent-ink"
        >
          GITHUB
        </a>
        <p className="text-[12px] text-ink-dim">
          过去一年{' '}
          <strong className="font-mono text-[13px] font-semibold text-ink-text">{data.total}</strong>{' '}
          次贡献
        </p>
      </div>

      <div ref={hostRef} className="relative mt-4">
        <div className="overflow-x-auto pb-1">
          <svg
            viewBox={`0 0 ${grid.width} ${grid.height}`}
            className="h-auto w-full min-w-[620px] fill-current text-[#1f883d] dark:text-[#3fb950]"
            role="img"
            aria-label={`近一年 GitHub 贡献热力图，共 ${data.total} 次贡献`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
          >
            {grid.months.map((month) => (
              <text
                key={`${month.col}-${month.label}`}
                x={LABEL_W + month.col * STEP}
                y={11}
                className="fill-ink-dim text-[10px]"
              >
                {month.label}
              </text>
            ))}

            {WEEKDAYS.map((label, row) =>
              label ? (
                <text
                  key={row}
                  x={LABEL_W - 6}
                  y={HEAD + row * STEP + CELL - 1}
                  textAnchor="end"
                  className="fill-ink-dim text-[10px]"
                >
                  {label}
                </text>
              ) : null,
            )}

            {grid.cells.map((day, index) => {
              if (!day) return null;
              return (
                <rect
                  key={day.date}
                  x={LABEL_W + Math.floor(index / ROWS) * STEP}
                  y={HEAD + (index % ROWS) * STEP}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  data-date={day.date}
                  data-count={day.count}
                  className={day.level === 0 ? 'fill-ink-line' : 'fill-current'}
                  style={{ opacity: day.level === 0 ? 1 : LEVEL_OPACITY[day.level] }}
                />
              );
            })}
          </svg>
        </div>

        {hover ? (
          <div
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-ink-text px-2.5 py-1.5 font-mono text-[11px] leading-none text-ink-bg shadow-lift"
            style={{
              left: hover.x,
              top: hover.below ? hover.y + STEP + 4 : hover.y - 6,
              transform: hover.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
            }}
          >
            {formatDate(hover.date)}
            <span className="opacity-70"> · {hover.count > 0 ? `${hover.count} 次` : '无贡献'}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-ink-dim">
        <span>少</span>
        <span className="flex items-center gap-[3px] text-[#1f883d] dark:text-[#3fb950]">
          {LEVEL_OPACITY.map((opacity, level) => (
            <span
              key={level}
              className={`h-[11px] w-[11px] rounded-[2px] ${level === 0 ? 'bg-ink-line' : 'bg-current'}`}
              style={{ opacity: level === 0 ? 1 : opacity }}
            />
          ))}
        </span>
        <span>多</span>
      </div>
    </section>
  );
}
