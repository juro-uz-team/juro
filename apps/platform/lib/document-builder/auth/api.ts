import { getChatGPTUser } from "../../../app/chatgpt-auth";
import { IdentityProtectionError } from "../../auth/identity-protection";
import {
  ApiAuthError,
} from "../../auth/safe-write";
import type { UserProfile } from "../types";
import { getOrCreateUserProfile } from "../storage/db";
import { subscriptionFailure } from "../../billing/usage";

export {
  ApiAuthError,
  assertSafeWrite,
} from "../../auth/safe-write";

export async function optionalApiUser(request?: Request): Promise<UserProfile | null> {
  const user = await getChatGPTUser(request);
  return user ? getOrCreateUserProfile(user) : null;
}

export async function requireApiUser(request?: Request): Promise<UserProfile> {
  const profile = await optionalApiUser(request);
  if (!profile) throw new ApiAuthError();
  return profile;
}

export function withApiErrors<TArgs extends unknown[]>(handler: (...args: TArgs) => Promise<Response>) {
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      const subscription = subscriptionFailure(error);
      if (subscription) return Response.json({ code: subscription.code }, {
        status: subscription.status, headers: { "cache-control": "private, no-store" },
      });
      if (error instanceof ApiAuthError) {
        return Response.json(
          { error: error.message },
          { status: error.status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } },
        );
      }
      if (error instanceof IdentityProtectionError) {
        return Response.json(
          {
            code: "IDENTITY_PROTECTION_UNAVAILABLE",
            error: "Защищённое хранилище идентификационных данных временно недоступно.",
          },
          {
            status: 503,
            headers: {
              "cache-control": "private, no-store",
              pragma: "no-cache",
            },
          },
        );
      }
      throw error;
    }
  };
}
