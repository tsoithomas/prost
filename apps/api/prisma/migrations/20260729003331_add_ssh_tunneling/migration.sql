-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'postgres',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "database" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedCredentials" JSONB NOT NULL,
    "sslEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sslRejectUnauthorized" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'dev',
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "sshEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sshHost" TEXT,
    "sshPort" INTEGER,
    "sshUsername" TEXT,
    "sshAuthMethod" TEXT,
    "encryptedSshSecret" JSONB,
    "sshKeyPassphraseEncrypted" JSONB,
    "sshHostFingerprint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_connections" ("createdAt", "database", "encryptedCredentials", "engine", "environment", "host", "id", "name", "port", "readOnly", "sslEnabled", "sslRejectUnauthorized", "updatedAt", "userId", "username") SELECT "createdAt", "database", "encryptedCredentials", "engine", "environment", "host", "id", "name", "port", "readOnly", "sslEnabled", "sslRejectUnauthorized", "updatedAt", "userId", "username" FROM "connections";
DROP TABLE "connections";
ALTER TABLE "new_connections" RENAME TO "connections";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
