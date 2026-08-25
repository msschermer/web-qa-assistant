import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WEBQA_ACCEPT_PORT || 8787);
const ROOT = __dirname;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(width, height, rgb = [40, 90, 180]) {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
  const compressed = zlib.deflateSync(raw, { level: 1 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

fs.mkdirSync(path.join(ROOT, "assets"), { recursive: true });
const BIG_PNG = makePng(2400, 1600);
fs.writeFileSync(path.join(ROOT, "assets", "hero-large.png"), BIG_PNG);

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>WebQA Correlation Acceptance Fixture</title>
  <meta name="viewport" content="width=980">
  <meta name="generator" content="WordPress 6.4">
  <link rel="canonical" href="http://localhost:${PORT}/links">
  <style>
    body{font:16px/1.45 system-ui;margin:0}
    header,nav{background:#123;color:#fff;padding:12px 20px}
    nav a{color:#fff;margin-right:16px}
    main{padding:20px;max-width:900px}
    .hero{width:780px;height:520px;object-fit:cover;display:block}
    .cite{font-size:13px;color:#555}
    #existing-section{margin-top:40px;padding:20px;background:#eef}
  </style>
</head>
<body>
  <header>
    <nav aria-label="Primary">
      <a class="cta primary" id="nav-broken-external" href="https://www.w3.org/nonexistent-webqa-accept-404">Broken CTA (external 404)</a>
      <a href="/ok">Valid internal</a>
    </nav>
  </header>
  <main>
    <h1>Correlation acceptance</h1>
    <img class="hero" id="lcp-hero" src="/assets/hero-large.png" width="780" height="520" alt="Large hero for LCP correlation">
    <p>Body content for LCP delayed paint.</p>
    <h2>Links</h2>
    <ul>
      <li><a id="ext-404-a" href="https://www.w3.org/nonexistent-webqa-accept-404">External 404 A</a></li>
      <li><a id="ext-404-b" href="https://www.w3.org/nonexistent-webqa-accept-404">External 404 B (same dest)</a></li>
      <li><a id="ext-403" href="https://www.w3.org/nonexistent-webqa-accept-403">External 403</a></li>
      <li><a id="ext-429" href="https://www.w3.org/nonexistent-webqa-accept-429">External 429</a></li>
      <li><a id="ext-ok" href="https://example.com/">Valid external</a></li>
      <li><a id="int-404" href="/missing-internal">Internal 404</a></li>
      <li><a id="int-ok" href="/ok">Valid internal again</a></li>
      <li><a id="frag-missing" href="#missing-section">Missing fragment</a></li>
      <li><a id="frag-ok" href="#existing-section">Valid fragment</a></li>
      <li><a id="malformed" href="http://[bad">Malformed href</a></li>
      <li class="cite"><a id="body-broken" href="https://www.w3.org/nonexistent-webqa-accept-404">Incidental body citation (same 404)</a></li>
    </ul>
    <h2>SSRF bait (must not be privileged-fetched)</h2>
    <ul>
      <li><a id="ssrf-localhost" href="http://127.0.0.1:9/secret">localhost bait</a></li>
      <li><a id="ssrf-rfc1918" href="http://10.0.0.1/">rfc1918 bait</a></li>
      <li><a id="ssrf-userinfo" href="http://user:pass@example.com/">userinfo bait</a></li>
    </ul>
    <section id="existing-section">
      <h2>Existing section</h2>
      <p>Fragment target exists.</p>
      <link rel="stylesheet" href="/wp-content/themes/demo/style.css">
      <script src="/wp-includes/js/demo.js"></script>
    </section>
  </main>
</body>
</html>`;

const OK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OK</title></head><body><h1>OK</h1></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const p = url.pathname;
  if (p === "/" || p === "/links") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return void res.end(HTML);
  }
  if (p === "/ok") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return void res.end(OK_HTML);
  }
  if (p === "/missing-internal") {
    res.writeHead(404, { "content-type": "text/plain" });
    return void res.end("missing");
  }
  if (p === "/assets/hero-large.png") {
    res.writeHead(200, { "content-type": "image/png", "content-length": BIG_PNG.length, "cache-control": "no-store" });
    return void res.end(BIG_PNG);
  }
  if (p.startsWith("/wp-")) {
    res.writeHead(200, { "content-type": "text/plain" });
    return void res.end("wp-asset");
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ ok: true, port: PORT, page: `http://localhost:${PORT}/links` }));
});

