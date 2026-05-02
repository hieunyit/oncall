import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/make-admin.ts <email>");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const user = await prisma.user.update({
  where: { email },
  data: { systemRole: "ADMIN" },
  select: { id: true, email: true, fullName: true, systemRole: true },
});

console.log(`✓ ${user.fullName} (${user.email}) → ${user.systemRole}`);
await prisma.$disconnect();
