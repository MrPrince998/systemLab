// System Design Lab API: accounts, progress sync, saved designs, classrooms and the AI tutor.
// Zero-config local server: `npm run server`. Data lives in server/data.db (SQLite, built into Node).
import Anthropic from "@anthropic-ai/sdk";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? join(here, "data", "lab.db");
const MODEL = "claude-3-5-sonnet-20241022";
const MAX_BODY = 256 * 1024;

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
    password_hash TEXT NOT NULL,
    progress TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS designs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    design TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    assignments TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS memberships (
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (class_id, user_id)
  );
`);

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

function newSession(userId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(sha256(token), userId, Date.now() + 30 * 864e5);
  return token;
}

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});

function authUser(req, required = true) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const row = token
    ? db
        .prepare(
          "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
        )
        .get(sha256(token), Date.now())
    : undefined;
  if (!row && required) throw new HttpError(401, "Please sign in.");
  return row;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

const str = (v, name, { min = 1, max = 200 } = {}) => {
  if (typeof v !== "string" || v.trim().length < min || v.length > max)
    throw new HttpError(400, `Invalid ${name}.`);
  return v.trim();
};

/** Progress merges monotonically, so syncing two devices never loses work. */
function mergeProgress(a = {}, b = {}) {
  const union = (x = [], y = []) =>
    [...new Set([...x, ...y].filter((s) => typeof s === "string"))].slice(
      0,
      500,
    );
  const missions = { ...(a.missions ?? {}) };
  for (const [id, m] of Object.entries(b.missions ?? {})) {
    if (typeof id !== "string" || id.length > 20 || !m || typeof m !== "object")
      continue;
    const prev = missions[id] ?? {};
    missions[id] = {
      attempts: Math.max(prev.attempts ?? 0, Number(m.attempts) || 0),
      hints: Math.max(prev.hints ?? 0, Number(m.hints) || 0),
      completedAt: prev.completedAt ?? (Number(m.completedAt) || undefined),
    };
  }
  return {
    completed: union(a.completed, b.completed),
    achievements: union(a.achievements, b.achievements),
    missions,
  };
}

const classCode = () =>
  randomBytes(4).toString("hex").toUpperCase().slice(0, 6);

// ---------- AI tutor ----------

const anthropic =
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    ? new Anthropic()
    : null;

// Stable across requests so it can be cached; everything per-request goes in the messages.
const TUTOR_SYSTEM = `You are the tutor inside System Design Lab, an interactive app where students learn system design by building architectures on a canvas, simulating traffic through them, and breaking them.

Components in the simulator and how they behave:
- Client: sends requests (reads and writes).
- Application Server: capacity per second, processing time, timeout, retries, optional circuit breaker (opens after 5 consecutive failures, fails fast for 1s).
- Load Balancer: round-robin; with health checks on it skips dead backends, with them off it keeps sending traffic to dead servers.
- Cache: hit/miss with TTL; writes through it invalidate the key; if it is down it is bypassed.
- Database (primary): capacity per second, gets slower as load rises; the only place writes can go.
- Read Replica: read-only copy fed by a primary; replication lag can produce stale reads; keeps serving reads if the primary dies.
- Message Queue: acknowledges work immediately; workers (servers connected after it) drain it at their capacity; backlog carries over; full queues reject work.

