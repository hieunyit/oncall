import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { AlertStatus, SwapStatus } from "@/app/generated/prisma/client";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ pendingSwaps: 0, firingAlerts: 0 });

  const [pendingSwaps, firingAlerts] = await Promise.all([
    // Swaps waiting for this user to act on: either they're the target (needs respond)
    // or they manage the team and swap is accepted (needs approve/reject)
    prisma.swapRequest.count({
      where: {
        status: SwapStatus.REQUESTED,
        targetUserId: actor.id,
        expiresAt: { gt: new Date() },
      },
    }).then(async (asTarget) => {
      const asManager = await prisma.swapRequest.count({
        where: {
          status: SwapStatus.ACCEPTED_BY_TARGET,
          originalShift: {
            policy: {
              team: {
                members: {
                  some: { userId: actor.id, role: "MANAGER" },
                },
              },
            },
          },
        },
      });
      return asTarget + asManager;
    }),

    prisma.alert.count({
      where: {
        status: AlertStatus.FIRING,
        ...(actor.systemRole !== "ADMIN" && {
          integration: {
            team: {
              members: { some: { userId: actor.id } },
            },
          },
        }),
      },
    }),
  ]);

  return NextResponse.json({ pendingSwaps, firingAlerts });
}
