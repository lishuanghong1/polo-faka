/**
 * Polo Faka · 容器启动后的种子脚本。幂等。
 *  - 首次创建默认管理员
 *  - 写入若干默认 SiteSetting
 */
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const { randomBytes } = require('crypto');

const prisma = new PrismaClient();

async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const pwd = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123456';
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`[seed] admin "${username}" already exists, skip`);
    return;
  }
  await prisma.user.create({
    data: {
      username,
      password: await argon2.hash(pwd),
      nickname: 'Admin',
      role: 'ADMIN',
    },
  });
  console.log(`[seed] admin created: ${username}`);
  if (pwd === 'admin123456') {
    console.log('[seed] WARNING: using default password "admin123456"; change it ASAP!');
  }
}

function makeInviteCode(id) {
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `P${id.toString(36).toUpperCase()}${rand}`.slice(0, 16);
}

async function ensureInviteCodes() {
  const users = await prisma.user.findMany({
    where: { inviteCode: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let patched = 0;
  for (const u of users) {
    for (let i = 0; i < 5; i++) {
      try {
        await prisma.user.update({
          where: { id: u.id },
          data: { inviteCode: makeInviteCode(u.id) },
        });
        patched++;
        break;
      } catch (e) {
        if (e.code !== 'P2002' || i === 4) throw e;
      }
    }
  }
  if (patched) console.log(`[seed] invite codes backfilled: ${patched}`);
}

async function ensureSettings() {
  const defaults = [
    { key: 'site_name', value: 'Polo AI 小铺', isPublic: true },
    { key: 'site_tagline', value: '源头好货 · AI 服务账号', isPublic: true },
  ];
  for (const s of defaults) {
    await prisma.siteSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }
  console.log(`[seed] site settings ensured`);
}

(async () => {
  try {
    await ensureAdmin();
    await ensureInviteCodes();
    await ensureSettings();
  } catch (e) {
    console.error('[seed] error:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
