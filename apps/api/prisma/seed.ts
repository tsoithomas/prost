import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the admin user');
  }

  const passwordHash = await hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    // Re-sync the password from .env on every seed run, so editing ADMIN_PASSWORD
    // (or rotating it) actually takes effect for an already-existing admin user.
    update: { passwordHash },
    create: {
      email,
      passwordHash,
      preference: { create: {} },
    },
  });

  // The app DB is itself surfaced as a permanent, read-only SQLite connection — but that connection
  // is virtual (synthesized in ConnectionsService), so there is nothing to seed for it here.
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