How to tutor:
- You receive the student's current architecture, the last simulation's metrics and notable events, and the active mission, if any. Ground every claim in that data and name specific components by id.
- Teach, don't hand over answers. Explain why something happened, then suggest an experiment the student can run in the app (kill a component, change a setting, add traffic) to test the idea. Give a full solution only if the student explicitly asks for it after trying.
- Discuss trade-offs: every fix costs something (money, complexity, consistency, latency).
- Be concise: short paragraphs or a few bullets, under 200 words unless asked for more. Plain language, define jargon the first time.
- If the question is unrelated to system design or this app, briefly steer back.`;

const tutorBudget = new Map(); // userId -> timestamps of recent requests

async function tutor(user, body) {
  if (!anthropic)
    throw new HttpError(
      503,
      "The AI tutor is not configured. Set ANTHROPIC_API_KEY on the server.",
    );
  const now = Date.now();
  const recent = (tutorBudget.get(user.id) ?? []).filter(
    (t) => now - t < 60_000,
  );
  if (recent.length >= 10)
    throw new HttpError(
      429,
      "Too many questions in a minute. Try again shortly.",
    );
  tutorBudget.set(user.id, [...recent, now]);

  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const messages = history
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages.at(-1).role !== "user")
    throw new HttpError(400, "Ask a question.");
  while (messages[0]?.role !== "user") messages.shift();

  // Lab state is per-request, so it rides with the latest question rather than the cached system prompt.
  const context =
    typeof body.context === "string" ? body.context.slice(0, 12_000) : "";
  const last = messages.at(-1);
  last.content = `<lab_state>\n${context || "No architecture yet."}\n</lab_state>\n\n${last.content}`;

  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: TUTOR_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  if (response.stop_reason === "refusal") {
    return {
      reply:
        "I can’t help with that one. Try asking about your architecture or the last simulation.",
    };
  }
  const reply = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    reply: reply || "I don’t have an answer for that yet. Try rephrasing.",
  };
}

// ---------- routes ----------

const routes = {
  "GET /api/health": () => ({ ok: true, ai: !!anthropic }),

  "POST /api/auth/signup": async (req) => {
    const b = await readJson(req);
    const email = str(b.email, "email", { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new HttpError(400, "Enter a valid email.");
    const password = str(b.password, "password", { min: 8, max: 200 });
    const name = str(b.name, "name", { max: 60 });
    const role = b.role === "teacher" ? "teacher" : "student";
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email))
      throw new HttpError(409, "An account with that email already exists.");
    const progress = JSON.stringify(mergeProgress({}, b.progress));
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO users (email, name, role, password_hash, progress, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(email, name, role, hashPassword(password), progress, Date.now());
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(lastInsertRowid);
    return { token: newSession(user.id), user: publicUser(user) };
  },

  "POST /api/auth/login": async (req) => {
    const b = await readJson(req);
    const email = str(b.email, "email", { max: 120 }).toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !checkPassword(String(b.password ?? ""), user.password_hash))
      throw new HttpError(401, "Wrong email or password.");
    return { token: newSession(user.id), user: publicUser(user) };
  },

  "POST /api/auth/logout": (req) => {
    const token = (req.headers.authorization ?? "").slice(7);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
        sha256(token),
      );
    return { ok: true };
  },

  "GET /api/me": (req) => ({ user: publicUser(authUser(req)) }),

  "GET /api/progress": (req) => JSON.parse(authUser(req).progress),

  "PUT /api/progress": async (req) => {
    const user = authUser(req);
    const merged = mergeProgress(
      JSON.parse(user.progress),
      await readJson(req),
    );
    db.prepare("UPDATE users SET progress = ? WHERE id = ?").run(
      JSON.stringify(merged),
      user.id,
    );
    return merged;
  },

  "GET /api/designs": (req) => {
    const user = authUser(req);
    return db
      .prepare(
        "SELECT id, name, design, updated_at FROM designs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100",
      )
      .all(user.id)
      .map((d) => ({ ...d, design: JSON.parse(d.design) }));
  },

  "POST /api/designs": async (req) => {
    const user = authUser(req);
    const b = await readJson(req);
    const name = str(b.name, "name", { max: 80 });
    if (!b.design || typeof b.design !== "object")
      throw new HttpError(400, "Missing design.");
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO designs (user_id, name, design, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(user.id, name, JSON.stringify(b.design), Date.now());
    return { id: Number(lastInsertRowid) };
  },

  "DELETE /api/designs/:id": (req, id) => {
    const user = authUser(req);
    db.prepare("DELETE FROM designs WHERE id = ? AND user_id = ?").run(
      Number(id),
      user.id,
    );
    return { ok: true };
  },

  "GET /api/classes": (req) => {
    const user = authUser(req);
    if (user.role === "teacher") {
      return db
        .prepare("SELECT * FROM classes WHERE teacher_id = ? ORDER BY id DESC")
        .all(user.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          assignments: JSON.parse(c.assignments),
          students: db
            .prepare(
              "SELECT u.id, u.name, u.email, u.progress FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? ORDER BY u.name",
            )
            .all(c.id)
            .map((s) => ({
              id: s.id,
              name: s.name,
              email: s.email,
              progress: JSON.parse(s.progress),
            })),
        }));
    }
    return db
      .prepare(
        "SELECT c.id, c.name, c.assignments, t.name AS teacher FROM memberships m JOIN classes c ON c.id = m.class_id JOIN users t ON t.id = c.teacher_id WHERE m.user_id = ?",
      )
      .all(user.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        teacher: c.teacher,
        assignments: JSON.parse(c.assignments),
      }));
  },

  "POST /api/classes": async (req) => {
    const user = authUser(req);
    if (user.role !== "teacher")
      throw new HttpError(403, "Only teachers can create classes.");
    const name = str((await readJson(req)).name, "class name", { max: 80 });
    let code = classCode();
    while (db.prepare("SELECT 1 FROM classes WHERE code = ?").get(code))
      code = classCode();
    const { lastInsertRowid } = db
      .prepare("INSERT INTO classes (teacher_id, name, code) VALUES (?, ?, ?)")
      .run(user.id, name, code);
    return { id: Number(lastInsertRowid), name, code };
  },

  "POST /api/classes/join": async (req) => {
    const user = authUser(req);
    if (user.role !== "student")
      throw new HttpError(403, "Join classes with a student account.");
    const code = str((await readJson(req)).code, "code", {
      max: 12,
    }).toUpperCase();
    const c = db
      .prepare("SELECT id, name FROM classes WHERE code = ?")
      .get(code);
    if (!c) throw new HttpError(404, "No class with that code.");
    db.prepare(
      "INSERT OR IGNORE INTO memberships (class_id, user_id) VALUES (?, ?)",
    ).run(c.id, user.id);
    return { id: c.id, name: c.name };
  },

  "PUT /api/classes/:id/assignments": async (req, id) => {
    const user = authUser(req);
    const b = await readJson(req);
    const ids = Array.isArray(b.missionIds)
      ? b.missionIds
          .filter((m) => typeof m === "string" && /^\w{1,10}$/.test(m))
          .slice(0, 50)
      : [];
    const res = db
      .prepare(
        "UPDATE classes SET assignments = ? WHERE id = ? AND teacher_id = ?",
      )
      .run(JSON.stringify(ids), Number(id), user.id);
    if (!res.changes) throw new HttpError(404, "Class not found.");
    return { assignments: ids };
  },

  "POST /api/tutor": async (req) => tutor(authUser(req), await readJson(req)),
};

function match(method, path) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const re = new RegExp(`^${pattern.replace(/:\w+/g, "([^/]+)")}$`);
    const hit = path.match(re);
    if (hit) return [handler, hit.slice(1)];
  }
  return null;
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  };
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const found = match(req.method ?? "GET", path);
    if (!found) return send(404, { error: "Not found." });
    const [handler, params] = found;
    send(200, await handler(req, ...params));
  } catch (err) {
    if (err instanceof HttpError)
      return send(err.status, { error: err.message });
    if (err instanceof Anthropic.RateLimitError)
      return send(429, { error: "The tutor is busy. Try again in a moment." });
    if (err instanceof Anthropic.AuthenticationError)
      return send(503, { error: "The tutor’s API key is invalid." });
    if (err instanceof Anthropic.APIError)
      return send(502, { error: "The tutor is unavailable right now." });
    console.error(err);
    send(500, { error: "Something went wrong." });
  }
});

server.listen(PORT, () =>
  console.log(
    `System Design Lab API on http://localhost:${PORT} (AI tutor ${anthropic ? "on" : "off: set ANTHROPIC_API_KEY"})`,
  ),
);
