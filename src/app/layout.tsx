import type { Metadata } from 'next';
import './globals.css';
import AmbientBackdrop from '@/components/AmbientBackdrop';
import { BlogAssistant } from '@/components/BlogAssistant';
import { MingyuePet } from '@/components/MingyuePet';
import { Danmaku } from '@/components/Danmaku';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} · ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  authors: [{ name: site.author.name }],
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `${site.name} · ${site.tagline}`,
    description: site.description,
    locale: 'zh_CN',
  },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/', types: { 'application/rss+xml': '/rss.xml' } },
};

/**
 * 首屏防闪烁脚本：主题必须在样式生效前定下来。
 * 默认深色（站点的「深空」气质），用户手动切换后以 localStorage 为准。
 */
const BOOT_INIT = `(function(){try{var k='town-theme';var v=localStorage.getItem(k);var d=v==='light'?'light':'dark';document.documentElement.classList.toggle('dark',d==='dark');}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_INIT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        {/* 键盘用户的第一个可聚焦元素：一把跳到底下的正文，省掉每页 Tab 过导航 */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-full focus:border focus:border-ink-line focus:bg-ink-panel focus:px-4 focus:py-2 focus:text-[13px] focus:text-ink-text"
        >
          跳到正文
        </a>

        <AmbientBackdrop />
        <Danmaku />
        <SiteHeader />
        <div id="main">{children}</div>
        <SiteFooter />
        <BlogAssistant />
        <MingyuePet />
      </body>
    </html>
  );
}
