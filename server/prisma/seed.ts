// Development seed data: a demo login only.
//
// It deliberately creates NO medicine records. The catalogue holds only
// data imported from a permitted source (scripts/importCatalogue.ts — see
// docs/medicine-data-sources.md). The ten generic medicines an earlier
// version of this seed created are still in old development databases,
// flagged isSynthetic and hidden from the app; automated tests create their
// own clearly-marked fixtures.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/password";

const prisma = new PrismaClient();

async function main() {
  // Demo user — password printed below for local login during development.
  const demoPassword = "DemoPass123!";
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    update: {},
    create: {
      email: "demo@example.com",
      fullName: "Demo User",
      passwordHash: await hashPassword(demoPassword),
    },
  });

  console.log("Seed complete.");
  console.log(`Demo login -> email: ${demoUser.email} / password: ${demoPassword}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
