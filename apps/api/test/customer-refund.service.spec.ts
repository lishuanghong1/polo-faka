import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CustomerRefundService,
  isRefundSuccessMembership,
} from '../src/modules/customer-refund/customer-refund.service';

test('退款成功判定只接受明确的 free', () => {
  assert.equal(isRefundSuccessMembership('free'), true);
  assert.equal(isRefundSuccessMembership(' FREE '), true);
  assert.equal(isRefundSuccessMembership(''), false);
  assert.equal(isRefundSuccessMembership(undefined), false);
  assert.equal(isRefundSuccessMembership('free_trial'), false);
  assert.equal(isRefundSuccessMembership('trial'), false);
  assert.equal(isRefundSuccessMembership('pro'), false);
});

test('试用订阅不会被标记成功，也不会创建收费订单', async () => {
  let created = false;
  const prisma = {
    tokenRefundLog: {
      create: async () => {
        created = true;
      },
    },
  };
  const cursorRefund = {
    checkMembership: async () => ({
      ok: true,
      email: 'trial@example.com',
      membershipType: 'free_trial',
    }),
  };
  const service = new CustomerRefundService(prisma as any, cursorRefund as any);

  await assert.rejects(
    () => service.applyByToken('user_test::jwt'),
    /不是可退款的付费订阅/,
  );
  assert.equal(created, false);
});

test('支付 notify 与 return 并发时只启动一次退款任务', async () => {
  let claimed = false;
  let scheduled = 0;
  const row = {
    id: 7,
    status: 'NEED_PAY',
    payStatus: 'UNPAID',
    feeAmount: 10,
    cursorTokenEnc: 'user_test::jwt',
  };
  const prisma = {
    tokenRefundLog: {
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where }: any) => {
        if (where.status === 'NEED_PAY' && where.payStatus === 'UNPAID') {
          if (claimed) return { count: 0 };
          claimed = true;
          return { count: 1 };
        }
        return { count: 1 };
      },
    },
  };
  const service = new CustomerRefundService(prisma as any, {} as any);
  (service as any).runTokenRefund = () => {
    scheduled += 1;
  };

  const results = await Promise.all([
    service.markFeePaid('T-order', 'trade-1', 10),
    service.markFeePaid('T-order', 'trade-1', 10),
  ]);

  assert.deepEqual(results.sort(), ['duplicate', 'recorded']);
  assert.equal(scheduled, 1);
});

test('下层即使返回 ok，订阅不是 free 仍写为失败并保留 token', async () => {
  const writes: any[] = [];
  const prisma = {
    tokenRefundLog: {
      updateMany: async (args: any) => {
        writes.push(args);
        return { count: 1 };
      },
    },
  };
  const cursorRefund = {
    refundOne: async () => ({
      ok: true,
      email: 'user@example.com',
      amount: 8,
      prevMembership: 'pro',
      finalMembership: 'trial',
      log: [],
    }),
  };
  const service = new CustomerRefundService(prisma as any, cursorRefund as any);

  await (service as any).executeTokenRefund(9, 'user_test::jwt');

  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.status, 'FAILED');
  assert.equal(writes[0].data.finalMembership, 'trial');
  assert.equal('cursorTokenEnc' in writes[0].data, false);
});

test('明确复查到 free 后写为成功并清理暂存 token', async () => {
  const writes: any[] = [];
  const prisma = {
    tokenRefundLog: {
      findUnique: async () => ({
        id: 11,
        status: 'FAILED',
        payStatus: 'PAID',
        cursorTokenEnc: 'user_test::jwt',
      }),
      updateMany: async (args: any) => {
        writes.push(args);
        return { count: 1 };
      },
    },
  };
  const cursorRefund = {
    checkMembership: async () => ({
      ok: true,
      email: 'user@example.com',
      membershipType: 'free',
    }),
  };
  const service = new CustomerRefundService(prisma as any, cursorRefund as any);

  const result = await service.recheckTokenRefund(11);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'DONE');
  assert.equal(writes[0].data.finalMembership, 'free');
  assert.equal(writes[0].data.cursorTokenEnc, null);
});
