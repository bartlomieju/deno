// Multi-tenant simulation — each tenant gets an isolated container

interface Tenant {
  name: string;
  code: string;
}

const tenants: Tenant[] = [
  { name: "acme-corp", code: "return 'Acme processed ' + (2+2) + ' items'" },
  { name: "widgets-inc", code: "return 'Widgets balance: $' + (1000 * Math.random()).toFixed(2)" },
  { name: "evil-tenant", code: "while(true) {}" }, // tries to DoS
];

console.log("=== Multi-tenant execution ===\n");

for (const tenant of tenants) {
  const container = Deno.container({
    name: tenant.name,
    resources: {
      memoryLimit: "32m",
      cpuTimeout: "1s",
    },
    nest: false,
  });

  try {
    const result = await container.evalAsync(tenant.code);
    console.log(`[${tenant.name}] Result: ${result}`);
  } catch (e) {
    console.log(`[${tenant.name}] Error: ${e.message}`);
  }

  // Show stats
  const stats = container.stats();
  console.log(`  -> ${stats.uptimeMs}ms, cpu: ${JSON.stringify(stats.cpuUsage)}\n`);

  container.close();
}

console.log("All tenants processed. Host still alive.");
