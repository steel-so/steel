-- CreateEnum
CREATE TYPE "UserTourStatus" AS ENUM ('COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "user_tour_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tour_key" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "UserTourStatus" NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tour_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_tour_progress_user_id_tour_key_key" ON "user_tour_progress"("user_id", "tour_key");

-- AddForeignKey
ALTER TABLE "user_tour_progress" ADD CONSTRAINT "user_tour_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
