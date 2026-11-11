-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Security: PasswordReset ----------------------------------------
CREATE FUNCTION app_reset_token_hash() RETURNS text LANGUAGE sql STABLE AS
$fn$ SELECT NULLIF(current_setting('app.reset_token_hash', true), '') $fn$;

REVOKE ALL ON "PasswordReset" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "PasswordReset" TO itopmed_app;
-- The platform role gets no access at all.
ALTER TABLE "PasswordReset" ENABLE ROW LEVEL SECURITY;
-- Visible only to its owner or to the holder of the matching token.
CREATE POLICY app_access ON "PasswordReset" TO itopmed_app
  USING ("userId" = app_current_user() OR "tokenHash" = app_reset_token_hash())
  WITH CHECK ("userId" = app_current_user());
