// Copyright 2018-2026 the Deno authors. MIT license.

use std::io::BufRead;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use deno_core::anyhow;
use deno_core::error::AnyError;
use deno_core::serde_json;

use crate::args::ContainerExecFlags;
use crate::args::ContainerFlags;
use crate::args::ContainerKillFlags;
use crate::args::ContainerLogsFlags;
use crate::args::DenoSubcommand;
use crate::args::EvalFlags;
use crate::args::Flags;

/// Path to the daemon Unix socket.
fn socket_path() -> PathBuf {
  if let Ok(p) = std::env::var("DENO_CONTAINER_SOCK") {
    PathBuf::from(p)
  } else {
    std::env::temp_dir().join("deno-container-daemon.sock")
  }
}

fn pid_path() -> PathBuf {
  let mut p = socket_path();
  p.set_extension("sock.pid");
  p
}

/// Path to the daemon TypeScript source, embedded next to this file.
fn daemon_script_path() -> PathBuf {
  // The daemon script lives next to the Rust source at compile time,
  // but at runtime we need to find it relative to the deno executable.
  // For development, use the source tree path.
  let candidates = [
    // Dev build: relative to repo root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("tools")
      .join("container_daemon.ts"),
  ];
  for c in &candidates {
    if c.exists() {
      return c.clone();
    }
  }
  // Fallback: assume it's next to the binary
  let exe = std::env::current_exe().unwrap();
  exe.parent().unwrap().join("container_daemon.ts")
}

/// Check if the daemon is running by connecting to the socket.
fn daemon_is_running() -> bool {
  let path = socket_path();
  if !path.exists() {
    return false;
  }
  // Try to connect
  match std::os::unix::net::UnixStream::connect(&path) {
    Ok(mut stream) => {
      // Send ping
      let _ = stream.write_all(b"{\"type\":\"ping\"}\n");
      let _ = stream.flush();
      let mut reader = std::io::BufReader::new(&stream);
      let mut line = String::new();
      // Set a short read timeout
      let _ = stream
        .set_read_timeout(Some(std::time::Duration::from_secs(2)));
      match reader.read_line(&mut line) {
        Ok(_) if !line.is_empty() => true,
        _ => false,
      }
    }
    Err(_) => {
      // Stale socket, clean up
      let _ = std::fs::remove_file(&path);
      false
    }
  }
}

/// Start the daemon process in the background.
fn start_daemon() -> Result<(), AnyError> {
  let deno_exe = std::env::current_exe()?;
  let script = daemon_script_path();

  if !script.exists() {
    return Err(anyhow::anyhow!(
      "Daemon script not found at: {}",
      script.display()
    ));
  }

  eprintln!("Starting container daemon...");

  // Spawn daemon as a detached background process.
  // Use `setsid` behavior via pre_exec on Unix to fully detach.
  #[cfg(unix)]
  let child = {
    use std::os::unix::process::CommandExt;
    unsafe {
      std::process::Command::new(&deno_exe)
        .arg("run")
        .arg("-A")
        .arg("--unstable-worker-options")
        .arg(&script)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .pre_exec(|| {
          // Create a new session so the daemon doesn't get killed
          // when the parent CLI process exits.
          libc::setsid();
          Ok(())
        })
        .spawn()?
    }
  };

  #[cfg(not(unix))]
  let child = std::process::Command::new(&deno_exe)
    .arg("run")
    .arg("-A")
    .arg("--unstable-worker-options")
    .arg("--unstable-ffi")
    .arg(&script)
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .spawn()?;

  drop(child);

  // Wait for the socket to appear
  let sock = socket_path();
  for _ in 0..50 {
    std::thread::sleep(std::time::Duration::from_millis(100));
    if sock.exists() {
      // Give it a moment to start listening
      std::thread::sleep(std::time::Duration::from_millis(100));
      if daemon_is_running() {
        eprintln!("Container daemon started.");
        return Ok(());
      }
    }
  }

  Err(anyhow::anyhow!("Failed to start container daemon"))
}

/// Ensure the daemon is running, starting it if needed.
fn ensure_daemon() -> Result<(), AnyError> {
  if !daemon_is_running() {
    start_daemon()?;
  }
  Ok(())
}

