import { createAccount, listAccounts } from "@/lib/server/progress-api.mjs";
import { getProgressApiDependencies } from "@/lib/server/runtime.mjs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return listAccounts(request, getProgressApiDependencies());
}

export async function POST(request: Request) {
  return createAccount(request, getProgressApiDependencies());
}
