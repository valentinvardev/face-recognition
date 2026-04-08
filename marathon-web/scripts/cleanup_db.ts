import { PrismaClient } from "../generated/prisma";
const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning up database...");
  await prisma.detection.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.runner.deleteMany();
  console.log("Database cleared! Ready for fresh OCR import.");
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
