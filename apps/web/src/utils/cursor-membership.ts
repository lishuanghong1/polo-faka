/** Cursor membershipType → 展示标签 + 样式（free / pro / pro_plus / ultra / business ...） */
const MAP: Record<string, { text: string; cls: string }> = {
  free: { text: 'Free', cls: 'bg-ink-100 text-ink-600' },
  free_trial: { text: '试用', cls: 'bg-sky-100 text-sky-700' },
  trial: { text: '试用', cls: 'bg-sky-100 text-sky-700' },
  pro: { text: 'Pro', cls: 'bg-emerald-100 text-emerald-700' },
  pro_plus: { text: 'Pro+', cls: 'bg-violet-100 text-violet-700' },
  'pro+': { text: 'Pro+', cls: 'bg-violet-100 text-violet-700' },
  ultra: { text: 'Ultra', cls: 'bg-amber-100 text-amber-700' },
  business: { text: 'Business', cls: 'bg-blue-100 text-blue-700' },
  enterprise: { text: 'Enterprise', cls: 'bg-blue-100 text-blue-700' },
  team: { text: 'Team', cls: 'bg-blue-100 text-blue-700' },
};

export function membershipLabel(raw: string | null | undefined): { text: string; cls: string } {
  if (!raw) return { text: '未同步', cls: 'bg-ink-100 text-ink-400' };
  const key = String(raw).trim().toLowerCase();
  if (MAP[key]) return MAP[key];
  // 未知类型：原样展示（首字母大写）
  const text = key.charAt(0).toUpperCase() + key.slice(1);
  return { text, cls: 'bg-ink-100 text-ink-600' };
}
