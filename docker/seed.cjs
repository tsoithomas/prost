// Runtime admin seed for the Docker image. Mirrors apps/api/prisma/seed.ts but runs on plain
// Node against the pruned production node_modules (no tsx). Invoked by docker/entrypoint.sh
// only when ADMIN_EMAIL and ADMIN_PASSWORD are set; the upsert makes it idempotent.
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('[seed] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const passwordHash = await hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      preference: { create: {} },
    },
  });

  console.log(`[seed] Admin user ensured: ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('[seed] failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