/// Send a JSON command to the daemon and return the parsed response.
fn daemon_request(
  cmd: &serde_json::Value,
) -> Result<serde_json::Value, AnyError> {
  let path = socket_path();
  let stream = std::os::unix::net::UnixStream::connect(&path)
    .map_err(|e| anyhow::anyhow!("Failed to connect to daemon: {}", e))?;

  let _ =
    stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));

  let mut writer = std::io::BufWriter::new(&stream);
  let mut msg = serde_json::to_string(cmd)?;
  msg.push('\n');
  writer.write_all(msg.as_bytes())?;
  writer.flush()?;

  let mut reader = std::io::BufReader::new(&stream);
  let mut response_line = String::new();
  reader.read_line(&mut response_line)?;

  if response_line.is_empty() {
    return Err(anyhow::anyhow!("Empty response from daemon"));
  }

  let response: serde_json::Value = serde_json::from_str(&response_line)?;
  Ok(response)
}

/// `deno container` — run code in a container via the daemon
pub async fn container_command(
  _flags: Arc<Flags>,
  container_flags: ContainerFlags,
) -> Result<i32, AnyError> {
  // If no script or eval, try the daemon-less inline path for backward compat
  // But for the daemon path, we need both create + eval/execFile
  ensure_daemon()?;

  // Build resource limits
  let mut resources = serde_json::Map::new();
  if let Some(ref mem) = container_flags.memory_limit {
    resources.insert(
      "memoryLimit".to_string(),
      serde_json::Value::String(mem.clone()),
    );
  }
  if let Some(ref timeout) = container_flags.cpu_timeout {
    resources.insert(
      "cpuTimeout".to_string(),
      serde_json::Value::String(timeout.clone()),
    );
  }

  let entry_name = container_flags
    .script
    .as_deref()
    .or(container_flags.eval_code.as_deref().map(|_| "(eval)"))
    .unwrap_or("(container)");

  // Build the action to execute (eval code, script path, or npm specifier)
  let action = if let Some(ref code) = container_flags.eval_code {
    serde_json::json!({ "kind": "eval", "code": code })
  } else if let Some(ref script) = container_flags.script {
    if script.starts_with("npm:") {
      serde_json::json!({ "kind": "execFile", "path": script })
    } else {
      let abs_path = std::env::current_dir()
        .unwrap_or_default()
        .join(script)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(script));
      serde_json::json!({ "kind": "execFile", "path": abs_path.display().to_string() })
    }
  } else {
    serde_json::json!(null)
  };

  // Create container in daemon
  let mut create_cmd = serde_json::json!({
    "type": "create",
    "name": entry_name,
    "resources": resources,
    "nest": !container_flags.no_nest,
    "entry": entry_name,
    "cwd": std::env::current_dir().ok().map(|p| p.display().to_string()),
    "action": action,
  });
  if let Some(ref cron) = container_flags.cron {
    create_cmd["cron"] = serde_json::Value::String(cron.clone());
  }
  let create_resp = daemon_request(&create_cmd)?;

  if create_resp["ok"] != true {
    return Err(anyhow::anyhow!(
      "Failed to create container: {}",
      create_resp["error"]
    ));
  }

  let container_id = create_resp["id"]
    .as_u64()
    .ok_or_else(|| anyhow::anyhow!("No container ID returned"))?;

  // For cron containers, the daemon handles scheduling — we're done
  if container_flags.cron.is_some() {
    eprintln!(
      "Container {} scheduled (cron: {}).",
      container_id,
      container_flags.cron.as_deref().unwrap()
    );
    return Ok(0);
  }

  // Execute the appropriate action for non-cron containers
  let result = if let Some(ref code) = container_flags.eval_code {
    daemon_request(&serde_json::json!({
      "type": "eval",
      "id": container_id,
      "code": code,
    }))
  } else if let Some(ref script) = container_flags.script {
    if script.starts_with("npm:") {
      daemon_request(&serde_json::json!({
        "type": "execFile",
        "id": container_id,
        "path": script,
      }))
    } else {
      let abs_path = std::env::current_dir()
        .unwrap_or_default()
        .join(script)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(script));
      daemon_request(&serde_json::json!({
        "type": "execFile",
        "id": container_id,
        "path": abs_path.display().to_string(),
      }))
    }
  } else {
    // No script or eval — just create the container and report
    eprintln!("Container {} created in daemon.", container_id);
    return Ok(0);
  };

  let resp = result?;

  // Print result
  if resp["ok"] == true {
    if let Some(value) = resp["value"].as_str() {
      println!("{}", value);
    }
  } else {
    eprintln!("{}", resp["error"].as_str().unwrap_or("Unknown error"));
    let _ = daemon_request(&serde_json::json!({
      "type": "close",
      "id": container_id,
    }));
    return Ok(1);
  }

  if container_flags.detach {
    eprintln!("Container {} running in daemon (detached).", container_id);
  } else {
    let _ = daemon_request(&serde_json::json!({
      "type": "close",
      "id": container_id,
    }));
  }

  Ok(0)
}

