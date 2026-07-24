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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_connections" ("createdAt", "database", "encryptedCredentials", "engine", "host", "id", "name", "port", "sslEnabled", "sslRejectUnauthorized", "updatedAt", "userId", "username") SELECT "createdAt", "database", "encryptedCredentials", "engine", "host", "id", "name", "port", "sslEnabled", "sslRejectUnauthorized", "updatedAt", "userId", "username" FROM "connections";
DROP TABLE "connections";
ALTER TABLE "new_connections" RENAME TO "connections";
CREATE TABLE "new_user_preferences" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "colorMode" TEXT NOT NULL DEFAULT 'system',
    "accentColor" TEXT NOT NULL DEFAULT '#498fff',
    "fontSize" TEXT NOT NULL DEFAULT 'md',
    "gridDensity" TEXT NOT NULL DEFAULT 'normal',
    "keybindings" TEXT NOT NULL DEFAULT '{}',
    "customPalettes" TEXT NOT NULL DEFAULT '[]',
    "connectionOverrides" TEXT NOT NULL DEFAULT '{}',
    "columnRenderOverrides" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_preferences" ("accentColor", "colorMode", "connectionOverrides", "customPalettes", "fontSize", "gridDensity", "keybindings", "userId") SELECT "accentColor", "colorMode", "connectionOverrides", "customPalettes", "fontSize", "gridDensity", "keybindings", "userId" FROM "user_preferences";
DROP TABLE "user_preferences";
ALTER TABLE "new_user_preferences" RENAME TO "user_preferences";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
