import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import {
  client,
  collection,
  initialize,
  load,
  save,
  publicDivision,
} from "./db";
import { change } from "../shared/operations";
import { check } from "../shared/model";
const origin = z.url().parse(process.env.CLIENT_ORIGIN);
const secret = z.string().min(32).parse(process.env.SESSION_SECRET);
const secure =
  process.env.NODE_ENV === "production" || origin.startsWith("https:");
const sameSite = process.env.CROSS_SITE_COOKIE === "true" ? "none" : "lax";
check(sameSite !== "none" || secure, "Cross-site cookies require HTTPS");
const digest = (token: string) =>
  createHmac("sha256", secret).update(token).digest("hex");
const cookieDigest = (cookies = "") =>
  digest(cookies.match(/(?:^|; *)pb_session=([a-f0-9]{64})(?:;|$)/)?.[1] || "");
const identity = async (cookies?: string) =>
  (
    await collection("sessions").findOne({
      digest: cookieDigest(cookies),
      expires: { $gt: new Date() },
    })
  )?.uid || "";
const app = express(),
  server = createServer(app);
const io = new Server(server, {
  cors: { origin, credentials: true },
  allowRequest: (req, cb) => cb(null, req.headers.origin === origin),
});
const id = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,128}$/)
  .refine((v) => !(v in Object.prototype));
const input = z
  .object({
    tid: id,
    eid: id,
    requestId: id,
    mode: z.enum(["create", "action", "settings", "staff", "division"]),
  })
  .passthrough();
