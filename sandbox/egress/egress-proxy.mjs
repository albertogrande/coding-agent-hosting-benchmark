#!/usr/bin/env node
// The egress proxy one session talks through. One per run, in its own container, on the
// session's internal network and on the outside one. Never mounted into a session.
//
//   AEO_EGRESS_POLICY=no-machine-files node egress-proxy.mjs
//
// Environment:
//   AEO_EGRESS_POLICY    open | no-web | no-resend | no-machine-files (policy.mjs)
//   AEO_EGRESS_PORT      where to listen, 3128 by default
//   AEO_EGRESS_LOG       the JSONL log of every decision, /log/egress.jsonl by default
//   AEO_EGRESS_CA_DIR    where the CA certificate and a CA bundle are written for the session
//                        to trust, /ca by default. `ready` appears beside the log once listening,
//                        never here: the session can read this directory.
//   AEO_EGRESS_UPSTREAM  optional http://host:port of a proxy to chain through
//
// A CA and a certificate for the intercepted names are made with openssl at start, in this
// container's own temporary directory; only the public certificate leaves it. They are made in
// every condition, so every session sees the same environment whether or not anything is
// intercepted.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { INTERCEPT_SANS, assertPolicy, decideConnect, decideRequest, decideResponse } from "./policy.mjs";

const POLICY = assertPolicy(process.env.AEO_EGRESS_POLICY ?? "");
const PORT = Number(process.env.AEO_EGRESS_PORT ?? 3128);
const LOG = process.env.AEO_EGRESS_LOG ?? "/log/egress.jsonl";
const CA_DIR = process.env.AEO_EGRESS_CA_DIR ?? "/ca";
const UPSTREAM = process.env.AEO_EGRESS_UPSTREAM ? new URL(process.env.AEO_EGRESS_UPSTREAM) : null;

const MESSAGE = "not available in this environment\n";

