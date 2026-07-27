-- CreateTable
CREATE TABLE "audit_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetSchema" TEXT,
    "targetTable" TEXT,
    "sql" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorClass" TEXT,
    "durationMs" INTEGER NOT NULL,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "audit_entries_userId_createdAt_idx" ON "audit_entries"("userId", "createdAt");
