export const CURSOR_QUOTA_PREMIUM_MODELS_KEY = 'cursor_quota_premium_models';
export const CURSOR_QUOTA_AUTO_MODELS_KEY = 'cursor_quota_auto_models';

export type CursorModelCategory = 'PREMIUM' | 'AUTO';

export interface ModelPricingSettings {
  premiumModels: string[];
  autoModels: string[];
}

export interface ModelUsageBreakdown {
  premiumCostCents: number;
  autoCostCents: number;
  hasDetailedUsage: boolean;
  modelCategories: Record<string, CursorModelCategory>;
}

export interface ModelRevenueBreakdown {
  premiumSoldAmount: number;
  autoSoldAmount: number;
  soldAmount: number;
}

export const EMPTY_MODEL_PRICING_SETTINGS: ModelPricingSettings = {
  premiumModels: [],
  autoModels: [],
};

function normalizedName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

/** 去空、忽略大小写去重，同时保留用户输入的显示文本。 */
export function normalizeModelList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const display = String(value ?? '').trim();
    const normalized = normalizedName(display);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(display);
  }
  return result;
}

/** 兼容 JSON 数组和旧的逗号/换行分隔文本。 */
export function parseModelList(raw: unknown): string[] {
  if (Array.isArray(raw)) return normalizeModelList(raw);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    return normalizeModelList(JSON.parse(raw));
  } catch {
    return normalizeModelList(raw.split(/[\r\n,]+/));
  }
}

/**
 * 显式配置优先；未配置时沿用 Cursor 的 Auto/Composer 命名规则，
 * 其余模型默认按高级模型计价，保证旧账号收益不会突然归零。
 */
export function classifyCursorModel(
  model: unknown,
  settings: ModelPricingSettings,
): CursorModelCategory {
  const name = normalizedName(model);
  const premium = new Set(settings.premiumModels.map(normalizedName));
  const auto = new Set(settings.autoModels.map(normalizedName));

  if (premium.has(name)) return 'PREMIUM';
  if (auto.has(name)) return 'AUTO';
  if (name.includes('auto') || name.includes('composer')) return 'AUTO';
  return 'PREMIUM';
}

export function calculateModelUsage(
  modelBreakdown: unknown,
  totalCostCents: number | null | undefined,
  settings: ModelPricingSettings,
): ModelUsageBreakdown {
  let premiumCostCents = 0;
  let autoCostCents = 0;
  let modelCount = 0;
  const modelCategories: Record<string, CursorModelCategory> = {};

  if (modelBreakdown && typeof modelBreakdown === 'object' && !Array.isArray(modelBreakdown)) {
    for (const [model, rawValue] of Object.entries(modelBreakdown as Record<string, unknown>)) {
      if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
      const cost = Number((rawValue as { costCents?: unknown }).costCents);
      if (!Number.isFinite(cost) || cost < 0) continue;
      const category = classifyCursorModel(model, settings);
      modelCategories[model] = category;
      modelCount += 1;
      if (category === 'AUTO') autoCostCents += cost;
      else premiumCostCents += cost;
    }
  }

  const total = Math.max(0, Number(totalCostCents) || 0);
  if (modelCount === 0) {
    // 旧数据尚未保存模型明细时，保持原先“全部按统一价”的收益。
    premiumCostCents = total;
  }

  return {
    premiumCostCents,
    autoCostCents,
    hasDetailedUsage: modelCount > 0,
    modelCategories,
  };
}

export function calculateModelRevenue(
  usage: Pick<ModelUsageBreakdown, 'premiumCostCents' | 'autoCostCents'>,
  premiumPricePerUsd: number | string | null | undefined,
  autoPricePerUsd: number | string | null | undefined,
): ModelRevenueBreakdown {
  const premiumRate = Math.max(0, Number(premiumPricePerUsd) || 0);
  const autoRate = Math.max(0, Number(autoPricePerUsd) || 0);
  const premiumRaw = (usage.premiumCostCents / 100) * premiumRate;
  const autoRaw = (usage.autoCostCents / 100) * autoRate;
  const soldAmount = roundMoney(premiumRaw + autoRaw);
  const premiumSoldAmount = roundMoney(premiumRaw);
  // 把总额舍入尾差放到 Auto 分类，确保两个分类展示金额之和始终等于总收益。
  const autoSoldAmount = roundMoney(soldAmount - premiumSoldAmount);
  return {
    premiumSoldAmount,
    autoSoldAmount,
    soldAmount,
  };
}