function log(entry) {
  try { fs.appendFileSync(LOG, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`); } catch { /* a log that cannot be written must not stop traffic */ }
}

// ------------------------------------------------------------------ certificates

function makeCertificates() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "egress-"));
  const f = (n) => path.join(dir, n);
  const ssl = (...a) => execFileSync("openssl", a, { stdio: ["ignore", "ignore", "pipe"] });
  ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", f("ca.key"), "-out", f("ca.crt"), "-days", "3",
    "-subj", "/CN=Local Egress CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  ssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", f("leaf.key"), "-out", f("leaf.csr"), "-subj", "/CN=egress");
  fs.writeFileSync(f("leaf.ext"), [
    "basicConstraints=CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    `subjectAltName=${INTERCEPT_SANS.map((n) => `DNS:${n}`).join(",")}`,
  ].join("\n"));
  ssl("x509", "-req", "-in", f("leaf.csr"), "-CA", f("ca.crt"), "-CAkey", f("ca.key"), "-CAcreateserial",
    "-out", f("leaf.crt"), "-days", "3", "-extfile", f("leaf.ext"));
  const caCert = fs.readFileSync(f("ca.crt"), "utf8");
  const leaf = { key: fs.readFileSync(f("leaf.key")), cert: fs.readFileSync(f("leaf.crt")) };
  fs.rmSync(dir, { recursive: true, force: true });

  fs.mkdirSync(CA_DIR, { recursive: true });
  fs.writeFileSync(path.join(CA_DIR, "ca.crt"), caCert);
  let system = "";
  for (const p of ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem"]) {
    try { system = fs.readFileSync(p, "utf8"); break; } catch { /* next */ }
  }
  fs.writeFileSync(path.join(CA_DIR, "bundle.pem"), `${system.trimEnd()}\n${caCert}`);
  return leaf;
}

// ------------------------------------------------------------------ upstream

/** A raw socket to host:port, directly or through the upstream proxy. */
function openUpstream(host, port) {
  return new Promise((resolve, reject) => {
    if (!UPSTREAM) {
      const s = net.connect(port, host, () => resolve(s));
      s.once("error", reject);
      return;
    }
    const s = net.connect(Number(UPSTREAM.port || 80), UPSTREAM.hostname, () => {
      const auth = UPSTREAM.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(UPSTREAM.username)}:${decodeURIComponent(UPSTREAM.password)}`).toString("base64")}\r\n`
        : "";
      s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return;
      s.off("data", onData);
      if (!/^HTTP\/1\.[01] 200/.test(buf.subarray(0, end).toString())) { s.destroy(); reject(new Error(`upstream refused ${host}:${port}`)); return; }
      const rest = buf.subarray(end + 4);
      if (rest.length) s.unshift(rest);
      resolve(s);
    };
    s.on("data", onData);
    s.once("error", reject);
  });
}

/** A TLS connection to the real host, verified against the system's trust store. */
async function openTls(host, port) {
  const raw = await openUpstream(host, port);
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket: raw, servername: host, ALPNProtocols: ["http/1.1"] }, () => resolve(t));
    t.once("error", reject);
  });
}

const HOP = new Set(["connection", "proxy-connection", "keep-alive", "proxy-authorization", "proxy-authenticate", "te", "trailer", "upgrade"]);
const clean = (headers) => Object.fromEntries(Object.entries(headers).filter(([k]) => !HOP.has(k.toLowerCase())));

// ------------------------------------------------------------------ interception

/** Requests on an intercepted connection, one by one: each is decided on its path and its Accept header. */
const intercepted = http.createServer(async (req, res) => {
  const host = req.socket.egressHost;
  const port = req.socket.egressPort;
  const at = { method: req.method, host, path: req.url };
  const d = decideRequest(POLICY, { path: req.url, accept: req.headers.accept });
  if (d.action === "refuse") {
    log({ ...at, decision: "refuse", rule: d.rule, status: 404 });
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found\n");
    return;
  }
  const headers = clean(req.headers);
  if (d.accept !== undefined) headers.accept = d.accept;
  try {
    const upstream = await openTls(host, port);
    const out = http.request({ method: req.method, path: req.url, headers, createConnection: () => upstream });
    out.on("response", (up) => {
      const r = decideResponse(POLICY, up.headers["content-type"]);
      if (r.action === "refuse") {
        up.resume();
        log({ ...at, decision: "refuse", rule: r.rule, status: 404, upstreamStatus: up.statusCode });
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not Found\n");
        return;
      }
      log({ ...at, decision: "allow", rule: d.rule, status: up.statusCode, contentType: up.headers["content-type"] ?? null });
      res.writeHead(up.statusCode ?? 502, clean(up.headers));
      up.pipe(res);
    });
    out.on("error", (e) => {
      log({ ...at, decision: "error", rule: d.rule, error: String(e.message) });
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(out);
  } catch (e) {
    log({ ...at, decision: "error", rule: d.rule, error: String(e.message) });
    res.writeHead(502);
    res.end();
  }
});

// ------------------------------------------------------------------ the proxy

const leaf = makeCertificates();

const server = http.createServer(async (req, res) => {
  // A plain-HTTP request in absolute form: decided on its host, then on its path.
  let url;
  try { url = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
  const host = url.hostname;
  const c = decideConnect(POLICY, host);
  const at = { method: req.method, host, path: url.pathname + url.search };
  if (c.action === "refuse") {
    log({ ...at, decision: "refuse", rule: c.rule, status: 403 });
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end(MESSAGE);
    return;
  }
  const d = c.action === "intercept" ? decideRequest(POLICY, { path: url.pathname, accept: req.headers.accept }) : { action: "forward", rule: c.rule };
  if (d.action === "refuse") {
    log({ ...at, decision: "refuse", rule: d.rule, status: 404 });
    res.writeHead(404);
    res.end("Not Found\n");
    return;
  }
  const headers = clean(req.headers);
  if (d.accept !== undefined) headers.accept = d.accept;
  const out = http.request(UPSTREAM
    ? { host: UPSTREAM.hostname, port: Number(UPSTREAM.port || 80), method: req.method, path: req.url, headers }
    : { host, port: Number(url.port || 80), method: req.method, path: url.pathname + url.search, headers });
  out.on("response", (up) => {
    const r = c.action === "intercept" ? decideResponse(POLICY, up.headers["content-type"]) : { action: "forward" };
    if (r.action === "refuse") { up.resume(); log({ ...at, decision: "refuse", rule: r.rule, status: 404 }); res.writeHead(404); res.end("Not Found\n"); return; }
    log({ ...at, decision: "allow", rule: d.rule, status: up.statusCode });
    res.writeHead(up.statusCode ?? 502, clean(up.headers));
    up.pipe(res);
  });
  out.on("error", (e) => { log({ ...at, decision: "error", rule: d.rule, error: String(e.message) }); if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(out);
});

server.on("connect", async (req, client, head) => {
  const [host, portText] = String(req.url).split(":");
  const port = Number(portText || 443);
  const c = decideConnect(POLICY, host);
  log({ method: "CONNECT", host, port, decision: c.action === "refuse" ? "refuse" : "allow", rule: c.rule });
  client.on("error", () => client.destroy());
  if (c.action === "refuse") {
    client.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${MESSAGE.length}\r\nConnection: close\r\n\r\n${MESSAGE}`);
    return;
  }
  if (c.action === "intercept") {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) client.unshift(head);
    const t = new tls.TLSSocket(client, { isServer: true, key: leaf.key, cert: leaf.cert, ALPNProtocols: ["http/1.1"] });
    t.egressHost = host;
    t.egressPort = port;
    t.on("error", () => t.destroy());
    intercepted.emit("connection", t);
    return;
  }
  try {
    const up = await openUpstream(host, port);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) up.write(head);
    up.on("error", () => client.destroy());
    client.on("error", () => up.destroy());
    up.pipe(client);
    client.pipe(up);
  } catch (e) {
    log({ method: "CONNECT", host, port, decision: "error", rule: c.rule, error: String(e.message) });
    client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  fs.writeFileSync(path.join(path.dirname(LOG), "ready"), `${POLICY}\n`);
  console.log(`egress ${POLICY} on :${PORT}`);
});