app.disable("x-powered-by");
app.use(
  cors({ origin, credentials: true }),
  express.json({ limit: "400kb" }),
  rateLimit({ windowMs: 60000, limit: 600 }),
  (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  },
);
app.use((req, res, next) => {
  if (
    req.method === "POST" &&
    (req.headers.origin !== origin || req.get("X-Tournament-Request") !== "1")
  ) {
    res.status(403).json({ error: "Invalid request origin" });
    return;
  }
  next();
});
app.post(
  "/api/login",
  rateLimit({ windowMs: 60000, limit: 15 }),
  async (req, res) => {
    const { email, password } = z
      .object({ email: z.email(), password: z.string().max(256) })
      .parse(req.body);
    const user = await collection("users").findOne({
      email: email.toLowerCase(),
    });
    if (!user || !(await verify(user.hash, password))) {
      res.status(401).json({ error: "Invalid sign in" });
      return;
    }
    const token = randomBytes(32).toString("hex"),
      maxAge = 12 * 3600000;
    await collection("sessions").insertOne({
      uid: user.uid,
      digest: digest(token),
      expires: new Date(Date.now() + maxAge),
    });
    res
      .cookie("pb_session", token, {
        httpOnly: true,
        secure,
        sameSite,
        maxAge,
        path: "/",
      })
      .json({ ok: true });
  },
);
app.post("/api/logout", async (req, res) => {
  await collection("sessions").deleteOne({
    digest: cookieDigest(req.headers.cookie),
  });
  res
    .clearCookie("pb_session", { path: "/", httpOnly: true, secure, sameSite })
    .json({ ok: true });
});
async function snapshot(tid: string, uid: string) {
  return client.withSession((s) =>
    s.withTransaction(async () => {
      const staff = await collection("tournamentStaff")
        .find({ uid, role: { $in: ["admin", "referee"] } }, { session: s })
        .toArray();
      const records = await collection("tournaments")
        .find(
          {
            $or: [
              { "value.visible": true },
              { tournamentId: { $in: staff.map((v) => v.tournamentId) } },
            ],
          },
          { session: s },
        )
        .toArray();
      const role =
        staff.find((v) => v.tournamentId === tid)?.role || "spectator";
      const catalog = records.map((v) => ({
        ...v.value,
        owner: role === "admin" && v.tournamentId === tid ? v.value.owner : "",
      }));
      const t = catalog.find((v) => v.id === tid) || null;
      const data = t ? await load(tid, s) : undefined;
      const history: Record<string, any[]> = {};
      if (data && role !== "spectator") {
        const rows = await collection("scoreEvents")
          .find({ tournamentId: tid }, { session: s })
          .sort({ created: 1 })
          .toArray();
        for (const row of rows) (history[row.eventId] ??= []).push(row.value);
      }
      return {
        uid,
        role,
        catalog,
        t,
        history,
        events:
          role === "spectator"
            ? data?.events.map(publicDivision) || []
            : data?.events || [],
      };
    }),
  );
}
app.get("/api/read", async (req, res) => {
  res.json(
    await snapshot(
      String(req.query.tid || ""),
      await identity(req.headers.cookie),
    ),
  );
});
io.use(async (socket, next) => {
  try {
    const uid = await identity(socket.request.headers.cookie),
      tid = String(socket.handshake.auth.tid || "");
    if (tid && !(await snapshot(tid, uid))?.t)
      return next(Error("Unavailable tournament"));
    socket.data.tid = tid;
    next();
  } catch {
    next(Error("Subscription unavailable"));
  }
});
io.on("connection", (socket) => {
  if (socket.data.tid) socket.join(socket.data.tid);
});
app.post(
  [
    "/api/write",
    "/api/matches/:match/score-actions",
    "/api/matches/:match/confirm",
  ],
  async (req, res) => {
    const uid = await identity(req.headers.cookie);
    if (!uid) {
      res.status(401).json({ error: "Sign in first" });
      return;
    }
    const p = input.parse(req.body) as any;
    if (p.mode === "action") {
      p.action = z
        .object({
          kind: id,
          requestId: id,
          expected: z.number().int().nonnegative(),
          match: id.optional(),
          data: z.unknown().optional(),
        })
        .parse(p.action);
      check(p.action.requestId === p.requestId, "Request ID mismatch");
      if (req.params.match)
        check(
          req.params.match === p.action.match &&
            (!req.path.endsWith("/confirm") || p.action.kind === "confirm"),
          "Match or action mismatch",
        );
    }
    if (p.mode === "staff") {
      id.parse(p.uid);
      check(
        await collection("users").findOne({ uid: p.uid }),
        "Unknown staff account",
      );
    }
    const signature = createHash("sha256")
      .update(JSON.stringify(p))
      .digest("hex");
    const key = {
      tournamentId: p.tid,
      eventId: p.eid,
      matchId: p.action?.match || "",
      requestId: p.requestId,
    };
    const result = await client.withSession((s) =>
      s.withTransaction(async () => {
        const r = await load(p.tid, s);
        if (p.mode === "create") {
          check(
            await collection("users").findOne(
              { uid, organizer: true },
              { session: s },
            ),
            "Permission denied",
          );
        } else
          check(
            r?.staff[uid] === "admin" ||
              (p.mode === "action" &&
                r?.staff[uid] === "referee" &&
                r.events
                  .find((d) => d.id === p.eid)
                  ?.matches.find((m) => m.id === p.action.match)?.ref === uid),
            "Permission denied",
          );
        const previous = await collection("scoreRequests").findOne(key, {
          session: s,
        });
        if (previous) {
          check(
            previous.signature === signature && previous.uid === uid,
            "Request ID reused",
          );
          return previous.result;
        }
        const record = change(r, uid, p);
        const changed =
          p.mode === "create" || p.mode === "division"
            ? [p.eid, ...(p.additional || []).map((d: any) => d.id)]
            : [p.eid];
        await save(record, s, changed);
        const m = record.events
          .find((d) => d.id === p.eid)
          ?.matches.find((m) => m.id === p.action?.match);
        const result = { ok: true, match: JSON.stringify(m || null) };
        await collection("scoreRequests").insertOne(
          { ...key, signature, uid, result },
          { session: s },
        );
        return result;
      }),
    );
    // Room notifications carry no scores or private state. Every refresh rechecks access.
    io.to(p.tid).emit("changed");
    res.json(result);
  },
);
app.use(
  (
    e: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const conflict = String(e.message).startsWith("Conflict");
    if (conflict) {
      identity(req.headers.cookie)
        .then((uid) => snapshot(String(req.body.tid), uid))
        .then((current) => res.status(409).json({ error: e.message, current }))
        .catch(() => res.sendStatus(503));
      return;
    }
    const internal = e.name?.startsWith("Mongo");
    res
      .status(internal ? 503 : e.message === "Permission denied" ? 403 : 400)
      .json({
        error: internal
          ? "Database unavailable"
          : e instanceof z.ZodError
            ? "Invalid request"
            : e.message,
      });
  },
);
await initialize();
server.listen(Number(process.env.PORT || 4100));
