-- AlterTable: per-user opt-out of the visible keyboard-focus ring (usability polish follow-up).
ALTER TABLE "user_preferences" ADD COLUMN "hideFocusRing" BOOLEAN NOT NULL DEFAULT false;
