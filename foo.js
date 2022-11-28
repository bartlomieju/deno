const stream = new CompressionStream('gzip')
const writer = stream.writable.getWriter()
await writer.write(new Uint8Array(1))
await writer.close()