/// `deno container ps` — list running containers
pub async fn ps_command() -> Result<i32, AnyError> {
  ensure_daemon()?;

  let resp = daemon_request(&serde_json::json!({ "type": "list" }))?;

  if resp["ok"] != true {
    return Err(anyhow::anyhow!(
      "Failed to list containers: {}",
      resp["error"]
    ));
  }

  let containers = resp["containers"]
    .as_array()
    .ok_or_else(|| anyhow::anyhow!("Invalid response"))?;

  if containers.is_empty() {
    eprintln!("No running containers.");
    return Ok(0);
  }

  // Get daemon PID
  let pid = std::fs::read_to_string(pid_path()).unwrap_or_default();
  eprintln!("Daemon PID: {}", pid.trim());

  // Build row data first so we can compute column widths
  struct Row {
    id: String,
    typ: String,
    name: String,
    cwd: String,
    mem: String,
    reqs: String,
    errs: String,
    uptime: String,
  }

  let mut rows = Vec::new();
  for c in containers {
    let uptime_ms = c["uptimeMs"].as_u64().unwrap_or(0);
    let uptime = if uptime_ms > 86_400_000 {
      format!(
        "{}d {}h",
        uptime_ms / 86_400_000,
        (uptime_ms % 86_400_000) / 3_600_000
      )
    } else if uptime_ms > 3_600_000 {
      format!(
        "{}h {}m",
        uptime_ms / 3_600_000,
        (uptime_ms % 3_600_000) / 60_000
      )
    } else if uptime_ms > 60_000 {
      format!(
        "{}m {}s",
        uptime_ms / 60_000,
        (uptime_ms % 60_000) / 1000
      )
    } else if uptime_ms > 1_000 {
      format!("{}s", uptime_ms / 1000)
    } else {
      format!("{}ms", uptime_ms)
    };

    let name_raw = c["name"].as_str().unwrap_or("?");
    let name = if name_raw.len() > 28 {
      format!("{}...", &name_raw[..25])
    } else {
      name_raw.to_string()
    };

    let cwd_raw = c["cwd"].as_str().unwrap_or("");
    let cwd = if cwd_raw.len() > 28 {
      format!("...{}", &cwd_raw[cwd_raw.len() - 25..])
    } else {
      cwd_raw.to_string()
    };

    let mem = if let Some(memory) = c.get("memory") {
      let heap_used = memory["heapUsed"].as_u64().unwrap_or(0);
      if heap_used > 1_048_576 {
        format!("{:.1}MB", heap_used as f64 / 1_048_576.0)
      } else if heap_used > 1024 {
        format!("{}KB", heap_used / 1024)
      } else {
        format!("{}B", heap_used)
      }
    } else {
      "-".to_string()
    };

    rows.push(Row {
      id: c["id"].as_u64().unwrap_or(0).to_string(),
      typ: c["containerType"]
        .as_str()
        .unwrap_or("run")
        .to_string(),
      name,
      cwd,
      mem,
      reqs: c["requestCount"].as_u64().unwrap_or(0).to_string(),
      errs: c["errorCount"].as_u64().unwrap_or(0).to_string(),
      uptime,
    });
  }

  // Column widths: max of header and all values, plus padding
  let headers = ["ID", "TYPE", "NAME", "CWD", "MEM", "REQS", "ERRS", "UPTIME"];
  let mut widths: Vec<usize> = headers.iter().map(|h| h.len()).collect();
  for r in &rows {
    let vals = [&r.id, &r.typ, &r.name, &r.cwd, &r.mem, &r.reqs, &r.errs, &r.uptime];
    for (i, v) in vals.iter().enumerate() {
      widths[i] = widths[i].max(v.len());
    }
  }

  // Print table
  let sep: String = widths
    .iter()
    .map(|w| "\u{2500}".repeat(w + 2))
    .collect::<Vec<_>>()
    .join("\u{253C}");

  // Top border
  println!(
    "\u{250C}{}\u{2510}",
    widths
      .iter()
      .map(|w| "\u{2500}".repeat(w + 2))
      .collect::<Vec<_>>()
      .join("\u{252C}")
  );

  // Header
  let header_cells: Vec<String> = headers
    .iter()
    .zip(widths.iter())
    .map(|(h, w)| format!(" {:<width$} ", h, width = w))
    .collect();
  println!("\u{2502}{}\u{2502}", header_cells.join("\u{2502}"));

  // Header separator
  println!("\u{251C}{}\u{2524}", sep);

  // Rows
  for r in &rows {
    let vals = [&r.id, &r.typ, &r.name, &r.cwd, &r.mem, &r.reqs, &r.errs, &r.uptime];
    let cells: Vec<String> = vals
      .iter()
      .zip(widths.iter())
      .map(|(v, w)| format!(" {:<width$} ", v, width = w))
      .collect();
    println!("\u{2502}{}\u{2502}", cells.join("\u{2502}"));
  }

  // Bottom border
  println!(
    "\u{2514}{}\u{2518}",
    widths
      .iter()
      .map(|w| "\u{2500}".repeat(w + 2))
      .collect::<Vec<_>>()
      .join("\u{2534}")
  );

  Ok(0)
}

