import { migrateProgress } from "@/lib/server/progress-api.mjs";
import { getProgressApiDependencies } from "@/lib/server/runtime.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return migrateProgress(request, getProgressApiDependencies());
}
