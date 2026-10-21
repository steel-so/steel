-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[];
