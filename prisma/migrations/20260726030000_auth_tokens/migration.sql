-- One-time links for "set your password" (invite) and "reset password".
-- Only the SHA-256 hash is stored; the raw token lives only in the email.
CREATE TABLE IF NOT EXISTS "auth_tokens" (
  "id"           TEXT NOT NULL,
  "token_hash"   TEXT NOT NULL,
  "purpose"      TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "expires_at"   TIMESTAMP(3) NOT NULL,
  "used_at"      TIMESTAMP(3),
  "created_by"   TEXT,
  "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_date" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "auth_tokens_user_id_idx" ON "auth_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "auth_tokens_email_idx" ON "auth_tokens"("email");
