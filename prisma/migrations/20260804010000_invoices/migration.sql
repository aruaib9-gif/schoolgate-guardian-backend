-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "school_name" TEXT,
    "plan" TEXT NOT NULL,
    "description" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reference" TEXT,
    "authorization_url" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_channel" TEXT,
    "email_to" TEXT,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_reference_key" ON "invoices"("reference");
CREATE INDEX "invoices_school_id_idx" ON "invoices"("school_id");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
