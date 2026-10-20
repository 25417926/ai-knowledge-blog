'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  CircleGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { categoryColor } from '@/lib/cover';
import type { GraphData } from '@/lib/api';
import {
  GRAPH_H,
  GRAPH_W,
  layoutGraph,
  neighboursOf,
  nodeRadius,
  shortTitle,
  undirectedEdges,
} from '@/lib/graph';

/**
 * 关系网的 WebGL 层：three.js 正交相机，世界坐标就是 680×460 的布局坐标，
 * 像素比与缩放交给 canvas/容器，因此在任何屏幕上节点位置都与静态 SVG 逐像素重合。
 *
 * 为什么「丝滑」不是靠把力导跑成动画：坐标是提前算死的（见 lib/graph.ts），
 * 这里做的是三件廉价但有效的事 —— 入场 420ms 错峰弹出、静止时每个点以各自相位
 * 微幅呼吸、悬停/拖拽用逐帧插值收尾。全部在 rAF 里跑，60fps 不重排 DOM。
 *
 * 鼠标交互归 canvas（射线太小题大做，12 个点直接算距离），键盘与读屏归下面那层
 * DOM 标签（真实 <a>，可聚焦、可回车、爬虫和 e2e 都能看见）。
 */

const EDGE_W = 1.4;
const APPEAR_MS = 420;
const STAGGER_MS = 18;

type Part = {
  slug: string;
  tx: number; // 布局目标（世界坐标）
  ty: number;
  x: number; // 当前渲染坐标
  y: number;
  offX: number; // 拖拽偏移
  offY: number;
  r: number;
  scale: number;
  phase: number;
  dot: Mesh;
  halo: Mesh;
  dotMat: MeshBasicMaterial;
  haloMat: MeshBasicMaterial;
  label: HTMLDivElement | null;
};

type EdgePart = { a: string; b: string; mesh: Mesh };

type Scene3 = {
  parts: Part[];
  edges: EdgePart[];
  bySlug: Map<string, Part>;
  near: Map<string, Set<string>>;
  base: MeshBasicMaterial;
  lit: MeshBasicMaterial;
  dim: MeshBasicMaterial;
  active: string | null;
};

function channels(triplet: string): Color {
  const [r, g, b] = triplet.trim().split(/\s+/).map(Number);
  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

/** 主题色走 CSS 变量，切换主题时由 MutationObserver 重取一次 */
function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): Color {
  return channels(styles.getPropertyValue(name).trim() || fallback);
}

