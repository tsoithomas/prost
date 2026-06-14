-- CreateTable
CREATE TABLE "llm_endpoints" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedApiKey" JSONB NOT NULL,
    "models" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_endpoints_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "llm_endpoints" ADD CONSTRAINT "llm_endpoints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
