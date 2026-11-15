"use strict";

const fs = require("node:fs");
const path = require("node:path");
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
const http = require("node:http");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "doi-mat-khau-nay-truoc-khi-dung";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(ROOT, "data", "votes.json"));
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const USE_DATABASE = Boolean(process.env.DATABASE_URL);

if (IS_PRODUCTION && !USE_DATABASE && process.env.ALLOW_EPHEMERAL_STORAGE !== "true") {
  console.error("Thiếu DATABASE_URL. Không khởi động với file lưu tạm trên Render để tránh mất phiếu.");
  process.exit(1);
}
if (IS_PRODUCTION && ADMIN_PASSWORD === "doi-mat-khau-nay-truoc-khi-dung") {
  console.error("Hãy đặt ADMIN_PASSWORD riêng trong Environment Variables trước khi triển khai.");
  process.exit(1);
}

let pool = null;
let state = { open: true, reveal: false, epoch: 1, votes: {} };
const clients = new Set();
let mutationQueue = Promise.resolve();
function serializeMutation(task) {
  const result = mutationQueue.then(task);
  mutationQueue = result.catch(() => {});
  return result;
}
const loginAttempts = new Map();
const CHOICES = new Set(["danh", "khong"]);

function counts() {
  const result = { danh: 0, khong: 0 };
  for (const vote of Object.values(state.votes)) {
    if (vote && CHOICES.has(vote.c)) result[vote.c]++;
  }
  return result;
}

function publicState() {
  const c = counts();
  return {
    open: state.open,
    reveal: state.reveal,
    epoch: state.epoch,
    counts: c,
    total: c.danh + c.khong
  };
}

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (_) { clients.delete(res); }
  }
}

setInterval(() => {
  for (const res of clients) {
    try { res.write(": heartbeat\n\n"); } catch (_) { clients.delete(res); }
  }
}, 20000).unref();

