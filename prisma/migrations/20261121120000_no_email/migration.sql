-- No email anywhere: accounts are identified by login; a forgotten password is
-- replaced by the clinic's Administrator, and invitations are internal (created and
-- accepted on the server with a login + password). New rows carry no email;
-- existing values are kept (not deleted) but are no longer read or shown.
-- CHECK (email = lower(email)) stays valid for NULL.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "PlatformUser" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "Invitation" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "PlatformInvitation" ALTER COLUMN "email" DROP NOT NULL;
