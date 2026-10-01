const assert = require('node:assert/strict');
const { test } = require('node:test');
const { retireChannels } = require('../scripts/retire-channels.cjs');

test('deployment retirement changes listing flags without touching financial or delivery records', async () => {
  const operations = [];
  const model = (name) => ({
    updateMany: (args) => {
      const operation = { model: name, ...args };
      operations.push(operation);
      return operation;
    },
  });
  // No delete methods or order/balance/card-key models exist in this double.
  // Any destructive or financial operation would fail this regression check.
  const prisma = {
    product: model('product'),
    forgeProduct: model('forgeProduct'),
    forgeQuotaPackage: model('forgeQuotaPackage'),
    cursorSellProduct: model('cursorSellProduct'),
    siteSetting: model('siteSetting'),
    $transaction: async (batch) => {
      assert.deepEqual(batch, operations);
      return batch.map((_, index) => ({ count: index === 0 ? 2 : 1 }));
    },
  };

  assert.deepEqual(await retireChannels(prisma), { productsOffShelf: 2 });
  const listing = operations.find((op) => op.model === 'product');
  assert.deepEqual(listing.where, {
    deliveryType: { in: ['AIZHP', 'CURSOR_SELL'] }, status: 'ON_SALE',
  });
  assert.deepEqual(listing.data, { status: 'OFF_SHELF' });
  for (const operation of operations) {
    assert.ok(!('deliveryType' in operation.data));
    assert.ok(!('status' in operation.data) || operation.model === 'product');
  }
  const disabled = operations.find((op) => op.model === 'siteSetting' && op.data.value);
  assert.equal(disabled.data.value, 'false');
  assert.equal(disabled.data.isPublic, false);
  assert.deepEqual(disabled.where.key.in.sort(),
    ['aizhp_open_enabled', 'cursor_sell_enabled', 'email_code_enabled']);
  assert.ok(operations.some((op) => op.model === 'siteSetting' && op.where.isPublic === true));
});
