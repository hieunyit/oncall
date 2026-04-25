import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@oncall.local" },
    update: {},
    create: {
      email: "admin@oncall.local",
      fullName: "Administrator",
      systemRole: "ADMIN",
      timezone: "Asia/Ho_Chi_Minh",
    },
  });

  // Create sample users
  const users = await Promise.all(
    [
      { email: "alice@oncall.local", fullName: "Alice Nguyen" },
      { email: "bob@oncall.local", fullName: "Bob Tran" },
      { email: "charlie@oncall.local", fullName: "Charlie Le" },
      { email: "diana@oncall.local", fullName: "Diana Pham" },
    ].map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: { ...u, systemRole: "USER", timezone: "Asia/Ho_Chi_Minh" },
      })
    )
  );

  // Create a team
  const team = await prisma.team.upsert({
    where: { name: "Backend Team" },
    update: {},
    create: { name: "Backend Team", description: "Backend engineering on-call rotation" },
  });

  // Add members
  for (let i = 0; i < users.length; i++) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: users[i].id } },
      update: {},
      create: {
        teamId: team.id,
        userId: users[i].id,
        role: i === 0 ? "MANAGER" : "MEMBER",
        order: i,
      },
    });
  }

  // Create rotation policy
  await prisma.rotationPolicy.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      teamId: team.id,
      name: "Weekly rotation",
      cadence: "WEEKLY",
      shiftDurationHours: 168,
      confirmationDueHours: 24,
      reminderLeadHours: [48, 24, 2],
      maxGenerateWeeks: 4,
    },
  });

  console.log(`Seeded: admin, ${users.length} users, 1 team, 1 rotation policy`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
