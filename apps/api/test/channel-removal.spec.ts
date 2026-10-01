import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PayMethodDto } from '../src/modules/orders/dto';
import { ProductsService } from '../src/modules/products/products.service';
import { RedeemService } from '../src/modules/redeem/redeem.service';
import { CardKeysService } from '../src/modules/card-keys/card-keys.service';

const removedTypes = ['CURSOR_SELL', 'AIZHP', 'UNKNOWN_CHANNEL'];

function skuFor(deliveryType: string) {
  return {
    id: 2, productId: 1, name: '规格', visible: true, price: 10, attrs: {},
    product: { id: 1, title: '商品', status: 'ON_SALE', deliveryType },
  };
}

function orderFor(deliveryType: string, status = 'PAID') {
  return {
    orderNo: 'P-history', userId: 7, productId: 1, skuId: 2, quantity: 1,
    status, payMethod: 'POINTS', payAmount: 10, pointsUsed: 100,
    product: { deliveryType },
  };
}

function ordersService(prisma: any, pool: any = {}, points: any = {}) {
  return new OrdersService(
    prisma,
    { set: async () => 'OK', del: async () => 1 } as any,
    {} as any,
    pool,
    points,
  );
}

for (const deliveryType of removedTypes) {
  test(`${deliveryType} 商品不能创建订单`, async () => {
    let written = false;
    const service = ordersService({
      sku: { findUnique: async () => skuFor(deliveryType) },
      order: { create: async () => { written = true; } },
    });
    await assert.rejects(() => service.create({
      productId: 1, skuId: 2, quantity: 1, payMethod: PayMethodDto.ALIPAY,
    }), /渠道已移除/);
    assert.equal(written, false);
  });

  test(`${deliveryType} 历史付款记账后保持 PAID，不回落到本地卡密交付`, async () => {
    const row = orderFor(deliveryType, 'PENDING');
    const writes: any[] = [];
    let inventoryTouched = false;
    const service = ordersService({
      order: {
        findUnique: async () => row,
        update: async ({ data }: any) => { writes.push(data); Object.assign(row, data); return row; },
      },
      $transaction: async () => { inventoryTouched = true; },
    });
    assert.equal(await service.markPaidOnly(row.orderNo, 'paid-trade', 10), 'recorded');
    await service.markPaidAndDeliver(row.orderNo);
    assert.equal(row.status, 'PAID');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].thirdTradeNo, 'paid-trade');
    assert.equal(inventoryTouched, false);
  });

  test(`${deliveryType} 历史待支付订单不能再用余额、积分或 mock 支付`, async () => {
    let charged = false;
    const prisma: any = {
      order: { findUnique: async () => orderFor(deliveryType, 'PENDING') },
      user: { updateMany: async () => { charged = true; return { count: 1 }; } },
    };
    prisma.$transaction = async (fn: any) => fn(prisma);
    const service = ordersService(prisma, {}, {
      deductForOrder: async () => { charged = true; },
    });
    await assert.rejects(() => service.payWithBalance('P-history', 7), /渠道已移除/);
    await assert.rejects(() => service.payWithPoints('P-history', 7), /渠道已移除/);
    await assert.rejects(() => service.mockPay('P-history'), /渠道已移除/);
    assert.equal(charged, false);
  });

  test(`${deliveryType} 兑换码不能继续生成或兑换，且不消耗次数`, async () => {
    let consumed = false;
    let generated = false;
    const prisma: any = {
      sku: { findUnique: async () => skuFor(deliveryType) },
      redeemCode: {
        findUnique: async () => ({ id: 3, skuId: 2, productId: 1, status: 'ACTIVE', usedCount: 0, maxUses: 2 }),
        updateMany: async () => { consumed = true; return { count: 1 }; },
        createMany: async () => { generated = true; },
      },
    };
    prisma.$transaction = async (fn: any) => fn(prisma);
    const service = new RedeemService(prisma, {} as any);
    await assert.rejects(() => service.generate({ productId: 1, skuId: 2, count: 1 }), /渠道已移除/);
    await assert.rejects(() => service.redeem({ code: 'RD-HISTORY' }), /已停售/);
    assert.equal(consumed, false);
    assert.equal(generated, false);
  });
}

