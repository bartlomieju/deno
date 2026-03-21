import { Handlers } from "$fresh/server.ts";
import { daemonRequest } from "../../../lib/daemon.ts";

export const handler: Handlers = {
  async POST(req) {
    const body = await req.json();
    const { code, name, memoryLimit, cpuTimeout, cron } = body;

    if (!code?.trim()) {
      return new Response(JSON.stringify({ ok: false, error: "Code is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const resources: Record<string, string> = {};
    if (memoryLimit) resources.memoryLimit = memoryLimit;
    if (cpuTimeout) resources.cpuTimeout = cpuTimeout;

    const action = { kind: "eval", code };

    try {
      // Create container
      const createResp = await daemonRequest({
        type: "create",
        name: name || "(dashboard)",
        resources,
        nest: true,
        entry: name || "(dashboard)",
        cwd: "",
        action,
        ...(cron ? { cron } : {}),
      });

      if (!createResp.ok) {
        return new Response(JSON.stringify(createResp), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }

      const id = createResp.id;

      // For non-cron containers, run the eval immediately
      if (!cron) {
        try {
          await daemonRequest({ type: "eval", id, code });
        } catch {
          // eval may fail, that's ok — logs will capture it
        }
      }

      return new Response(JSON.stringify({ ok: true, id }), {
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
