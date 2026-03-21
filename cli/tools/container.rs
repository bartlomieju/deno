// Copyright 2018-2026 the Deno authors. MIT license.

use std::sync::Arc;

use deno_core::anyhow;
use deno_core::error::AnyError;

use crate::args::ContainerFlags;
use crate::args::DenoSubcommand;
use crate::args::EvalFlags;
use crate::args::Flags;

pub async fn container_command(
  flags: Arc<Flags>,
  container_flags: ContainerFlags,
) -> Result<i32, AnyError> {
  // Build the wrapper script that creates a Deno.container() and runs code in it
  let mut options_parts = Vec::new();

  // Resource limits
  let mut resources = Vec::new();
  if let Some(ref mem) = container_flags.memory_limit {
    resources.push(format!("memoryLimit: \"{}\"", mem));
  }
  if let Some(ref timeout) = container_flags.cpu_timeout {
    resources.push(format!("cpuTimeout: \"{}\"", timeout));
  }
  if !resources.is_empty() {
    options_parts.push(format!("resources: {{ {} }}", resources.join(", ")));
  }

  // Nesting
  if container_flags.no_nest {
    options_parts.push("nest: false".to_string());
  }

  let options_str = if options_parts.is_empty() {
    "{}".to_string()
  } else {
    format!("{{ {} }}", options_parts.join(", "))
  };

  let wrapper_code = if let Some(ref code) = container_flags.eval_code {
    // --eval mode: evaluate code in the container
    let escaped_code = code
      .replace('\\', "\\\\")
      .replace('`', "\\`")
      .replace('$', "\\$");
    format!(
      r#"
const c = Deno.container({options});
try {{
  const result = await c.eval(`{code}`);
  if (result !== undefined) console.log(result);
}} catch (e) {{
  console.error(e.message);
  Deno.exit(1);
}} finally {{
  c.close();
}}
"#,
      options = options_str,
      code = escaped_code,
    )
  } else if let Some(ref script) = container_flags.script {
    if script.starts_with("npm:") {
      // npm package mode
      let escaped = script.replace('\\', "\\\\").replace('"', "\\\"");
      format!(
        r#"
const c = Deno.container({options});
try {{
  await c.execNpm("{script}");
}} catch (e) {{
  console.error(e.message);
  Deno.exit(1);
}} finally {{
  c.close();
}}
"#,
        options = options_str,
        script = escaped,
      )
    } else {
      // File mode: resolve the path and execFile it
      let escaped = script.replace('\\', "\\\\").replace('"', "\\\"");
      format!(
        r#"
const c = Deno.container({options});
try {{
  await c.execFile("{script}");
}} catch (e) {{
  console.error(e.message);
  Deno.exit(1);
}} finally {{
  c.close();
}}
"#,
        options = options_str,
        script = escaped,
      )
    }
  } else {
    return Err(anyhow::anyhow!(
      "Please provide a script, npm package, or use --eval"
    ));
  };

  // Swap the subcommand to Eval so that eval_command can resolve
  // the main module correctly.
  let eval_flags = EvalFlags {
    print: false,
    code: wrapper_code,
  };
  let mut flags = (*flags).clone();
  flags.subcommand = DenoSubcommand::Eval(eval_flags.clone());
  let flags = Arc::new(flags);

  crate::tools::run::eval_command(flags, eval_flags).await
}
