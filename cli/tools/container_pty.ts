// PTY allocation via FFI for the container daemon.
// Uses POSIX APIs: posix_openpt, grantpt, unlockpt, ptsname, ioctl.

const LIBNAME = Deno.build.os === "darwin"
  ? "libSystem.B.dylib"
  : "libc.so.6";

const lib = Deno.dlopen(LIBNAME, {
  posix_openpt: { parameters: ["i32"], result: "i32" },
  grantpt: { parameters: ["i32"], result: "i32" },
  unlockpt: { parameters: ["i32"], result: "i32" },
  ptsname: { parameters: ["i32"], result: "pointer" },
  close: { parameters: ["i32"], result: "i32" },
  ioctl: { parameters: ["i32", "u64", "buffer"], result: "i32" },
  read: { parameters: ["i32", "buffer", "usize"], result: "isize" },
  write: { parameters: ["i32", "buffer", "usize"], result: "isize" },
  fcntl_int: { name: "fcntl", parameters: ["i32", "i32", "i32"], result: "i32" },
});

// ioctl constants for TIOCSWINSZ
const TIOCSWINSZ = Deno.build.os === "darwin" ? 0x80087467 : 0x5414;

const O_RDWR = 2;
const O_NOCTTY = Deno.build.os === "darwin" ? 0x20000 : 0x100;

export interface PtyPair {
  masterFd: number;
  slavePath: string;
}

export function openPty(rows = 24, cols = 80): PtyPair {
  const fdm = lib.symbols.posix_openpt(O_RDWR | O_NOCTTY);
  if (fdm < 0) throw new Error("posix_openpt failed");

  if (lib.symbols.grantpt(fdm) !== 0) {
    lib.symbols.close(fdm);
    throw new Error("grantpt failed");
  }

  if (lib.symbols.unlockpt(fdm) !== 0) {
    lib.symbols.close(fdm);
    throw new Error("unlockpt failed");
  }

  const ptsPtr = lib.symbols.ptsname(fdm);
  if (ptsPtr === null) {
    lib.symbols.close(fdm);
    throw new Error("ptsname failed");
  }

  const slavePath = new Deno.UnsafePointerView(ptsPtr).getCString();

  // Set window size
  setWinSize(fdm, rows, cols);

  return { masterFd: fdm, slavePath };
}

export function setWinSize(fd: number, rows: number, cols: number): void {
  // struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel }
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint16(0, rows, true);
  view.setUint16(2, cols, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  lib.symbols.ioctl(fd, TIOCSWINSZ, buf);
}

export function closeFd(fd: number): void {
  lib.symbols.close(fd);
}

export function setNonBlocking(fd: number): void {
  const F_GETFL = 3;
  const F_SETFL = 4;
  const O_NONBLOCK = Deno.build.os === "darwin" ? 0x0004 : 0o4000;
  const flags = lib.symbols.fcntl_int(fd, F_GETFL, 0);
  lib.symbols.fcntl_int(fd, F_SETFL, flags | O_NONBLOCK);
}

export function readFd(fd: number, buf: Uint8Array): number {
  const n = lib.symbols.read(fd, buf, buf.length);
  return Number(n);
}

export function writeFd(fd: number, data: Uint8Array): number {
  const n = lib.symbols.write(fd, data, data.length);
  return Number(n);
}
