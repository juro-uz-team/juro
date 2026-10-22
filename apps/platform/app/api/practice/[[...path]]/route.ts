import { practiceHttp } from "../../../../lib/practice/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
export async function GET(request: Request, context: Context) { return practiceHttp(request, (await context.params).path ?? []); }
export async function POST(request: Request, context: Context) { return practiceHttp(request, (await context.params).path ?? []); }