test('本地卡密订单仍按数量出库并结算积分', async () => {
  const row = orderFor('CARD_KEY');
  const card = { id: 21, status: 'AVAILABLE' };
  let settled = false;
  const prisma: any = {
    order: { findUnique: async () => row, update: async ({ data }: any) => Object.assign(row, data) },
    cardKey: {
      findMany: async () => [card],
      updateMany: async ({ data }: any) => { Object.assign(card, data); return { count: 1 }; },
    },
    warehouseAccount: { updateMany: async () => ({ count: 0 }) },
    sku: { update: async () => ({}) }, product: { update: async () => ({}) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  await ordersService(prisma, {}, {
    settleDeliveredLocalOrder: async () => { settled = true; },
  }).markPaidAndDeliver(row.orderNo);
  assert.equal(row.status, 'DELIVERED');
  assert.equal(card.status, 'SOLD');
  assert.equal(settled, true);
});

test('本地号池额度包继续创建授权，不读取卡密库存', async () => {
  const row = orderFor('POOL_QUOTA');
  let granted = '';
  const prisma: any = {
    order: { findUnique: async () => row, update: async ({ data }: any) => Object.assign(row, data) },
    sku: { update: async () => ({}) }, product: { update: async () => ({}) },
    $transaction: async (operations: any[]) => Promise.all(operations),
  };
  await ordersService(prisma, {
    createGrantForOrder: async (orderNo: string) => { granted = orderNo; },
  }).markPaidAndDeliver(row.orderNo);
  assert.equal(granted, row.orderNo);
  assert.equal(row.status, 'DELIVERED');
});

test('公开列表只查本地商品，历史渠道详情不能继续展示购买入口', async () => {
  const filters: any[] = [];
  const service = new ProductsService({
    product: {
      count: async ({ where }: any) => { filters.push(where); return 0; },
      findMany: async ({ where }: any) => { filters.push(where); return []; },
      findUnique: async () => ({ ...skuFor('CURSOR_SELL').product, skus: [] }),
    },
    $transaction: async (operations: any[]) => Promise.all(operations),
  } as any);
  await service.list({});
  assert.deepEqual(filters[0].deliveryType.in, ['CARD_KEY', 'POOL_QUOTA', 'MANUAL']);
  assert.deepEqual(filters[0], filters[1]);
  await assert.rejects(() => service.detail(1), /已停售/);
});

test('后台保留历史商品用于查看与下架，禁止重新上架或改成本地类型', async () => {
  const historical = { ...skuFor('CURSOR_SELL').product, skus: [{ id: 2 }] };
  const writes: any[] = [];
  const service = new ProductsService({
    product: {
      findMany: async () => [historical], findUnique: async () => historical,
      update: async (args: any) => { writes.push(args); return historical; },
    },
  } as any);
  const list = await service.adminList();
  assert.equal(list.items[0].deliveryType, 'CURSOR_SELL');
  assert.equal(list.items[0].skus[0].stock, 0);
  await assert.rejects(() => service.setStatus(1, 'ON_SALE'), /不能重新上架/);
  await assert.rejects(() => service.update(1, { status: 'ON_SALE' }), /不能重新上架/);
  await assert.rejects(() => service.update(1, { deliveryType: 'CARD_KEY' }), /请新建本地商品/);
  await service.setStatus(1, 'OFF_SHELF');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.status, 'OFF_SHELF');
});

test('服务端拒绝已移除的渠道类型、规格配置和嵌套状态更新', async () => {
  let saved = false;
  const service = new ProductsService({
    product: { create: async () => { saved = true; } },
  } as any);
  await assert.rejects(() => service.create({ deliveryType: 'AIZHP' }), /不支持该交付方式/);
  await assert.rejects(() => service.create({ deliveryType: 'CURSOR_SELL' }), /不支持该交付方式/);
  await assert.rejects(() => service.create({ skus: [{ attrs: { cursorSellCode: 'old' } }] }), /已移除的渠道配置/);
  await assert.rejects(() => service.create({ skus: [{ attrs: { aizhpPlan: 'pro' } }] }), /已移除的渠道配置/);
  await assert.rejects(() => service.update(1, { status: { set: 'ON_SALE' } }), /状态不合法/);
  assert.equal(saved, false);
});

test('本地商品保存不会透传嵌套关系以重新启用渠道', async () => {
  let saved: any;
  const service = new ProductsService({
    product: { create: async ({ data }: any) => { saved = data; return data; } },
  } as any);
  await service.create({
    categoryId: 1, title: '本地卡密', basePrice: 10, deliveryType: 'CARD_KEY',
    orders: { updateMany: { data: { status: 'DELIVERED' } } },
    skus: [{ name: '规格', price: 10, attrs: { accountType: 'local' },
      product: { update: { deliveryType: 'CURSOR_SELL' } } }],
  });
  assert.equal(saved.deliveryType, 'CARD_KEY');
  assert.equal('orders' in saved, false);
  assert.equal('product' in saved.skus.create[0], false);
  assert.deepEqual(saved.skus.create[0].attrs, { accountType: 'local' });
});

test('本地兑换码继续消耗一次并生成已支付订单供本地发货', async () => {
  const code = { id: 3, code: 'RD-LOCAL', skuId: 2, productId: 1, status: 'ACTIVE', usedCount: 0, maxUses: 2, qtyPerUse: 1 };
  let created: any;
  let record: any;
  let delivered = '';
  const prisma: any = {
    sku: { findUnique: async () => skuFor('CARD_KEY') },
    redeemCode: {
      findUnique: async () => code,
      updateMany: async ({ data }: any) => { Object.assign(code, data); return { count: 1 }; },
    },
    order: { create: async ({ data }: any) => { created = data; return data; } },
    redeemRecord: { create: async ({ data }: any) => { record = data; } },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  const service = new RedeemService(prisma, {
    markPaidAndDeliver: async (orderNo: string) => { delivered = orderNo; },
    detail: async () => created,
  } as any);
  const result = await service.redeem({ code: code.code });
  assert.equal(code.usedCount, 1);
  assert.equal(result.status, 'PAID');
  assert.equal(result.payMethod, 'REDEEM');
  assert.equal(delivered, created.orderNo);
  assert.equal(record.orderNo, created.orderNo);
});

test('历史三方规格不能导入新的可售卡密', async () => {
  let inserted = false;
  const service = new CardKeysService({
    sku: { findUnique: async () => skuFor('CURSOR_SELL') },
    cardKey: { createMany: async () => { inserted = true; } },
  } as any);
  await assert.rejects(() => service.bulkImport(1, 2, 'new-account'), /渠道已移除/);
  assert.equal(inserted, false);
});
