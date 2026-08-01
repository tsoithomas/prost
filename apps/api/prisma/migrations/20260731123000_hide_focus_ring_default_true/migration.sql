-- Data fix: `hideFocusRing` shipped a moment ago with a column-level default of `false`. The
-- intended app-level default is `true` (hide the focus ring out of the box) — flip any row still
-- holding that placeholder value. New rows get `true` via PreferenceService.DEFAULTS, not this
-- column's SQL default, so no schema change is needed here.
UPDATE "user_preferences" SET "hideFocusRing" = true WHERE "hideFocusRing" = false;
