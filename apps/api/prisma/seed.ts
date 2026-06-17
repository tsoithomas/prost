import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
import { createCipheriv, randomBytes } from 'crypto';

const prisma = new PrismaClient();

/** Mirrors CryptoService.encrypt — used to store the (empty) SQLite credential at rest. */
function encryptCredential(plaintext: string): { iv: string; tag: string; data: string } {
  const encoded = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be set to provision a connection');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes');

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/**
 * Provisions exactly one SQLite "connection" pointing at the configured file (the app DB, for
 * inspection). Idempotent: updates the path on an existing SQLite connection rather than creating
 * a second one.
 */
async function provisionSqliteConnection(userId: string): Promise<void> {
  const path = process.env.APP_DB_SQLITE_PATH;
  if (!path) {
    console.log('APP_DB_SQLITE_PATH not set — skipping SQLite inspection connection');
    return;
  }

  const existing = await prisma.connection.findFirst({ where: { userId, engine: 'sqlite' } });
  if (existing) {
    await prisma.connection.update({ where: { id: existing.id }, data: { database: path } });
    return;
  }

  await prisma.connection.create({
    data: {
      userId,
      name: 'App database (SQLite)',
      engine: 'sqlite',
      host: 'localhost',
      port: 0,
      database: path,
      username: '',
      sslEnabled: false,
      sslRejectUnauthorized: true,
      encryptedCredentials: encryptCredential(''),
    },
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the admin user');
  }

  const passwordHash = await hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      preference: { create: {} },
    },
  });

  await provisionSqliteConnection(user.id);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
