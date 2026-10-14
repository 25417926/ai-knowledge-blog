'use client';

import { useMemo, useState } from 'react';
import { STATUS_LABEL, type Project } from '@/lib/projects';

/**
 * 项目矩阵。
 *
 * 筛选放在客户端：项目是编译期常量、条目很少，为它跑一趟服务端没有意义，
 * 输入即出结果的手感也更好（不像归档页那样要同步 URL，那种量级才需要）。
 */
export function ProjectsBoard({ projects }: { projects: Project[] }) {
  const [q, setQ] = useState('');
  const keyword = q.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!keyword) return projects;
    return projects.filter((project) =>
      [project.name, project.description, project.slug, ...project.tech]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [projects, keyword]);

  return (
    <>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="搜项目名、描述或技术栈…"
          aria-label="搜索项目"
          className="w-full rounded-full border border-ink-line bg-ink-panel/50 py-3 pl-11 pr-4 text-[14px] text-ink-text outline-none transition-colors placeholder:text-ink-dim focus:border-accent/60"
        />
      </div>

      <p className="mt-4 text-[12px] text-ink-dim" aria-live="polite">
        共 {visible.length} 个项目
        {keyword && (
          <>
            {' · '}
            <button
              type="button"
              onClick={() => setQ('')}
              className="underline decoration-dotted transition-colors hover:text-accent-ink"
            >
              清除搜索
            </button>
          </>
        )}
      </p>

      {visible.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-ink-line p-14 text-center">
          <p className="text-[14px] text-ink-text">没有匹配的项目</p>
          <p className="mt-2 text-[12.5px] text-ink-dim">换个关键词试试，或者清掉搜索。</p>
          <button
            type="button"
            onClick={() => setQ('')}
            className="mt-5 rounded-full border border-ink-line px-4 py-1.5 text-[12.5px] transition-colors hover:border-accent/60 hover:text-ink-text"
          >
            清除搜索
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => {
            const primary = project.repo ?? project.demo;
            return (
              <article key={project.slug} className="card group flex flex-col p-5">
                {/* 整卡可点：铺一层到主链接，正文里的次级链接靠更高的 z 层单独可点 */}
                {primary && (
                  <a
                    href={primary}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`打开项目 ${project.name}`}
                    className="absolute inset-0"
                    style={{ zIndex: 0 }}
                  />
                )}

                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-[14px] font-semibold text-accent-ink">
                    {project.name.slice(0, 1)}
                  </span>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {project.featured && <span className="chip chip-active">置顶</span>}
                    <span className="chip">{STATUS_LABEL[project.status]}</span>
                  </span>
                </div>

                <h2 className="mt-4 text-[16.5px] font-semibold text-ink-text">{project.name}</h2>
                <p className="mt-2 text-[12.5px] leading-6 text-ink-dim">{project.description}</p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {project.tech.map((tech) => (
                    <span key={tech} className="chip">
                      {tech}
                    </span>
                  ))}
                </div>

                <div className="mt-auto flex gap-2 pt-5">
                  {project.repo && (
                    <a
                      href={project.repo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-ink-line px-3 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink-text"
                    >
                      仓库
                    </a>
                  )}
                  {project.demo && (
                    <a
                      href={project.demo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-ink-line px-3 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink-text"
                    >
                      演示
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}
