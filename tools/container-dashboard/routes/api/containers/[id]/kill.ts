import { Handlers } from "$fresh/server.ts";
import { killContainer } from "../../../../lib/daemon.ts";

export const handler: Handlers = {
  async POST(_req, ctx) {
    const id = Number(ctx.params.id);
    const ok = await killContainer(id);
    return new Response(JSON.stringify({ ok }), {
      headers: { "content-type": "application/json" },
    });
  },
};
