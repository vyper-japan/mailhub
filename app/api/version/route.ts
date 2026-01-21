import { NextResponse } from "next/server";
import { getVersionInfo } from "@/lib/version";

/**
 * Version endpoint
 * Returns the current version (commit SHA or package.json version)
 */
export async function GET() {
  return NextResponse.json(getVersionInfo());
}





