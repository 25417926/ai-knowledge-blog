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
};

export default nextConfig;
