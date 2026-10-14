'use client';

import { useEffect } from 'react';

/**
 * 给正文里的代码块补上「语言标签 + 复制按钮 + 行号」。
 *
 * 为什么用 DOM 代加工而不是写 rehype 插件：正文本身已经由服务端渲染成 HTML 了，
 * 这里加的纯粹是控件，不碰内容语义；用插件反而要再定义一轮 AST 结构。
 *
 * 调用方必须给它一个会随文章变化的 key，否则站内切换文章时组件不重挂，
 * effect 不会重跑，新文章的代码块就没有控件。
 */
export function CodeCopy() {
  useEffect(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLPreElement>('.md-body pre'));
    const created: HTMLElement[] = [];

    for (const pre of blocks) {
      if (pre.parentElement?.classList.contains('code-wrap')) continue;

      const code = pre.querySelector('code');
      const langClass = Array.from(code?.classList ?? []).find((name) => name.startsWith('language-'));
      const lang = (langClass?.slice('language-'.length) ?? 'text').toUpperCase();

      const wrap = document.createElement('div');
      wrap.className = 'code-wrap';
      // 只有一行的小片段标上行号反而碍眼
      const lineCount = code?.querySelectorAll('.line').length ?? 0;
      if (lineCount > 3) wrap.classList.add('code-numbered');

      const bar = document.createElement('div');
      bar.className = 'code-bar';
      bar.innerHTML = `<span class="code-lang">${lang}</span>`;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = '复制';
      button.setAttribute('aria-label', '复制代码');
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code?.textContent ?? '');
          button.textContent = '已复制';
        } catch {
          button.textContent = '复制失败';
        }
        window.setTimeout(() => {
          button.textContent = '复制';
        }, 1600);
      });

      bar.appendChild(button);

      pre.parentNode?.insertBefore(wrap, pre);
      wrap.appendChild(bar);
      wrap.appendChild(pre);
      created.push(wrap);
    }

    // 组件卸载时把结构还原，避免开发环境下热更新叠加出多层包裹
    return () => {
      for (const wrap of created) {
        const pre = wrap.querySelector('pre');
        if (pre) wrap.parentNode?.insertBefore(pre, wrap);
        wrap.remove();
      }
    };
  }, []);

  return null;
}
