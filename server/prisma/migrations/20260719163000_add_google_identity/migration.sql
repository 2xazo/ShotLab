-- Add an immutable, unique Google subject identifier without changing
-- password login or deleting any existing user data.
ALTER TABLE "users"
ADD COLUMN "googleId" TEXT,
ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- Preserve safely identifiable accounts created by the previous OAuth route.
-- Ambiguous duplicate legacy provider IDs are deliberately left unlinked so
-- the application can reject them instead of silently merging users.
UPDATE "users" AS "u"
SET
  "googleId" = "u"."providerId",
  "emailVerified" = true
WHERE
  "u"."provider" = 'google'
  AND "u"."providerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" AS "other"
    WHERE
      "other"."id" <> "u"."id"
      AND "other"."providerId" = "u"."providerId"
  );

CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
