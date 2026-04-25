import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    teamMember: { findUnique: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getSessionUser,
  requireSystemRole,
  requireTeamRole,
  isNextResponse,
} from "@/lib/rbac";
import { SystemRole, TeamRole } from "@/app/generated/prisma/client";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockUserFind = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const mockMemberFind = prisma.teamMember.findUnique as ReturnType<typeof vi.fn>;

const activeUser = {
  id: "user-1",
  email: "test@example.com",
  systemRole: SystemRole.USER,
  fullName: "Test User",
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isNextResponse", () => {
  it("returns true for NextResponse instances", () => {
    expect(isNextResponse(NextResponse.json({}))).toBe(true);
  });

  it("returns false for plain objects", () => {
    expect(isNextResponse({ status: 200 })).toBe(false);
    expect(isNextResponse(null)).toBe(false);
    expect(isNextResponse("string")).toBe(false);
  });
});

describe("getSessionUser", () => {
  it("returns null when no session", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });

  it("returns null when user not found in db", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.com" } });
    mockUserFind.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });

  it("returns null when user is inactive", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue({ ...activeUser, isActive: false });
    expect(await getSessionUser()).toBeNull();
  });

  it("returns session user when active", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue(activeUser);
    const result = await getSessionUser();
    expect(result).toMatchObject({ id: "user-1", email: "test@example.com" });
  });
});

describe("requireSystemRole", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await requireSystemRole(SystemRole.ADMIN);
    expect(res?.status).toBe(401);
  });

  it("returns 403 when wrong role", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue(activeUser); // USER not ADMIN
    const res = await requireSystemRole(SystemRole.ADMIN);
    expect(res?.status).toBe(403);
  });

  it("returns null when role matches", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue({ ...activeUser, systemRole: SystemRole.ADMIN });
    const res = await requireSystemRole(SystemRole.ADMIN);
    expect(res).toBeNull();
  });
});

describe("requireTeamRole", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await requireTeamRole("team-1", TeamRole.MEMBER);
    expect(isNextResponse(result)).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 403 when user is not a team member", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue(activeUser);
    mockMemberFind.mockResolvedValue(null);
    const result = await requireTeamRole("team-1", TeamRole.MEMBER);
    expect(isNextResponse(result)).toBe(true);
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns 403 when member role is below minimum", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue(activeUser);
    mockMemberFind.mockResolvedValue({ role: TeamRole.MEMBER });
    const result = await requireTeamRole("team-1", TeamRole.MANAGER);
    expect(isNextResponse(result)).toBe(true);
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns user+role when member meets minimum", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue(activeUser);
    mockMemberFind.mockResolvedValue({ role: TeamRole.MANAGER });
    const result = await requireTeamRole("team-1", TeamRole.MANAGER);
    expect(isNextResponse(result)).toBe(false);
    expect((result as { user: typeof activeUser; teamRole: TeamRole }).teamRole).toBe(TeamRole.MANAGER);
  });

  it("ADMIN bypasses team membership check and gets MANAGER role", async () => {
    mockAuth.mockResolvedValue({ user: { email: activeUser.email } });
    mockUserFind.mockResolvedValue({ ...activeUser, systemRole: SystemRole.ADMIN });
    const result = await requireTeamRole("team-1", TeamRole.MANAGER);
    expect(isNextResponse(result)).toBe(false);
    expect((result as { teamRole: TeamRole }).teamRole).toBe(TeamRole.MANAGER);
    expect(mockMemberFind).not.toHaveBeenCalled();
  });
});
