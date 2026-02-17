import { NextRequest } from "next/server";

import { getOrCreateUser } from "@/lib/users";
import { getOrCreatePrivateUserBot } from "@/lib/userBots";

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session?.agencyId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Bridge legacy session -> real user row
  const user = await getOrCreateUser(session.agencyId, session.agencyEmail);

  const bot = await getOrCreatePrivateUserBot(session.agencyId, user.id);

  // NOTE: vector_store_id may be null if billing is blocked; this is fine.
  return Response.json({
    ok: true,
    bot: {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      owner_user_id: bot.owner_user_id,
      vector_store_id: bot.vector_store_id,
    },
  });
}
