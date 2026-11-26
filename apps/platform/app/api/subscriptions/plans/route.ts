import { pricingConfig } from "../../../../config/pricing";
import { requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";

export const GET = withApiErrors(async function GET() {
  await requireApiUser();
  return Response.json(pricingConfig, { headers: { "cache-control": "private, no-store" } });
});
