import { downloadBackup } from "@/lib/server/ios-backup-api.mjs";
import { getProgressApiDependencies } from "@/lib/server/runtime.mjs";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return downloadBackup(token, getProgressApiDependencies());
}
