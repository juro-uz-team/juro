import { validAdminOrigin } from "../../../../../lib/auth/admin-origin";
import { z } from "zod";

import { issueAdminDomainHandoff } from "../../../../../lib/auth/admin-domain-handoff";
import { parseJsonRequest } from "../../../../../lib/auth/input";
import { assertSafeWrite } from "../../../../../lib/auth/safe-write";
import { requirePlatformStaffRequest, withPlatformStaffErrors } from "../../../../../lib/auth/staff-http";
import { requireD1, runtimeEnv } from "../../../../../lib/document-builder/storage/runtime";

const requestSchema = z.object({ locale: z.enum(["ru", "uz", "en"]) }).strict();

function adminOrigin(): string | null {
  const runtime = runtimeEnv();
  const configured = runtime.ADMIN_CONSOLE_ORIGIN?.trim();
  if (!configured) return null;
  try {
    const origin = new URL(configured);
    if (
      origin.origin !== configured
      || !validAdminOrigin(origin, runtime.APP_ENV)
      || origin.username
      || origin.password
      || origin.pathname !== "/"
      || origin.search
      || origin.hash
    ) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

async function postAdminHandoff(request: Request) {
  assertSafeWrite(request);
  const parsed = await parseJsonRequest(request, requestSchema, 512);
  if (!parsed.ok) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
  const origin = adminOrigin();
  if (!origin) return Response.json({ code: "ADMIN_CONSOLE_UNAVAILABLE" }, { status: 503 });

  const now = new Date();
  const staff = await requirePlatformStaffRequest(request, "staff.console.view", {
    now,
    freshMfaWithinMs: 15 * 60 * 1_000,
  });
  const handoff = await issueAdminDomainHandoff(requireD1(), {
    staff,
    appEnvironment: runtimeEnv().APP_ENV,
    destinationOrigin: origin,
    now,
  });
  const target = new URL("/auth/handoff", origin);
  target.searchParams.set("ticket", handoff.ticket);
  return Response.json(
    { url: target.toString(), expiresAt: handoff.expiresAt },
    {
      headers: {
        "cache-control": "private, no-store",
        pragma: "no-cache",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

export const POST = withPlatformStaffErrors(postAdminHandoff);
