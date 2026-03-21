import { Handlers } from "$fresh/server.ts";
import { getDaemonPid, listContainers } from "../../../lib/daemon.ts";

export const handler: Handlers = {
  async GET(_req) {
    const [containers, pid] = await Promise.all([
      listContainers(),
      getDaemonPid(),
    ]);
    return new Response(JSON.stringify({ containers, daemonPid: pid }), {
      headers: { "content-type": "application/json" },
    });
  },
};
