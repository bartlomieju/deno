// Simulate an AI agent executing tool calls in sandboxed containers
// Each tool call gets its own isolated, resource-limited container

async function executeToolCall(code: string): Promise<string> {
  using sandbox = Deno.container({
    name: "tool-call",
    resources: { memoryLimit: "32m", cpuTimeout: "3s" },
    nest: false,
  });

  return await sandbox.eval(code);
}

console.log("=== AI Tool Call Sandbox ===\n");

// Simulated tool calls from an AI agent
const toolCalls = [
  { desc: "Calculate fibonacci", code: "function fib(n){return n<=1?n:fib(n-1)+fib(n-2)} fib(20)" },
  { desc: "String manipulation", code: "'hello world'.split('').reverse().join('')" },
  { desc: "JSON processing", code: "JSON.stringify({users: [{name:'Alice',age:30},{name:'Bob',age:25}]}, null, 2)" },
  { desc: "Malicious infinite loop", code: "while(true){}" },
  { desc: "Malicious memory bomb", code: "const a=[]; while(true) a.push('x'.repeat(1e6))" },
];

for (const call of toolCalls) {
  console.log(`Tool: ${call.desc}`);
  try {
    const result = await executeToolCall(call.code);
    console.log(`  Result: ${result}\n`);
  } catch (e) {
    console.log(`  Blocked: ${e.message}\n`);
  }
}

console.log("All tool calls processed safely.");
