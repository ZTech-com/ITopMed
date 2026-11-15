-- Local / connected working mode and per-patient Excel files (local app).
CREATE TYPE "DataMode" AS ENUM ('LOCAL', 'CONNECTED');

ALTER TABLE "ClinicPolicy"
  ADD COLUMN "dataMode" "DataMode",
  ADD COLUMN "patientFilesEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "patientFilesDir" TEXT,
  ADD COLUMN "patientFilesEnabledById" UUID,
  ADD COLUMN "patientFilesSyncedAt" TIMESTAMP(3);

-- Grants and RLS of "ClinicPolicy" are table-wide (see 20261114075150) and cover the new columns.