/// `deno container kill <id>` — kill a running container
pub async fn kill_command(
  kill_flags: ContainerKillFlags,
) -> Result<i32, AnyError> {
  ensure_daemon()?;

  let resp = daemon_request(&serde_json::json!({
    "type": "kill",
    "id": kill_flags.id,
  }))?;

  if resp["ok"] == true {
    eprintln!("Container {} killed.", kill_flags.id);
    Ok(0)
  } else {
    Err(anyhow::anyhow!(
      "Failed to kill container {}: {}",
      kill_flags.id,
      resp["error"].as_str().unwrap_or("Unknown error")
    ))
  }
}

/// `deno container logs <id>` — show logs from a container
pub async fn logs_command(
  logs_flags: ContainerLogsFlags,
) -> Result<i32, AnyError> {
  ensure_daemon()?;

  let mut from: u64 = 0;

  loop {
    let resp = daemon_request(&serde_json::json!({
      "type": "logs",
      "id": logs_flags.id,
      "from": from,
    }))?;

    if resp["ok"] != true {
      return Err(anyhow::anyhow!(
        "Failed to get logs for container {}: {}",
        logs_flags.id,
        resp["error"].as_str().unwrap_or("Unknown error")
      ));
    }

    if let Some(logs) = resp["logs"].as_array() {
      for entry in logs {
        let ts = entry["ts"].as_u64().unwrap_or(0);
        let level = entry["level"].as_str().unwrap_or("LOG");
        let msg = entry["msg"].as_str().unwrap_or("");

        // Format timestamp as HH:MM:SS.mmm
        let secs = (ts / 1000) % 86400;
        let ms = ts % 1000;
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;

        println!(
          "{:02}:{:02}:{:02}.{:03} [{}] {}",
          h, m, s, ms, level, msg
        );
      }
    }

    let total = resp["total"].as_u64().unwrap_or(0);
    from = total;

    if !logs_flags.follow {
      break;
    }

    // In follow mode, poll every second
    std::thread::sleep(std::time::Duration::from_secs(1));
  }

  Ok(0)
}

