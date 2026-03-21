import { Handlers } from "$fresh/server.ts";
import { getContainerLogs } from "../../../../lib/daemon.ts";

export const handler: Handlers = {
  async GET(req, ctx) {
    const id = Number(ctx.params.id);
    const url = new URL(req.url);
    const from = Number(url.searchParams.get("from") || "0");
    const result = await getContainerLogs(id, from);
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  },
};