function placeEdge(mesh: Mesh, ax: number, ay: number, bx: number, by: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, 0);
  mesh.rotation.z = Math.atan2(dy, dx);
  mesh.scale.set(Math.hypot(dx, dy), EDGE_W, 1);
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function LinkGraphGL({ data }: { data: GraphData }) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const labels = useRef(new Map<string, HTMLDivElement>());

  /** 布局在渲染期算一次：JSX 的标签层与 three 的对象树必须用同一组坐标 */
  const nodes = useMemo(() => {
    const pos = layoutGraph(data);
    return data.nodes.map((node) => {
      const point = pos.get(node.slug) ?? { x: GRAPH_W / 2, y: GRAPH_H / 2 };
      return {
        slug: node.slug,
        title: node.title,
        category: node.category,
        degree: node.degree,
        tx: point.x,
        ty: point.y,
        r: nodeRadius(node.degree),
      };
    });
  }, [data]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!host || !canvas || !layer) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new Scene();
    // 正交相机把 y 轴翻向下（top=0 / bottom=H）：世界坐标 (0,0) 就是左上角，与 SVG
    // 的 viewBox 完全一致。相机退到 z=100，物体都在近裁剪面之内——near 用负数虽然
    // 数学上可行，但包围盒会被视锥剔除误判，12 个点的图不值得冒这个险。
    const camera = new OrthographicCamera(0, GRAPH_W, 0, GRAPH_H, 1, 1000);
    camera.position.z = 100;
    scene.add(camera);
    const circle = new CircleGeometry(1, 48);
    const quad = new PlaneGeometry(1, 1);

    const styles = getComputedStyle(document.documentElement);
    const line = readVar(styles, '--ink-line', '223 229 240');
    const accent = readVar(styles, '--accent', '91 87 245');

    // side: DoubleSide 是必须的，不是省事：相机把 y 轴翻向下（top=0 / bottom=H），
    // 投影矩阵行列式为负，三角形绕序随之反转 —— 默认的 FrontSide 会把整张图当背面剔掉，
    // 只剩空画布（draw call 有、像素为 0，很难查）。
    const base = new MeshBasicMaterial({
      color: line.clone(),
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      side: DoubleSide,
    });
    const lit = new MeshBasicMaterial({ color: accent.clone(), transparent: true, opacity: 1, depthTest: false, side: DoubleSide });
    const dim = new MeshBasicMaterial({ color: line.clone(), transparent: true, opacity: 0.14, depthTest: false, side: DoubleSide });

    const parts: Part[] = nodes.map((node, index) => {
      const dotMat = new MeshBasicMaterial({
        color: channels(categoryColor(node.category).from),
        transparent: true,
        opacity: 0,
        depthTest: false,
        side: DoubleSide,
      });
      const haloMat = new MeshBasicMaterial({
        color: channels(categoryColor(node.category).from),
        transparent: true,
        opacity: 0,
        depthTest: false,
        side: DoubleSide,
      });
      const dot = new Mesh(circle, dotMat);
      const halo = new Mesh(circle, haloMat);
      dot.renderOrder = 2;
      halo.renderOrder = 1;
      dot.frustumCulled = false;
      halo.frustumCulled = false;
      dot.position.set(node.tx, node.ty, 2);
      halo.position.set(node.tx, node.ty, 1);
      scene.add(dot, halo);
      return {
        slug: node.slug,
        tx: node.tx,
        ty: node.ty,
        x: node.tx,
        y: node.ty,
        offX: 0,
        offY: 0,
        r: node.r,
        scale: 0.9,
        phase: index * 1.37,
        dot,
        halo,
        dotMat,
        haloMat,
        label: labels.current.get(node.slug) ?? null,
      };
    });

    const bySlug = new Map(parts.map((part) => [part.slug, part]));
    const links = undirectedEdges(data).filter(([a, b]) => bySlug.has(a) && bySlug.has(b));
    const edges: EdgePart[] = links.map(([a, b]) => {
      const mesh = new Mesh(quad, base);
      mesh.renderOrder = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { a, b, mesh };
    });

    const world: Scene3 = {
      parts,
      edges,
      bySlug,
      near: neighboursOf(links),
      base,
      lit,
      dim,
      active: null,
    };

    /* ---------- 主题：切换时重取颜色，不重建对象 ---------- */
    const restyle = () => {
      const next = getComputedStyle(document.documentElement);
      base.color.copy(readVar(next, '--ink-line', '223 229 240'));
      dim.color.copy(base.color);
      lit.color.copy(readVar(next, '--accent', '91 87 245'));
    };
    const themeObserver = new MutationObserver(restyle);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    /* ---------- 尺寸：canvas 贴合容器，标签层按比例缩放 ---------- */
    const resize = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      renderer.setSize(rect.width, rect.height, false);
      layer.style.transform = `scale(${rect.width / GRAPH_W})`;
    };
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(host);
    resize();

    /* ---------- 悬停 / 拖拽 ---------- */
    const setActive = (slug: string | null) => {
      if (world.active === slug) return;
      world.active = slug;
      for (const edge of edges) {
        const isLit = slug !== null && (edge.a === slug || edge.b === slug);
        edge.mesh.material = slug === null ? base : isLit ? lit : dim;
      }
      canvas.style.cursor = slug ? 'pointer' : 'grab';
    };

    const isNear = (part: Part): boolean =>
      world.active === null ||
      world.active === part.slug ||
      (world.near.get(world.active)?.has(part.slug) ?? false);

    const toWorld = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * GRAPH_W,
        y: ((event.clientY - rect.top) / rect.height) * GRAPH_H,
      };
    };

    const hitTest = (x: number, y: number): Part | null =>
      parts.find((part) => Math.hypot(part.x - x, part.y - y) <= part.r + 8) ?? null;

    let drag: { part: Part; dx: number; dy: number; moved: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return; // 触屏只做点击，纵向滑动留给页面滚动
      const point = toWorld(event);
      const part = hitTest(point.x, point.y);
      if (!part) return;
      drag = { part, dx: part.x - point.x, dy: part.y - point.y, moved: 0 };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    };

    const onPointerMove = (event: PointerEvent) => {
      const point = toWorld(event);
      if (drag) {
        const { part } = drag;
        const nextX = point.x + drag.dx;
        const nextY = point.y + drag.dy;
        drag.moved += Math.hypot(nextX - part.x, nextY - part.y);
        part.offX = nextX - part.tx;
        part.offY = nextY - part.ty;
        return;
      }
      const part = hitTest(point.x, point.y);
      setActive(part?.slug ?? null);
      canvas.style.cursor = part ? 'pointer' : 'grab';
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag) return;
      const { part, moved } = drag;
      drag = null;
      canvas.releasePointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grab';
      // 拖拽（>4 世界单位）不触发跳转，否则想挪个位置就跳走了
      if (moved < 4) router.push(`/posts/${encodeURIComponent(part.slug)}`);
    };

    const onPointerLeave = () => {
      if (!drag) setActive(null);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);

    /* ---------- 键盘：标签层是真实 <a>，聚焦时同样点亮邻居 ---------- */
    for (const part of parts) {
      const el = part.label;
      if (!el) continue;
      const onFocus = () => setActive(part.slug);
      const onBlur = () => setActive(null);
      el.addEventListener('focus', onFocus, true);
      el.addEventListener('blur', onBlur, true);
    }

    /* ---------- 每帧：入场错峰 + 呼吸 + 插值收尾 ---------- */
    let raf = 0;
    const started = performance.now();

    const draw = (now: number) => {
      const elapsed = now - started;
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        const raw = (elapsed - i * STAGGER_MS) / APPEAR_MS;
        const k = reduced ? 1 : easeOutCubic(Math.min(1, Math.max(0, raw)));
        const outX = (part.tx - GRAPH_W / 2) * 0.16;
        const outY = (part.ty - GRAPH_H / 2) * 0.16;
        const breathe = reduced ? 0 : 1;

        part.x = part.tx + part.offX + outX * (1 - k) + Math.sin(now * 0.00042 + part.phase) * 1.5 * breathe;
        part.y = part.ty + part.offY + outY * (1 - k) + Math.cos(now * 0.00035 + part.phase * 1.7) * 1.3 * breathe;

        const near = isNear(part);
        // 入场只做「收拢 + 淡入」，不改尺寸：SVG 正在同时淡出，尺寸一变就会打架
        const target = world.active === part.slug ? 1.32 : 1;
        part.scale += (target - part.scale) * 0.24;
        const radius = part.r * Math.max(0.04, part.scale);

        part.dot.position.set(part.x, part.y, 2);
        part.dot.scale.setScalar(radius);
        part.dotMat.opacity = k * (near ? 1 : 0.18);

        part.halo.position.set(part.x, part.y, 1);
        part.halo.scale.setScalar(radius + 6 * part.scale);
        part.haloMat.opacity = k * (near ? 0.16 : 0.04);

        if (part.label) {
          part.label.style.transform = `translate3d(${part.x - part.tx}px, ${part.y - part.ty}px, 0) translateX(-50%)`;
          part.label.style.opacity = String(Math.min(1, k * 1.5) * (near ? 1 : 0.22));
        }
      }

      for (const edge of edges) {
        const a = bySlug.get(edge.a)!;
        const b = bySlug.get(edge.b)!;
        placeEdge(edge.mesh, a.x, a.y, b.x, b.y);
      }
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      draw(now);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      sizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      for (const part of parts) {
        part.dotMat.dispose();
        part.haloMat.dispose();
      }
      for (const edge of edges) edge.mesh.removeFromParent();
      base.dispose();
      lit.dispose();
      dim.dispose();
      circle.dispose();
      quad.dispose();
      renderer.dispose();
    };
    // 数据只在首次挂载时装配：/graph 是 force-dynamic，换数据会整页重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0 z-10">
      <canvas
        ref={canvasRef}
        aria-hidden
        className="block h-full w-full"
        style={{ cursor: 'grab' }}
      />
      {/* 标签层：世界坐标 + scale，与 SVG 的 viewBox 同一套映射；
          pointer-events-none 让鼠标全归 canvas，但 <a> 仍可用 Tab 聚焦、回车进入 */}
      <div
        ref={layerRef}
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: GRAPH_W, height: GRAPH_H }}
      >
        {nodes.map((node) => (
          <div
            key={node.slug}
            ref={(el) => {
              if (el) labels.current.set(node.slug, el);
              else labels.current.delete(node.slug);
            }}
            data-graph-node={node.slug}
            data-degree={node.degree}
            className="absolute opacity-0"
            style={{ left: node.tx, top: node.ty + node.r + 6 }}
          >
            <a
              href={`/posts/${encodeURIComponent(node.slug)}`}
              title={`${node.title} · ${node.degree} 条双链`}
              className="pointer-events-none block whitespace-nowrap text-[10.5px] leading-none text-ink-text/80 outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {shortTitle(node.title)}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
