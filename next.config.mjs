import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 上层目录存在其它 lockfile，显式指定追踪根目录，避免 Next 猜错工作区
  outputFileTracingRoot: projectRoot,

  /**
   * 旧地址重定向。
   *
   * 放在这里而不是写 redirect() 页面：页面里重定向要等 async params/searchParams
   * 先把流式响应冲出去，Next 只能退回 meta refresh，拿不到真正的 308。
   * 配置层的 redirects 由路由直接处理，状态码正确、不产生渲染开销，查询串也会自动带上。
   */
  async redirects() {
    return [
      { source: '/blog', destination: '/timeline', permanent: true },
      { source: '/blog/:slug', destination: '/posts/:slug', permanent: true },
    ];
  },

  /**
   * /api 代理到 Python 后端。
   *
   * 页面取数走 src/lib/api.ts 的绝对地址，用不到这个代理；它服务的是「内容里的
   * 同源链接」——收藏笔记的「打开原文 PDF」和助手出处卡片的「对照原文 PDF」都写成
   * /api/clippings/pdf?url=...，经这里转到后端，链接不绑死主机端口。
   * 后端地址默认 127.0.0.1:8000，部署时用 BACKEND_ORIGIN 覆盖。
   *
   * Next 侧已无自有 /api 路由（前后端拆分时删净），整条前缀让出没有冲突。
   */
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:8000';
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
