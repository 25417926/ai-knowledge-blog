import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { ProjectsBoard } from '@/components/ProjectsBoard';
import { projects, type Project } from '@/lib/projects';

export const metadata: Metadata = {
  title: '项目',
  description: '做过的东西：从内容管线到 Agent 内核，以及这座站本身。',
};

/** 置顶优先，其余按维护状态排：还在跑的排前面，归档的沉底 */
const STATUS_WEIGHT: Record<Project['status'], number> = { active: 0, wip: 1, archived: 2 };

export default function ProjectsPage() {
  const ordered = [...projects].sort((a, b) => {
    if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1;
    return STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
  });

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-12 sm:px-8">
      <PageHeader
        kicker="PROJECTS MATRIX"
        title="项目"
        description="连载中的、收尾的、归档的，都在这里。点卡片直接跳到仓库或演示。"
      />
      <ProjectsBoard projects={ordered} />
    </main>
  );
}
