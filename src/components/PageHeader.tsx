/**
 * 内容页统一的页头：英文小标 + 中文大标题 + 一句说明。
 * 四个内容路由（项目/说说/友链/关于）共用，省得每处各写一遍字号和间距。
 */
export function PageHeader({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      <p className="font-mono text-[11px] tracking-[0.34em] text-accent-ink">{kicker}</p>
      <h1 className="mt-3 font-serif text-[30px] font-semibold tracking-wide text-ink-text sm:text-[36px]">
        {title}
      </h1>
      {description && (
        <p className="mt-3 max-w-2xl text-[13.5px] leading-7 text-ink-dim">{description}</p>
      )}
      {children}
    </header>
  );
}
