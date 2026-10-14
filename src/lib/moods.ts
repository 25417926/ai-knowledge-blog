/**
 * 情绪枚举与配色。
 *
 * 单独放一个文件，是为了让客户端组件也能用：chatter.ts 会连到数据库（node:fs / node:sqlite），
 * 客户端组件一旦从它那里 import 常量，整条依赖链就被打进浏览器包，编译直接失败。
 * 这里只有纯常量，谁都能引。
 *
 * 颜色写死具体色值是因为情绪是内容维度的颜色，不属于主题令牌；
 * 明暗两套都写全，免得在浅色主题下对比度不够。
 */

export type Mood = 'calm' | 'happy' | 'thinking' | 'tired' | 'emo';

export const MOODS: Record<Mood, { label: string; chip: string; dot: string }> = {
  calm: {
    label: '平静',
    chip: 'border-teal-600/40 bg-teal-500/10 text-teal-700 dark:border-teal-400/40 dark:bg-teal-400/10 dark:text-teal-200',
    dot: 'bg-teal-500 dark:bg-teal-400',
  },
  happy: {
    label: '开心',
    chip: 'border-amber-600/40 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200',
    dot: 'bg-amber-500 dark:bg-amber-400',
  },
  thinking: {
    label: '思考',
    chip: 'border-sky-600/40 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200',
    dot: 'bg-sky-500 dark:bg-sky-400',
  },
  tired: {
    label: '疲惫',
    chip: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:border-zinc-400/40 dark:bg-zinc-400/10 dark:text-zinc-300',
    dot: 'bg-zinc-500 dark:bg-zinc-400',
  },
  emo: {
    label: 'EMO',
    chip: 'border-violet-600/40 bg-violet-500/10 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-200',
    dot: 'bg-violet-500 dark:bg-violet-400',
  },
};

export const MOOD_KEYS = Object.keys(MOODS) as Mood[];

export function isMood(value: string): value is Mood {
  return Object.prototype.hasOwnProperty.call(MOODS, value);
}
