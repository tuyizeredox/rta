-- Office held in the association, printed on the membership card under the
-- holder's name. Nullable on purpose: `role` already answers "what may this
-- person do", and most members hold no office at all, so a card falls back to
-- the role label rather than demanding every row be filled in.
ALTER TABLE "users" ADD COLUMN "title" TEXT;

-- The card photograph.
--
-- Its own table rather than a column on "users": these bytes are the largest
-- thing an account owns, and a SELECT * over users to render a list of names
-- would otherwise pull every member's photograph with it.
--
-- The bytes live in Postgres because the app is deployed on Render, whose
-- filesystem does not survive a deploy, and no object store is configured.
CREATE TABLE "user_avatars" (
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    -- One photograph per account, so the user id is the whole key.
    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("userId")
);

-- Deleting the account takes the photograph with it. A face outliving the
-- record it belongs to is exactly the kind of data nobody remembers to clean.
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
