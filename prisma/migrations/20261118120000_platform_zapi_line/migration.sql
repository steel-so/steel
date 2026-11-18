-- CreateEnum
CREATE TYPE "PlatformZapiLineStatus" AS ENUM ('DISCONNECTED', 'AWAITING_QR', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "platform_zapi_lines" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "instance_id" TEXT NOT NULL,
    "encrypted_token" TEXT NOT NULL,
    "encrypted_client_token" TEXT,
    "label" TEXT,
    "phone" TEXT,
    "status" "PlatformZapiLineStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "status_error" TEXT,
    "connected_at" TIMESTAMP(3),
    "status_checked_at" TIMESTAMP(3),
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_zapi_lines_pkey" PRIMARY KEY ("id")
);