/// `deno container exec <command>` — run a program with PTY in the daemon
pub async fn exec_command(
  exec_flags: ContainerExecFlags,
) -> Result<i32, AnyError> {
  ensure_daemon()?;

  // Get terminal size
  let (rows, cols) = term_size();

  // Send exec command
  let path = socket_path();
  let stream = std::os::unix::net::UnixStream::connect(&path)
    .map_err(|e| anyhow::anyhow!("Failed to connect to daemon: {}", e))?;

  // No read timeout for exec — the session can last indefinitely
  let _ = stream.set_read_timeout(None);

  // Send the exec JSON command
  {
    let mut writer = std::io::BufWriter::new(&stream);
    let cmd = serde_json::json!({
      "type": "exec",
      "args": exec_flags.args,
      "cwd": exec_flags.cwd,
      "rows": rows,
      "cols": cols,
    });
    let mut msg = serde_json::to_string(&cmd)?;
    msg.push('\n');
    writer.write_all(msg.as_bytes())?;
    writer.flush()?;
  }

  // Read the JSON response (one line)
  {
    let mut reader = std::io::BufReader::new(&stream);
    let mut line = String::new();
    let _ = stream
      .set_read_timeout(Some(std::time::Duration::from_secs(10)));
    reader.read_line(&mut line)?;
    let resp: serde_json::Value = serde_json::from_str(&line)?;
    if resp["ok"] != true {
      return Err(anyhow::anyhow!(
        "Exec failed: {}",
        resp["error"].as_str().unwrap_or("Unknown error")
      ));
    }
    eprintln!(
      "Container {} attached (PTY). Press Ctrl+C to exit.",
      resp["id"]
    );
  }

  // Now switch to raw binary I/O
  let _ = stream.set_read_timeout(None);
  let _ = stream.set_nonblocking(false);

  // Put terminal into raw mode (only if stdin is a TTY)
  let is_tty = unsafe { libc::isatty(libc::STDIN_FILENO) == 1 };
  let orig_termios = if is_tty {
    Some(enter_raw_mode()?)
  } else {
    None
  };

  // Clone the stream for the threads
  let stream_read = stream.try_clone()?;
  let stream_write = stream.try_clone()?;
  let stream_winch = stream.try_clone()?;

  // SIGWINCH handler — forward terminal resize events to the daemon
  #[cfg(unix)]
  {
    let winch_writer = std::sync::Mutex::new(stream_winch);
    // Register SIGWINCH handler
    unsafe {
      libc::signal(
        libc::SIGWINCH,
        sigwinch_handler as libc::sighandler_t,
      );
    }
    // Store the writer in a global so the signal handler can use it
    *WINCH_STREAM.lock().unwrap() = Some(winch_writer);
  }

  // Thread 1: socket → stdout (PTY output → terminal)
  let stdout_handle = std::thread::spawn(move || {
    let mut buf = [0u8; 16384];
    let mut stdout = std::io::stdout().lock();
    loop {
      let mut reader = &stream_read;
      match std::io::Read::read(&mut reader, &mut buf) {
        Ok(0) => break,
        Ok(n) => {
          let _ = stdout.write_all(&buf[..n]);
          let _ = stdout.flush();
        }
        Err(_) => break,
      }
    }
  });

  // Thread 2: stdin → socket (terminal input → PTY)
  let stdin_handle = std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    let stdin = std::io::stdin();
    let mut stdin = stdin.lock();
    let mut writer = &stream_write;
    loop {
      match std::io::Read::read(&mut stdin, &mut buf) {
        Ok(0) => break,
        Ok(n) => {
          if std::io::Write::write_all(&mut writer, &buf[..n]).is_err() {
            break;
          }
          let _ = std::io::Write::flush(&mut writer);
        }
        Err(_) => break,
      }
    }
  });

  // Wait for the output thread to finish (subprocess exited)
  let _ = stdout_handle.join();

  // Restore terminal
  if let Some(ref orig) = orig_termios {
    restore_termios(orig);
  }

  // The input thread will exit when stdin is closed or the stream disconnects
  // Don't wait for it — it may be blocked on stdin read
  drop(stdin_handle);

  eprintln!("\nSession ended.");
  Ok(0)
}

#[cfg(unix)]
fn term_size() -> (u16, u16) {
  // Try ioctl TIOCGWINSZ
  unsafe {
    let mut ws: libc::winsize = std::mem::zeroed();
    if libc::ioctl(libc::STDOUT_FILENO, libc::TIOCGWINSZ, &mut ws) == 0
      && ws.ws_row > 0
    {
      return (ws.ws_row, ws.ws_col);
    }
  }
  (24, 80)
}

#[cfg(not(unix))]
fn term_size() -> (u16, u16) {
  (24, 80)
}

#[cfg(unix)]
fn enter_raw_mode() -> Result<libc::termios, AnyError> {
  unsafe {
    let mut orig: libc::termios = std::mem::zeroed();
    if libc::tcgetattr(libc::STDIN_FILENO, &mut orig) != 0 {
      return Err(anyhow::anyhow!("tcgetattr failed"));
    }
    let mut raw = orig;
    libc::cfmakeraw(&mut raw);
    if libc::tcsetattr(libc::STDIN_FILENO, libc::TCSAFLUSH, &raw) != 0 {
      return Err(anyhow::anyhow!("tcsetattr failed"));
    }
    Ok(orig)
  }
}

#[cfg(unix)]
fn restore_termios(orig: &libc::termios) {
  unsafe {
    libc::tcsetattr(libc::STDIN_FILENO, libc::TCSAFLUSH, orig);
  }
}

#[cfg(not(unix))]
fn enter_raw_mode() -> Result<(), AnyError> {
  Ok(())
}

#[cfg(not(unix))]
fn restore_termios(_: &()) {}

// Global state for SIGWINCH handler
#[cfg(unix)]
static WINCH_STREAM: std::sync::Mutex<
  Option<std::sync::Mutex<std::os::unix::net::UnixStream>>,
> = std::sync::Mutex::new(None);

#[cfg(unix)]
extern "C" fn sigwinch_handler(_sig: libc::c_int) {
  // Get new terminal size and send resize escape to daemon
  let (rows, cols) = term_size();
  let msg = format!("\x1b[8;{};{}t", rows, cols);
  if let Ok(guard) = WINCH_STREAM.lock() {
    if let Some(ref stream_mutex) = *guard {
      if let Ok(mut stream) = stream_mutex.lock() {
        let _ = stream.write_all(msg.as_bytes());
        let _ = stream.flush();
      }
    }
  }
}
