import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 管理员
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123456';
  const existing = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (!existing) {
    await prisma.user.create({
      data: {
        username: adminUsername,
        password: await argon2.hash(adminPassword),
        nickname: 'Admin',
        role: 'ADMIN',
      },
    });
    console.log(`✓ Admin created: ${adminUsername} / ${adminPassword}`);
  } else {
    console.log(`= Admin exists: ${adminUsername}`);
  }

  // 站点设置
  await prisma.siteSetting.upsert({
    where: { key: 'site_name' },
    update: { value: 'Polo AI 小铺', isPublic: true },
    create: { key: 'site_name', value: 'Polo AI 小铺', isPublic: true },
  });
  await prisma.siteSetting.upsert({
    where: { key: 'site_tagline' },
    update: { value: '源头好货 · Cursor / GPT / Codex / WindSurf 账号服务', isPublic: true },
    create: {
      key: 'site_tagline',
      value: '源头好货 · Cursor / GPT / Codex / WindSurf 账号服务',
      isPublic: true,
    },
  });
  await prisma.siteSetting.upsert({
    where: { key: 'qq_groups' },
    update: { value: JSON.stringify(['651304239']), isPublic: true },
    create: { key: 'qq_groups', value: JSON.stringify(['651304239']), isPublic: true },
  });

  // 分类
  const cats = [
    { name: '全部', slug: 'all', sort: 100 },
    { name: 'Cursor', slug: 'cursor', sort: 90 },
    { name: 'Windsurf', slug: 'windsurf', sort: 80 },
    { name: 'GPT', slug: 'gpt', sort: 70 },
    { name: 'Gemini', slug: 'gemini', sort: 60 },
    { name: '中转API', slug: 'api', sort: 50 },
    { name: 'Claude', slug: 'claude', sort: 40 },
    { name: '谷歌邮箱', slug: 'gmail', sort: 30 },
  ];
  const catMap: Record<string, number> = {};
  for (const c of cats) {
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, sort: c.sort },
      create: c,
    });
    catMap[c.slug] = cat.id;
  }

  // 示例商品
  const products = [
    {
      categoryId: catMap['cursor'],
      title: 'Cursor Pro 成品号 / 代充 / 发账密',
      subtitle: '新品稳定成品号',
      description: '会贵不少有需要就买不要屯 / 记得改密码 / 格式：账号----邮箱密码',
      tags: ['新品', '稳定', '热榜'],
      basePrice: new Prisma.Decimal(65),
      warranty: '默认无质保 / 选择有质保的规格享受退款',
      bulkPricing: null,
      skus: [
        { name: 'Pro 红账单账号', price: new Prisma.Decimal(65) },
        { name: '账密+邮箱登录 / 质保七天', price: new Prisma.Decimal(80.88) },
        { name: '质保 30 天 / 稳定版', price: new Prisma.Decimal(120.88) },
        { name: 'Pro 代充 / 无质保', price: new Prisma.Decimal(88.88) },
      ],
    },
    {
      categoryId: catMap['cursor'],
      title: 'Cursor 速刷成品号 / Token',
      subtitle: '基础 20 刀 + 奖励 + 透支 ≈ 65 刀',
      description: '只发 token，邮箱验证码登录，需要可联系。',
      tags: ['热榜'],
      basePrice: new Prisma.Decimal(55),
      warranty: '到当晚十二点',
      skus: [
        { name: '只有 Token / 当日有效', price: new Prisma.Decimal(55) },
        { name: '一天 Ultra / 1000 押金', price: new Prisma.Decimal(1300) },
      ],
    },
    {
      categoryId: catMap['cursor'],
      title: 'Cursor 额度包 / 天卡 / 月卡',
      subtitle: '号池玩法 · 按额度计费',
      description: 'Pro/Ultra/企业号给你凑额度，额度按 token 实时统计。',
      tags: ['号池', '新品'],
      basePrice: new Prisma.Decimal(85),
      skus: [
        { name: '100$ 天卡', price: new Prisma.Decimal(85) },
        { name: '100$ 周卡', price: new Prisma.Decimal(120) },
        { name: '100$ 月卡', price: new Prisma.Decimal(130) },
        { name: '500$ 月卡', price: new Prisma.Decimal(600) },
        { name: '1000$ 月卡', price: new Prisma.Decimal(1200) },
      ],
    },
    {
      categoryId: catMap['gpt'],
      title: 'GPT API 中转站 / 支持 GPT-5.4 / Codex',
      subtitle: '兼容 OpenAI 格式，即买即用',
      description: '中转站地址：https://example.com/v1',
      tags: ['API'],
      basePrice: new Prisma.Decimal(10),
      skus: [
        { name: '日卡·每天 100$', price: new Prisma.Decimal(10) },
        { name: '日卡·每天 150$', price: new Prisma.Decimal(14) },
        { name: '日卡·每天 200$', price: new Prisma.Decimal(18) },
      ],
    },
    {
      categoryId: catMap['windsurf'],
      title: 'WindSurf 试用号 / 100 积分',
      subtitle: '谷歌邮箱',
      description: '试用号 100 积分的，看好拍。',
      tags: ['试用'],
      basePrice: new Prisma.Decimal(0.5),
      bulkPricing: [
        { min: 1, max: 9, price: 0.5 },
        { min: 10, max: 30, price: 0.45 },
        { min: 31, max: 50, price: 0.4 },
        { min: 51, max: 100, price: 0.35 },
      ],
      skus: [{ name: '谷歌邮箱', price: new Prisma.Decimal(0.5) }],
    },
    {
      categoryId: catMap['claude'],
      title: 'Claude Team 子号席位',
      subtitle: '6.25 倍率',
      tags: ['新品'],
      basePrice: new Prisma.Decimal(720),
      skus: [{ name: '6.25 倍率全程质保', price: new Prisma.Decimal(720) }],
    },
  ];

  // 清空再插入（开发期方便）
  await prisma.cardKey.deleteMany();
  await prisma.sku.deleteMany();
  await prisma.product.deleteMany();

  for (const p of products) {
    const { skus, ...rest } = p as any;
    const created = await prisma.product.create({
      data: {
        ...rest,
        tags: rest.tags as any,
        bulkPricing: rest.bulkPricing as any,
        skus: {
          create: skus.map((s: any, i: number) => ({ ...s, sort: i })),
        },
      },
      include: { skus: true },
    });

    // 给每个 SKU 灌 5-15 张卡密
    for (const s of created.skus) {
      const count = 5 + Math.floor(Math.random() * 10);
      const data = Array.from({ length: count }, (_, i) => ({
        productId: created.id,
        skuId: s.id,
        content: `[示例卡密 ${created.id}-${s.id}-${i + 1}] account_${i + 1}@example.com----PWD${1000 + i}`,
        remark: 'seed',
      }));
      await prisma.cardKey.createMany({ data });
    }
  }

  // 公告
  await prisma.announcement.create({
    data: {
      title: '欢迎使用 Polo Faka',
      content:
        '## 站点公告\n\n这是一个 **Demo 版** 的发卡商城。\n\n- 默认管理员：admin / admin123456\n- 当前使用 Mock 支付，所有订单点支付按钮即视为支付成功\n- 真实上线请替换为易支付 / USDT 等渠道',
      popup: true,
      popupMode: 'ONCE',
      active: true,
      sort: 100,
    },
  });

  console.log('✓ Seed done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
