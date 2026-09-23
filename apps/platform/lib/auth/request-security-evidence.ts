import {
  identityLookupHmac,
  type IdentityKeyring,
} from "./keyring";

const MAX_IP_CHARACTERS = 64;
const MAX_USER_AGENT_CHARACTERS = 512;
const COUNTRY_CODE_RE = /^[A-Z0-9]{2}$/;
const REGION_CODE_RE = /^[A-Z0-9-]{1,12}$/;

export type AuthRequestSecurityContext = {
  connectingIp: string | null;
  userAgent: string | null;
  countryCode: string | null;
  regionCode: string | null;
};

export type AuthRequestSecurityEvidence = {
  ipHash: string | null;
  userAgentHash: string | null;
  keyVersion: string;
  countryCode: string | null;
  regionCode: string | null;
};

function boundedHeader(value: string | null, maxCharacters: number) {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  if (!normalized || normalized.length > maxCharacters) return null;
  return normalized;
}

function locationCode(value: unknown, expression: RegExp): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  return expression.test(normalized) ? normalized : null;
}

export function authRequestSecurityContext(
  request: Request,
): AuthRequestSecurityContext {
  return {
    connectingIp: boundedHeader(
      request.headers.get("x-juro-client-ip"),
      MAX_IP_CHARACTERS,
    ),
    userAgent: boundedHeader(
      request.headers.get("user-agent"),
      MAX_USER_AGENT_CHARACTERS,
    ),
    // SSH access has no trustworthy end-user geolocation provider.
    countryCode: null,
    regionCode: null,
  };
}

export async function prepareAuthRequestSecurityEvidence(
  keyring: IdentityKeyring | null,
  userId: string,
  context: AuthRequestSecurityContext,
): Promise<AuthRequestSecurityEvidence | null> {
  if (!keyring) return null;
  const connectingIp = boundedHeader(context.connectingIp, MAX_IP_CHARACTERS);
  const userAgentValue = boundedHeader(
    context.userAgent,
    MAX_USER_AGENT_CHARACTERS,
  );
  const ip = connectingIp
    ? await identityLookupHmac(
        keyring,
        `${userId}\n${connectingIp}`,
        "auth-session-request-ip",
      )
    : null;
  const userAgent = userAgentValue
    ? await identityLookupHmac(
        keyring,
        `${userId}\n${userAgentValue}`,
        "auth-session-request-user-agent",
      )
    : null;
  return {
    ipHash: ip?.digest ?? null,
    userAgentHash: userAgent?.digest ?? null,
    keyVersion: ip?.keyVersion ?? userAgent?.keyVersion
      ?? keyring.activeVersion,
    countryCode: locationCode(context.countryCode, COUNTRY_CODE_RE),
    regionCode: locationCode(context.regionCode, REGION_CODE_RE),
  };
}

export function requestSecurityEventMetadata(
  evidence: AuthRequestSecurityEvidence | null | undefined,
): Record<string, unknown> {
  if (!evidence) return {};
  return {
    requestEvidence: {
      keyVersion: evidence.keyVersion,
      countryCode: evidence.countryCode,
      regionCode: evidence.regionCode,
    },
  };
}
