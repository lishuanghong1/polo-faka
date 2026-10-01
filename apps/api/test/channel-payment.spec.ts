import assert from 'node:assert/strict';
import test from 'node:test';
import { AlipayController } from '../src/modules/alipay/alipay.controller';
import { PayController } from '../src/modules/pay/pay.controller';
import { VipService } from '../src/modules/vip/vip.service';

const localOrderNo = 'P20261001120000ab_cdEF0123456789';
const rechargeOrderNo = 'R20261001120000ABCDEFGH23456789';
const tokenOrderNo = 'T20261001120000abcde2345678';
const tradeNo = '20261001220000000000000001';
const removedOrderNos = [
  'FO20261001120000ABCDEFGH23456789',
  'FQ20261001120000ABCDEFGH23456789',
  'F20261001120000ABCDEFGH23456789',
  'Q20261001120000ABCDEFGH23456789',
];

function response() {
  return {
    statusCode: 200,
    sent: undefined as string | undefined,
    redirected: undefined as string | undefined,
    status(code: number) { this.statusCode = code; return this; },
    send(value: string) { this.sent = value; return this; },
    redirect(value: string) { this.redirected = value; return this; },
  };
}

function fixture() {
  const calls: { type: string; args: any[] }[] = [];
  const record = (type: string, result: any) => async (...args: any[]) => {
    calls.push({ type, args });
    return result;
  };
  const local = {
    status: 'PENDING', payMethod: 'ALIPAY', payAmount: 19.5,
    expireAt: new Date(Date.now() + 60_000), productTitle: '本站账号',
    skuName: '标准', quantity: 1, product: { deliveryType: 'CARD_KEY' },
  };
  const alipay = {
    createPayUrl: record('createPayUrl', 'https://pay.example.test'),
    verifyNotify: record('verifyNotify', true),
    tradeQuery: record('tradeQuery', { tradeStatus: 'TRADE_SUCCESS', tradeNo, totalAmount: 19.5 }),
    tradeRefund: record('tradeRefund', { ok: true }),
  };
  const orders = {
    markPaidOnly: record('markPaidOnly', 'recorded'),
    deliverAsync: record('deliverAsync', undefined),
  };
  const recharge = { markPaidAndCredit: record('markPaidAndCredit', 'recorded') };
  const customerRefund = { markFeePaid: record('markFeePaid', 'recorded') };
  const prisma = {
    order: {
      findUnique: record('order.findUnique', local),
      update: record('order.update', {}),
    },
    rechargeOrder: {
      findUnique: record('rechargeOrder.findUnique', {
        status: 'PENDING', amount: 19.5, expireAt: new Date(Date.now() + 60_000),
      }),
    },
    tokenRefundLog: {
      findUnique: record('tokenRefundLog.findUnique', {
        status: 'NEED_PAY', payStatus: 'UNPAID', feeAmount: 10,
      }),
    },
  };
  const audit = { record: record('audit', undefined), fromReq: record('audit.fromReq', undefined) };
  const abuse = {
    bumpAndCheck: record('abuse.bumpAndCheck', { count: 1, blocked: false }),
    shouldRecord: record('abuse.shouldRecord', true),
  };
  const controller = new AlipayController(
    alipay as any, orders as any, recharge as any, customerRefund as any,
    prisma as any, audit as any, abuse as any,
  );
  (controller as any).logger = { log() {}, warn() {}, error() {} };
  return { controller, calls, local, alipay, orders, recharge, customerRefund, prisma };
}

function paymentRequest(orderNo = localOrderNo) {
  return {
    headers: {}, socket: {},
    body: {
      out_trade_no: orderNo, trade_no: tradeNo,
      total_amount: '19.50', trade_status: 'TRADE_SUCCESS', buyer_logon_id: 'buyer@example.test',
    },
  };
}

for (const orderNo of removedOrderNos) {
  test(`支付宝生成、主动查询、退款拒绝已移除渠道订单 ${orderNo.slice(0, 2)}`, async () => {
    const { controller, calls } = fixture();
    await assert.rejects(() => controller.create(orderNo), /不支持的订单号/);
    await assert.rejects(() => controller.adminQuery(orderNo, {} as any), /不支持的订单号/);
    await assert.rejects(() => controller.adminRefund(orderNo, {} as any), /不支持的订单号/);
    assert.deepEqual(calls, []);
  });

  test(`已移除渠道 notify/return 不查询、不发货、不入账 ${orderNo.slice(0, 2)}`, async () => {
    const { controller, calls } = fixture();
    const notifyResponse = response();
    await controller.notify(paymentRequest(orderNo) as any, notifyResponse as any);
    assert.equal(notifyResponse.sent, 'success');
    const returnResponse = response();
    await controller.ret({ query: paymentRequest(orderNo).body } as any, returnResponse as any);
    assert.equal(returnResponse.redirected, '/');
    assert.equal(calls.filter((c) => c.type !== 'verifyNotify' && !c.type.startsWith('audit')).length, 0);
    assert.equal(calls.find((c) => c.type === 'audit')!.args[0].action, 'ALIPAY_NOTIFY_REMOVED_CHANNEL');
    assert.equal(calls.find((c) => c.type === 'audit')!.args[0].detail.requiresManualReconciliation, true);
  });
}

