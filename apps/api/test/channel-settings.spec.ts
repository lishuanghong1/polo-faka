import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SiteSettingsService } from '../src/modules/site-settings/site-settings.service';
import { EmailCodeService } from '../src/modules/email-code/email-code.service';

const removedKeys = [
  'cursor_sell_api_key', 'cursor_sell_enabled', 'aizhp_open_api_key',
  'email_code_agent_secret', 'email_code_enabled', 'forge_api_key',
];

test('removed credentials remain hidden even when legacy settings are marked public', async () => {
  const settings = [
    { key: 'site_name', value: 'Local shop', isPublic: true },
    ...removedKeys.map((key) => ({ key, value: 'legacy-value', isPublic: true })),
  ];
  const prisma = { siteSetting: { findMany: async () => settings } };
  const service = new SiteSettingsService(prisma as any);
  assert.deepEqual(await service.getPublic(), { site_name: 'Local shop' });
  assert.deepEqual((await service.getAll()).map((item) => item.key), ['site_name']);
});

test('mixed settings updates reject removed channels before writing any valid setting', async () => {
  let writes = 0;
  const prisma = {
    siteSetting: { upsert: async () => { writes++; } },
    $transaction: async () => { writes++; },
  };
  const service = new SiteSettingsService(prisma as any);
  for (const key of removedKeys) {
    await assert.rejects(service.setMany({
      site_name: { value: 'New name', isPublic: true },
      [key]: { value: 'true' },
    }), /渠道已移除/);
    await assert.rejects(service.set(key, 'true'), /渠道已移除/);
    await assert.rejects(service.readSecret(key), /渠道已移除/);
  }
  assert.equal(writes, 0);
});

test('normal site settings can still be saved', async () => {
  let stored: any;
  const prisma = { siteSetting: { upsert: async (data: any) => { stored = data; return data; } } };
  await new SiteSettingsService(prisma as any).set('site_name', 'Local shop', true);
  assert.deepEqual(stored.create, { key: 'site_name', value: 'Local shop', isPublic: true });
});

test('old email clients receive a terminal disabled result without calling a removed provider', async () => {
  const service = new EmailCodeService();
  assert.equal(await service.isEnabled(), false);
  const result = await service.fetchCode({ email: 'buyer@example.com' });
  assert.equal(result.ok, false);
  assert.equal(result.found, false);
  assert.equal(result.terminal, true);
  assert.equal(result.code, 'SERVICE_DISABLED');
  await assert.rejects(service.fetchCode({ email: 'invalid' }), /邮箱格式不正确/);
});
