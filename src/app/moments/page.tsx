import type { Metadata } from 'next';
import { MomentsBoard } from '@/components/MomentsBoard';
import { PageHeader } from '@/components/PageHeader';
import { listMoments } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '说说',
  description: '随手记的短动态：读到什么、在哪、想什么。',
};

export default async function MomentsPage() {
  const moments = await listMoments();

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-12 sm:px-8">
      <PageHeader
        kicker="MOMENTS"
        title="说说"
        description="短、随手、不讲究结构。想认真写的都放杂谈里了。"
      />
      {moments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-line p-14 text-center text-[13px] text-ink-dim">
          还没有动态。
        </div>
      ) : (
        <MomentsBoard moments={moments} />
      )}
    </main>
  );
}
