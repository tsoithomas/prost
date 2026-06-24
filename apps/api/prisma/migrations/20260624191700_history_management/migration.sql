-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_query_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "query_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "query_history_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_query_history" ("connectionId", "executedAt", "id", "sql", "userId") SELECT "connectionId", "executedAt", "id", "sql", "userId" FROM "query_history";
DROP TABLE "query_history";
ALTER TABLE "new_query_history" RENAME TO "query_history";
CREATE INDEX "query_history_userId_executedAt_idx" ON "query_history"("userId", "executedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
