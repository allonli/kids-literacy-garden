import { createBackup, getBackupStatus, revokeBackup } from "@/lib/server/ios-backup-api.mjs";
import { getProgressApiDependencies } from "@/lib/server/runtime.mjs";
export const runtime = "nodejs";
export async function POST(request: Request) { return createBackup(request, getProgressApiDependencies()); }
export async function GET(request: Request) { return getBackupStatus(request, getProgressApiDependencies()); }
export async function DELETE(request: Request) { return revokeBackup(request, getProgressApiDependencies()); }