test('伪造历史三方支付回调不能写入需人工对账的真实付款审计', async () => {
  const { controller, alipay, calls } = fixture();
  alipay.verifyNotify = async () => false;
  const res = response();
  await controller.notify(paymentRequest(removedOrderNos[0]) as any, res as any);
  assert.equal(res.sent, 'success');
  assert.equal(calls.some((c) => c.type === 'audit' && c.args[0].action === 'ALIPAY_NOTIFY_REMOVED_CHANNEL'), false);
  assert.equal(calls.some((c) => c.type === 'markPaidOnly' || c.type === 'markPaidAndCredit' || c.type === 'deliverAsync'), false);
});

test('正常本站订单支持含下划线的真实 nanoid，按实付金额创建支付链接', async () => {
  const { controller, calls } = fixture();
  assert.deepEqual(await controller.create(localOrderNo), {
    orderNo: localOrderNo, payUrl: 'https://pay.example.test',
  });
  assert.equal(calls.find((c) => c.type === 'createPayUrl')!.args[0].amount, 19.5);
});

for (const deliveryType of ['AIZHP', 'CURSOR_SELL']) {
  test(`旧 ${deliveryType} 本地 PENDING 订单无法继续收款`, async () => {
    const { controller, calls, local } = fixture();
    local.product.deliveryType = deliveryType;
    await assert.rejects(() => controller.create(localOrderNo), /销售渠道已移除/);
    assert.equal(calls.some((c) => c.type === 'createPayUrl'), false);
  });
}

test('本站支付链接拒绝过期订单和非支付宝订单', async () => {
  const { controller, local, calls } = fixture();
  local.payMethod = 'BALANCE';
  await assert.rejects(() => controller.create(localOrderNo), /不是支付宝订单/);
  local.payMethod = 'ALIPAY';
  local.expireAt = new Date(Date.now() - 1000);
  await assert.rejects(() => controller.create(localOrderNo), /订单已过期/);
  assert.equal(calls.some((c) => c.type === 'createPayUrl'), false);
});

test('本站 notify 只在支付首次录入成功时安排一次发货', async () => {
  const { controller, orders, calls } = fixture();
  let recorded = false;
  orders.markPaidOnly = async (...args: any[]) => {
    calls.push({ type: 'markPaidOnly', args });
    if (recorded) return 'duplicate';
    recorded = true;
    return 'recorded';
  };
  const first = response();
  const duplicate = response();
  await controller.notify(paymentRequest() as any, first as any);
  await controller.notify(paymentRequest() as any, duplicate as any);
  assert.equal(first.sent, 'success');
  assert.equal(duplicate.sent, 'success');
  assert.equal(calls.filter((c) => c.type === 'deliverAsync').length, 1);
  assert.deepEqual(calls.find((c) => c.type === 'markPaidOnly')!.args, [
    localOrderNo, tradeNo, 19.5, 'buyer@example.test',
  ]);
});

test('本站 notify 金额不一致保留审计且不发货', async () => {
  const { controller, orders, calls } = fixture();
  orders.markPaidOnly = async () => { throw new Error('金额不一致'); };
  const res = response();
  await controller.notify(paymentRequest() as any, res as any);
  assert.equal(res.sent, 'success');
  assert.equal(calls.some((c) => c.type === 'deliverAsync'), false);
  assert.equal(calls.find((c) => c.type === 'audit')!.args[0].action, 'ALIPAY_AMOUNT_MISMATCH');
});

