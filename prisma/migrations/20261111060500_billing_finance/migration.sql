-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "VoidReason" AS ENUM ('CREATED_IN_ERROR', 'DUPLICATE', 'SERVICE_CANCELLED', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'PAYME', 'CLICK', 'UZUM', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('SERVICE_NOT_PROVIDED', 'OVERPAYMENT', 'PATIENT_REQUEST', 'BILLING_ERROR', 'OTHER');

-- CreateEnum
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('SALARY', 'RENT', 'UTILITIES', 'MEDICAL_SUPPLIES', 'EQUIPMENT', 'TAXES', 'MARKETING', 'OTHER');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT,
    "patientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "appointmentId" UUID,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" "VoidReason",
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "serviceId" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "externalRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "cashShiftId" UUID,
    "refundedMinor" BIGINT NOT NULL DEFAULT 0,
    "receivedById" UUID NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "cashShiftId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloatMinor" BIGINT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "expectedCashMinor" BIGINT,
    "countedCashMinor" BIGINT,
    "differenceMinor" BIGINT,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "spentOn" DATE NOT NULL,
    "description" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_appointmentId_key" ON "Invoice"("appointmentId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_createdAt_idx" ON "Invoice"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_patientId_idx" ON "Invoice"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_receivedAt_idx" ON "Payment"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "Payment_tenantId_invoiceId_idx" ON "Payment"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_idempotencyKey_key" ON "Payment"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_tenantId_createdAt_idx" ON "Refund"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_tenantId_idempotencyKey_key" ON "Refund"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CashShift_tenantId_branchId_openedAt_idx" ON "CashShift"("tenantId", "branchId", "openedAt");

-- CreateIndex
CREATE INDEX "Expense_tenantId_spentOn_idx" ON "Expense"("tenantId", "spentOn");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 7 integrity & security
-- ============================================================================

-- ---------- Money invariants -----------------------------------------------------
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_totals_chk" CHECK (
  "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "discountMinor" <= "subtotalMinor"
  AND "totalMinor" = "subtotalMinor" - "discountMinor"
  AND "paidMinor" >= 0 AND "paidMinor" <= "totalMinor");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_currency_chk" CHECK (currency IN ('UZS', 'USD'));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_chk" CHECK (number IS NULL OR number ~ '^INV-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issued_chk" CHECK (status = 'DRAFT' OR (number IS NOT NULL AND "issuedAt" IS NOT NULL) OR status = 'VOID');
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amounts_chk" CHECK (
  quantity BETWEEN 1 AND 1000 AND "unitPriceMinor" >= 0 AND "discountMinor" >= 0
  AND "discountMinor" <= "unitPriceMinor" * quantity
  AND "totalMinor" = "unitPriceMinor" * quantity - "discountMinor");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_chk" CHECK ("amountMinor" > 0 AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_chk" CHECK ("amountMinor" > 0);
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_amounts_chk" CHECK ("openingFloatMinor" >= 0 AND ("countedCashMinor" IS NULL OR "countedCashMinor" >= 0));
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_chk" CHECK ("amountMinor" > 0 AND currency IN ('UZS', 'USD'));

-- One open cash shift per cashier and branch.
CREATE UNIQUE INDEX "CashShift_one_open" ON "CashShift" ("tenantId", "branchId", "cashierId") WHERE status = 'OPEN';

-- ---------- Issued invoices are frozen --------------------------------------------
CREATE FUNCTION invoice_line_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE st "InvoiceStatus";
BEGIN
  SELECT status INTO st FROM "Invoice" WHERE id = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Invoice lines can only change while the invoice is a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
CREATE TRIGGER invoice_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION invoice_line_guard();

CREATE FUNCTION invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices cannot be deleted; void them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'VOID' THEN
    RAISE EXCEPTION 'Void invoices are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW."totalMinor" <> OLD."totalMinor" OR NEW."subtotalMinor" <> OLD."subtotalMinor"
      OR NEW."discountMinor" <> OLD."discountMinor" OR NEW."patientId" <> OLD."patientId" OR NEW.currency <> OLD.currency
      OR NEW.number IS DISTINCT FROM OLD.number) THEN
    RAISE EXCEPTION 'Issued invoice amounts are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER invoice_guard BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_guard();

-- ---------- Grants: clinic role only; nothing for the platform role ---------------
REVOKE ALL ON "Invoice", "InvoiceLine", "Payment", "Refund", "CashShift", "Expense" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "Invoice" TO itopmed_app;
GRANT SELECT, INSERT, DELETE ON "InvoiceLine" TO itopmed_app;
GRANT SELECT, INSERT ON "Payment", "Refund" TO itopmed_app;
GRANT UPDATE ("refundedMinor") ON "Payment" TO itopmed_app;
GRANT SELECT, INSERT ON "CashShift" TO itopmed_app;
GRANT UPDATE ("status", "closedAt", "expectedCashMinor", "countedCashMinor", "differenceMinor") ON "CashShift" TO itopmed_app;
GRANT SELECT, INSERT ON "Expense" TO itopmed_app;
GRANT UPDATE ("voidedAt") ON "Expense" TO itopmed_app;

DO $fn$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Invoice','InvoiceLine','Payment','Refund','CashShift','Expense']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END $fn$;