async function initStorage() {
  if (USE_DATABASE) {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voting_state (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
        is_open BOOLEAN NOT NULL DEFAULT TRUE,
        reveal_history BOOLEAN NOT NULL DEFAULT FALSE,
        epoch INTEGER NOT NULL DEFAULT 1
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS votes (
        voter_id VARCHAR(64) PRIMARY KEY,
        choice VARCHAR(8) NOT NULL CHECK (choice IN ('danh', 'khong')),
        epoch INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`INSERT INTO voting_state (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING`);
    await loadDatabaseState();
    console.log("Storage: PostgreSQL");
  } else {
    try {
      const saved = JSON.parse(await fs.promises.readFile(DATA_FILE, "utf8"));
      if (saved && saved.votes && typeof saved.votes === "object") {
        state = {
          open: saved.open !== false,
          reveal: Boolean(saved.reveal),
          epoch: Number(saved.epoch) || 1,
          votes: saved.votes
        };
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    console.log(`Storage: local JSON (${DATA_FILE})`);
  }
}

async function loadDatabaseState() {
  const [s, v] = await Promise.all([
    pool.query("SELECT is_open, reveal_history, epoch FROM voting_state WHERE singleton = TRUE"),
    pool.query("SELECT voter_id, choice FROM votes")
  ]);
  const row = s.rows[0];
  state.open = row ? row.is_open : true;
  state.reveal = row ? row.reveal_history : false;
  state.epoch = row ? Number(row.epoch) : 1;
  state.votes = {};
  for (const item of v.rows) state.votes[item.voter_id] = { c: item.choice };
}

let saveTimer = null;
function saveLocalSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.promises.mkdir(path.dirname(DATA_FILE), { recursive: true });
      const temp = `${DATA_FILE}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, JSON.stringify(state), "utf8");
      await fs.promises.rename(temp, DATA_FILE);
    } catch (err) {
      console.error("Không lưu được dữ liệu:", err.message);
    }
  }, 100);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function signSession(expiry) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(expiry)).digest("base64url");
}

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return "";
}

function isAdmin(req) {
  const token = getCookie(req, "tn_admin");
  const split = token.split(".");
  if (split.length !== 2) return false;
  const expiry = Number(split[0]);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) return false;
  return safeEqual(split[1], signSession(expiry));
}

function setAdminCookie(res) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = `${expiry}.${signSession(expiry)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `tn_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function clearAdminCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `tn_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function originIsSame(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase(); }
  catch (_) { return false; }
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (_) { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function infoUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`.replace(/\/+$/, "");
}

function mimeType(file) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8"
  })[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: "not_found" });
    res.writeHead(200, {
      "Content-Type": mimeType(file),
      "Cache-Control": file.endsWith(".html") ? "no-store" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(data);
  });
}

async function castVote(id, choice) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT is_open, epoch FROM voting_state WHERE singleton = TRUE FOR UPDATE");
      const row = result.rows[0];
      if (!row || !row.is_open) {
        await client.query("ROLLBACK");
        return { closed: true };
      }
      await client.query(
        `INSERT INTO votes (voter_id, choice, epoch, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (voter_id) DO UPDATE SET choice = EXCLUDED.choice, epoch = EXCLUDED.epoch, updated_at = NOW()`,
        [id, choice, row.epoch]
      );
      await client.query("COMMIT");
      state.open = row.is_open;
      state.epoch = Number(row.epoch);
      state.votes[id] = { c: choice, t: Date.now() };
      return { ok: true, epoch: state.epoch };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  if (!state.open) return { closed: true };
  state.votes[id] = { c: choice, t: Date.now() };
  saveLocalSoon();
  return { ok: true, epoch: state.epoch };
}

async function applyAdminAction(action) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT is_open, reveal_history, epoch FROM voting_state WHERE singleton = TRUE FOR UPDATE");
      const current = result.rows[0];
      let open = current.is_open;
      let reveal = current.reveal_history;
      let epoch = Number(current.epoch);
      if (action === "open") open = true;
      else if (action === "close") open = false;
      else if (action === "reveal") reveal = true;
      else if (action === "hide") reveal = false;
      else if (action === "reset") {
        await client.query("DELETE FROM votes");
        open = true;
        reveal = false;
        epoch += 1;
      } else {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "UPDATE voting_state SET is_open = $1, reveal_history = $2, epoch = $3 WHERE singleton = TRUE",
        [open, reveal, epoch]
      );
      await client.query("COMMIT");
      state.open = open;
      state.reveal = reveal;
      state.epoch = epoch;
      if (action === "reset") state.votes = {};
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  if (action === "open") state.open = true;
  else if (action === "close") state.open = false;
  else if (action === "reveal") state.reveal = true;
  else if (action === "hide") state.reveal = false;
  else if (action === "reset") {
    state.votes = {};
    state.reveal = false;
    state.open = true;
    state.epoch += 1;
  } else return false;
  saveLocalSoon();
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  try {
    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { ok: true, storage: pool ? "postgres" : "local" });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      const id = String(url.searchParams.get("id") || "");
      const out = publicState();
      out.mine = /^[A-Za-z0-9_-]{8,64}$/.test(id) && state.votes[id] ? state.votes[id].c : null;
      return sendJson(res, 200, out);
    }

    if (req.method === "GET" && pathname === "/api/info") {
      const base = infoUrl(req);
      return sendJson(res, 200, {
        urls: [{ label: "Địa chỉ Internet", url: `${base}/vote` }],
        admin: isAdmin(req),
        storage: pool ? "postgres" : "local"
      });
    }

    if (req.method === "GET" && pathname === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write("retry: 2000\n\n");
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && pathname === "/api/vote") {
      const body = await readBody(req, 2048);
      const id = String(body.id || "");
      const choice = String(body.choice || "");
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || !CHOICES.has(choice)) {
        return sendJson(res, 400, { ok: false, error: "invalid" });
      }
      const result = await serializeMutation(() => castVote(id, choice));
      if (result.closed) return sendJson(res, 403, { ok: false, error: "closed" });
      broadcast();
      return sendJson(res, 200, { ok: true, mine: choice, epoch: result.epoch });
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      if (!originIsSame(req)) return sendJson(res, 403, { ok: false, error: "origin" });
      const ip = clientIp(req);
      const attempt = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
      if (attempt.blockedUntil > Date.now()) return sendJson(res, 429, { ok: false, error: "rate_limited" });
      const body = await readBody(req, 2048);
      if (!safeEqual(body.password || "", ADMIN_PASSWORD)) {
        attempt.count += 1;
        if (attempt.count >= 5) {
          attempt.count = 0;
          attempt.blockedUntil = Date.now() + 15 * 60 * 1000;
        }
        loginAttempts.set(ip, attempt);
        return sendJson(res, 401, { ok: false, error: "wrong_password" });
      }
      loginAttempts.delete(ip);
      setAdminCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      if (!originIsSame(req)) return sendJson(res, 403, { ok: false, error: "origin" });
      clearAdminCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/admin") {
      if (!originIsSame(req) || !isAdmin(req)) return sendJson(res, 403, { ok: false, error: "forbidden" });
      const body = await readBody(req, 2048);
      const ok = await serializeMutation(() => applyAdminAction(String(body.action || "")));
      if (!ok) return sendJson(res, 400, { ok: false, error: "unknown_action" });
      broadcast();
      return sendJson(res, 200, Object.assign({ ok: true }, publicState()));
    }

    if (req.method === "GET") {
      if (pathname === "/") {
        res.writeHead(302, { Location: "/screen" });
        return res.end();
      }
      if (pathname === "/vote") return serveFile(res, path.join(PUBLIC_DIR, "vote.html"));
      if (pathname === "/screen") return serveFile(res, path.join(PUBLIC_DIR, "screen.html"));
      if (pathname === "/admin") return serveFile(res, path.join(PUBLIC_DIR, "admin.html"));
      if (pathname.startsWith("/assets/")) {
        const relative = path.normalize(pathname.slice("/assets/".length));
        if (relative.startsWith("..") || path.isAbsolute(relative)) return sendJson(res, 400, { error: "bad_path" });
        return serveFile(res, path.join(PUBLIC_DIR, relative));
      }
    }

    return sendJson(res, 404, { error: "not_found" });
  } catch (err) {
    console.error("Request error:", err);
    if (!res.headersSent) sendJson(res, err.status || 500, { ok: false, error: "server_error" });
    else res.end();
  }
});

async function main() {
  await initStorage();
  server.listen(PORT, "0.0.0.0", () => {
    console.log("\nBÌNH CHỌN TÂY NAM · ONLINE");
    console.log(`Máy chiếu: ${infoUrl({ headers: { host: `localhost:${PORT}` } })}/screen`);
    console.log(`Trang quản trị: http://localhost:${PORT}/admin`);
    console.log(`Trang bình chọn: ${infoUrl({ headers: { host: `localhost:${PORT}` } })}/vote`);
    console.log(`Storage: ${pool ? "PostgreSQL" : "local JSON"}`);
  });
}

process.on("SIGTERM", async () => {
  server.close();
  if (pool) await pool.end().catch(() => {});
  process.exit(0);
});
process.on("SIGINT", async () => {
  server.close();
  if (pool) await pool.end().catch(() => {});
  process.exit(0);
});

main().catch(err => {
  console.error("Không thể khởi động máy chủ:", err);
  process.exit(1);
});