test('本站 notify 验签失败和暂时数据库错误均不发货', async () => {
  const { controller, alipay, orders, calls } = fixture();
  alipay.verifyNotify = async () => false;
  const invalid = response();
  await controller.notify(paymentRequest() as any, invalid as any);
  assert.equal(invalid.sent, 'success');
  assert.equal(calls.some((c) => c.type === 'markPaidOnly'), false);
  alipay.verifyNotify = async () => true;
  orders.markPaidOnly = async () => { throw new Error('database unavailable'); };
  const retry = response();
  await controller.notify(paymentRequest() as any, retry as any);
  assert.equal(retry.sent, 'fail');
  assert.equal(calls.some((c) => c.type === 'deliverAsync'), false);
});

test('充值 create/notify/return/adminQuery 保持充值专属入账流程', async () => {
  const { controller, calls } = fixture();
  await controller.create(rechargeOrderNo);
  const notifyRes = response();
  await controller.notify(paymentRequest(rechargeOrderNo) as any, notifyRes as any);
  const returnRes = response();
  await controller.ret({ query: paymentRequest(rechargeOrderNo).body } as any, returnRes as any);
  await controller.adminQuery(rechargeOrderNo, {} as any);
  assert.equal(notifyRes.sent, 'success');
  assert.equal(returnRes.redirected, `/recharge/${rechargeOrderNo}`);
  assert.equal(calls.filter((c) => c.type === 'markPaidAndCredit').length, 3);
  assert.equal(calls.some((c) => c.type === 'markPaidOnly' || c.type === 'deliverAsync'), false);
});

test('充值金额校验失败保留审计且不触发本站发货', async () => {
  const { controller, recharge, calls } = fixture();
  recharge.markPaidAndCredit = async () => { throw new Error('金额不一致'); };
  const res = response();
  await controller.notify(paymentRequest(rechargeOrderNo) as any, res as any);
  assert.equal(res.sent, 'success');
  assert.equal(calls.find((c) => c.type === 'audit')!.args[0].action, 'BALANCE_RECHARGE_AMOUNT_MISMATCH');
  assert.equal(calls.some((c) => c.type === 'markPaidOnly' || c.type === 'deliverAsync'), false);
});

test('账号退款手续费保留独立支付通知流程', async () => {
  const { controller, calls } = fixture();
  await controller.create(tokenOrderNo);
  const res = response();
  await controller.notify(paymentRequest(tokenOrderNo) as any, res as any);
  assert.equal(res.sent, 'success');
  assert.equal(calls.filter((c) => c.type === 'markFeePaid').length, 1);
  assert.equal(calls.some((c) => c.type === 'markPaidOnly' || c.type === 'markPaidAndCredit'), false);
});

test('Mock 支付入口拒绝已移除渠道订单及旧本地 P 订单，保留正常本站链接', async () => {
  const original = process.env.ENABLE_MOCK_PAY;
  process.env.ENABLE_MOCK_PAY = 'true';
  try {
    let deliveryType = 'CARD_KEY';
    let reads = 0;
    const controller = new PayController({
      detail: async () => { reads++; return { product: { deliveryType } }; },
      mockPay: () => assert.fail('不应执行支付'),
    } as any);
    for (const orderNo of removedOrderNos) {
      await assert.rejects(() => controller.create(orderNo), /不支持的订单号/);
      assert.throws(() => controller.notify({ orderNo }), /不支持的订单号/);
    }
    assert.equal(reads, 0);
    for (const retiredType of ['AIZHP', 'CURSOR_SELL']) {
      deliveryType = retiredType;
      await assert.rejects(() => controller.create(localOrderNo), /销售渠道已移除/);
    }
    deliveryType = 'CARD_KEY';
    const result = await controller.create(localOrderNo);
    assert.equal(result.provider, 'mock');
    assert.equal(result.orderNo, localOrderNo);
    assert.match(result.payUrl, /^\/mock-pay\?/);
  } finally {
    if (original === undefined) delete process.env.ENABLE_MOCK_PAY;
    else process.env.ENABLE_MOCK_PAY = original;
  }
});

test('会员折扣查询拒绝第三方来源且默认列表仅取本站配置', async () => {
  let queried: any;
  const service = new VipService({
    productDiscount: { findMany: async (args: any) => { queried = args; return []; } },
  } as any, {} as any);
  for (const source of ['FORGE', 'FORGE_QUOTA']) {
    await assert.rejects(() => service.getDiscount(null, source as any, 'legacy'), /仅支持本站商品/);
    await assert.rejects(() => service.listProductDiscounts(source as any, 'legacy'), /仅支持本站商品/);
    await assert.rejects(() => service.listAllDiscounts({ productSource: source as any }), /仅支持本站商品/);
  }
  assert.deepEqual(await service.listAllDiscounts(), []);
  assert.deepEqual(queried.where, { productSource: 'LOCAL' });
});
