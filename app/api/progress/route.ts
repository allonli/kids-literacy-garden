import { getProgress, putProgress } from "@/lib/server/progress-api.mjs";
import { getProgressApiDependencies } from "@/lib/server/runtime.mjs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getProgress(request, getProgressApiDependencies());
}

export async function PUT(request: Request) {
  return putProgress(request, getProgressApiDependencies());
}
