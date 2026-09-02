-- Printable sign-in QR codes.
--
-- One row per issued code. The image encodes an opaque secret; this table
-- stores its SHA-256 (to find the row on a scan) and an AES-256-GCM ciphertext
-- of the same secret (so the owner can re-download the card later without
-- being issued a new one). Neither column is useful without SESSION_SECRET,
-- which is not in the database.
--
-- `expires_at` is NOT NULL by design: a credential that can be photographed off
-- a printed card must not outlive the membership it belongs to.
CREATE TABLE "access_qr_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "secretCipher" TEXT NOT NULL,
    "label" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_qr_codes_pkey" PRIMARY KEY ("id")
);

-- The scan path looks a code up by digest alone, so this index carries the
-- whole redemption query.
CREATE UNIQUE INDEX "access_qr_codes_tokenHash_key" ON "access_qr_codes"("tokenHash");

-- "the caller's live code" — the query behind every render of the QR page.
CREATE INDEX "access_qr_codes_userId_revokedAt_idx" ON "access_qr_codes"("userId", "revokedAt");

-- Housekeeping sweeps of expired codes.
CREATE INDEX "access_qr_codes_expiresAt_idx" ON "access_qr_codes"("expiresAt");

ALTER TABLE "access_qr_codes" ADD CONSTRAINT "access_qr_codes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
