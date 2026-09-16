import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { canAccessWhatsApp } from "./whatsapp-access";

describe("privacidad de la bandeja WhatsApp", () => {
  beforeEach(() => vi.resetAllMocks());
  it("rechaza visitas sin sesión", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect(await canAccessWhatsApp()).toBe(false);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    ["isebi@me.com", true, true],
    ["isebi@me.com", false, false],
    ["otra-persona@example.com", true, false],
  ])("comprueba propietario y cuenta activa: %s %s", async (email, active, allowed) => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "owner-test" } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ email, active } as never);
    expect(await canAccessWhatsApp()).toBe(allowed);
  });
});
