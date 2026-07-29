-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_preferences" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "colorMode" TEXT NOT NULL DEFAULT 'system',
    "accentColor" TEXT NOT NULL DEFAULT '#498fff',
    "fontSize" TEXT NOT NULL DEFAULT 'md',
    "gridDensity" TEXT NOT NULL DEFAULT 'normal',
    "fontFamily" TEXT,
    "monoFontFamily" TEXT,
    "radiusScale" TEXT NOT NULL DEFAULT 'normal',
    "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
    "sidebarWidth" TEXT NOT NULL DEFAULT 'default',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "keybindings" TEXT NOT NULL DEFAULT '{}',
    "customPalettes" TEXT NOT NULL DEFAULT '[]',
    "connectionOverrides" TEXT NOT NULL DEFAULT '{}',
    "columnRenderOverrides" TEXT NOT NULL DEFAULT '{}',
    "dataColors" TEXT NOT NULL DEFAULT '{}',
    "editor" TEXT NOT NULL DEFAULT '{}',
    "grid" TEXT NOT NULL DEFAULT '{}',
    "behavior" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_preferences" ("accentColor", "colorMode", "columnRenderOverrides", "connectionOverrides", "customPalettes", "dataColors", "fontFamily", "fontSize", "gridDensity", "keybindings", "monoFontFamily", "radiusScale", "userId") SELECT "accentColor", "colorMode", "columnRenderOverrides", "connectionOverrides", "customPalettes", "dataColors", "fontFamily", "fontSize", "gridDensity", "keybindings", "monoFontFamily", "radiusScale", "userId" FROM "user_preferences";
DROP TABLE "user_preferences";
ALTER TABLE "new_user_preferences" RENAME TO "user_preferences";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
