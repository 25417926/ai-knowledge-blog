import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { listFriends } from '@/lib/api';
import { categoryColor } from '@/lib/cover';
import { site } from '@/lib/site';

// 友链由后台维护（/admin/friends），改完刷新即可见，不吃构建期的静态快照
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '友链',
  description: '互相看得上眼的站点，都记在这儿。',
};

/** 只显示域名，域名解析不出来就把原始字符串吐回去 */
function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

export default async function FriendsPage() {
  const friends = await listFriends();

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-12 sm:px-8">
      <PageHeader
        kicker="FRIEND LINKS"
        title="友链"
        description="愿意把笔记写成人话的人不多，遇到了就记一笔。"
      />

      {friends.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-ink-line p-14 text-center text-[13px] text-ink-dim">
          还没有友链。登录后台 /admin/friends 可以添加。
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {friends.map((friend) => {
            // 与卡片封面共用一套配色：同一个名字在任何时候都得到同一个颜色，不用存头像
            const { from, to } = categoryColor(friend.name);
            return (
              <a
                key={friend.id}
                href={friend.href}
                target="_blank"
                rel="noopener noreferrer"
                className="card flex flex-col p-5 transition-colors hover:border-accent/60"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[15px] font-semibold text-white"
                    style={{ backgroundImage: `linear-gradient(135deg, rgb(${from}), rgb(${to}))` }}
                  >
                    {friend.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15.5px] font-semibold text-ink-text">
                      {friend.name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-ink-dim">
                      {hostOf(friend.href)}
                    </span>
                  </span>
                </div>

                <p className="mt-3.5 text-[12.5px] leading-6 text-ink-dim">{friend.description}</p>

                {friend.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {friend.tags.map((tag) => (
                      <span key={tag} className="chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <span className="mt-auto pt-5 text-[12px] text-ink-dim">去逛逛 →</span>
              </a>
            );
          })}
        </div>
      )}

      <section className="card mt-8 p-6" aria-label="友链说明">
        <h2 className="text-[15px] font-semibold text-ink-text">想换友链？</h2>
        <p className="mt-2 text-[12.5px] leading-6 text-ink-dim">
          这边是个人的技术笔记站，写 Java、并发、Agent 工程这些。要求只有一条：你的站得是自己写的内容，
          不是采集站、也不是挂满广告的导航页。互链时把这一站加进你的友链就行，然后按下面的方式告诉我。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {site.social.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="chip transition-colors hover:border-accent/60 hover:text-accent-ink"
            >
              {link.label}
            </a>
          ))}
        </div>
        <p className="mt-4 text-[11.5px] text-ink-dim">
          申请表单还没做——换友链现在靠来信，收到后我加到这一页。
        </p>
      </section>
    </main>
  );
}
