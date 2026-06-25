-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN "fontSize" TEXT NOT NULL DEFAULT 'md';
ALTER TABLE "user_preferences" ADD COLUMN "gridDensity" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "user_preferences" ADD COLUMN "keybindings" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "user_preferences" ADD COLUMN "customPalettes" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "user_preferences" ADD COLUMN "connectionOverrides" TEXT NOT NULL DEFAULT '{}';
