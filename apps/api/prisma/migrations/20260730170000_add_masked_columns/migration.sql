-- AlterTable: per-column masking preference (Phase 39).
-- `MaskedColumns` JSON — connectionId -> "schema.table" -> column names. Identifiers only.
ALTER TABLE "user_preferences" ADD COLUMN "maskedColumns" TEXT NOT NULL DEFAULT '{}';
