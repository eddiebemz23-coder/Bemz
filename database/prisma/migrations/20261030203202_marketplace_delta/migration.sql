/*
  Warnings:

  - The `provider` column on the `payout_accounts` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PayoutProvider" AS ENUM ('MTN_MOMO', 'AIRTEL_MONEY', 'BANK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAction" ADD VALUE 'PAYOUT_FAIL';
ALTER TYPE "AdminAction" ADD VALUE 'PAYOUT_REVERSE';
ALTER TYPE "AdminAction" ADD VALUE 'REVIEW_PUBLISH';
ALTER TYPE "AdminAction" ADD VALUE 'REVIEW_REMOVE';

-- AlterTable
ALTER TABLE "payout_accounts" DROP COLUMN "provider",
ADD COLUMN     "provider" "PayoutProvider" NOT NULL DEFAULT 'MTN_MOMO';

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "kycBusinessName" TEXT,
ADD COLUMN     "nationalIdNumber" TEXT,
ADD COLUMN     "taxPin" TEXT;

-- CreateTable
CREATE TABLE "review_votes" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_votes_userId_idx" ON "review_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "review_votes_reviewId_userId_key" ON "review_votes"("reviewId", "userId");

-- CreateIndex
CREATE INDEX "payout_accounts_provider_accountNumber_idx" ON "payout_accounts"("provider", "accountNumber");

-- AddForeignKey
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
