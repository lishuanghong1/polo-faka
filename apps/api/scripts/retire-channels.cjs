/** 停用旧供货渠道；仅下架和关停配置，不删除历史订单、卡密、凭据或余额。 */
async function retireChannels(prisma) {
  const results = await prisma.$transaction([
    prisma.product.updateMany({
      where: { deliveryType: { in: ['AIZHP', 'CURSOR_SELL'] }, status: 'ON_SALE' },
      data: { status: 'OFF_SHELF' },
    }),
    prisma.forgeProduct.updateMany({ where: { enabled: true }, data: { enabled: false } }),
    prisma.forgeQuotaPackage.updateMany({ where: { enabled: true }, data: { enabled: false } }),
    prisma.cursorSellProduct.updateMany({ where: { active: true }, data: { active: false } }),
    prisma.siteSetting.updateMany({
      where: { key: { in: ['aizhp_open_enabled', 'cursor_sell_enabled', 'email_code_enabled'] } },
      data: { value: 'false', isPublic: false },
    }),
    prisma.siteSetting.updateMany({
      where: {
        OR: ['aizhp_open_', 'cursor_sell_', 'email_code_'].map((prefix) => ({
          key: { startsWith: prefix },
        })),
        isPublic: true,
      },
      data: { isPublic: false },
    }),
  ]);
  return { productsOffShelf: results[0].count };
}

module.exports = { retireChannels };
