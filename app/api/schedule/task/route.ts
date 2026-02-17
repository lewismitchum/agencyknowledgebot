// app/api/schedule/task/route.ts
import type { NextRequest } from "next/server";
import { GET as TasksGET } from "@/app/api/schedule/tasks/route";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return TasksGET(req);
}
