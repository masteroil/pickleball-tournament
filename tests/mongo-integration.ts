// Run only against a disposable loopback replica set with the API on port 4100.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { io } from "socket.io-client";
import { collection, client, initialize } from "../api/db";
import { demoDivision, demoTournament } from "../shared/seed";
const uri = process.env.MONGODB_URI || "";
assert(
  /^mongodb:\/\/(localhost|127\.0\.0\.1):\d+\//.test(uri) &&
    process.env.MONGODB_DB === "test_tournament",
);
const base = "http://127.0.0.1:4100",
  origin = "http://localhost:5173";
const tid = randomUUID(),
  eid = "mixed",
  password = randomUUID();
async function post(path: string, body: any, cookie = "", from = origin) {
  const r = await fetch(base + "/api/" + path, {
    method: "POST",
    headers: {
      origin: from,
      "x-tournament-request": "1",
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie") || "",
  };
}
async function read(cookie = "") {
  return (
    await fetch(base + "/api/read?tid=" + tid, { headers: { cookie } })
  ).json();
}
async function account(organizer: boolean) {
  const uid = randomUUID(),
    email = uid + "@test.invalid";
  await collection("users").insertOne({
    uid,
    email,
    hash: await hash(password),
    organizer,
  });
  const r = await post("login", { email, password });
  assert.equal(r.status, 200);
  assert.match(r.cookie, /HttpOnly/);
  assert.match(r.cookie, /SameSite=Lax/);
  return { uid, cookie: r.cookie.split(";")[0] };
}
try {
  await initialize();
  const admin = await account(true),
    ref = await account(false),
    other = await account(false);
  const write = (cookie: string, extra: object) =>
    post("write", { tid, eid, requestId: randomUUID(), ...extra }, cookie);
  const d = demoDivision();
  const setup = {
    mode: "create",
    tournament: { ...demoTournament, visible: false },
    division: d,
  };
  assert.equal((await write(ref.cookie, setup)).status, 403);
  assert.equal((await write(admin.cookie, setup)).status, 200);
  assert.equal((await read()).t, null);
  const privateSocket = io(base, {
    auth: { tid },
    extraHeaders: { origin },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Private room check timed out")),
      5000,
    );
    privateSocket.once("connect_error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  privateSocket.disconnect();
  assert.equal(
    (
      await write(admin.cookie, {
        mode: "settings",
        settings: { visible: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await write(admin.cookie, {
        mode: "staff",
        uid: ref.uid,
        role: "referee",
      })
    ).status,
    200,
  );
  const action = (
    kind: string,
    expected: number,
    match?: string,
    data?: any,
  ) => {
    const requestId = randomUUID();
    return {
      mode: "action",
      requestId,
      action: { kind, expected, requestId, match, data },
    };
  };
  assert.equal((await write(admin.cookie, action("generate", 0))).status, 200);
  let m = (await read(admin.cookie)).events[0].matches[0];
  assert.equal(
    (
      await write(
        admin.cookie,
        action("assign", m.version, m.id, {
          court: m.court,
          slot: m.slot,
          ref: ref.uid,
        }),
      )
    ).status,
    200,
  );
  m = (await read(admin.cookie)).events[0].matches[0];
  assert.equal(
    (await write(ref.cookie, action("start", m.version, m.id))).status,
    200,
  );
  m = (await read(ref.cookie)).events[0].matches[0];
  const point = action("point", m.version, m.id, { side: 0 });
  assert.equal(
    (
      await post(
        "write",
        { tid, eid, ...point },
        ref.cookie,
        "https://wrong.invalid",
      )
    ).status,
    403,
  );
  assert.equal((await write(other.cookie, point)).status, 403);
  const socket = io(base, {
    auth: { tid },
    extraHeaders: { origin },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const changed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("No room event")), 5000);
    socket.once("changed", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const results = await Promise.all([
    write(ref.cookie, point),
    write(ref.cookie, action("point", m.version, m.id, { side: 1 })),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  await changed;
  socket.disconnect();
  if (results[0].status === 200)
    assert.deepEqual((await write(ref.cookie, point)).data, results[0].data);
  const pub = await read();
  assert.equal(pub.events[0].matches[0].version, m.version + 1);
  assert.equal(pub.events[0].matches[0].ref, "");
  assert.deepEqual(pub.history, {});
  const key = {
    tournamentId: tid,
    eventId: eid,
    matchId: "-",
    requestId: randomUUID(),
  };
  await assert.rejects(
    client.withSession((s) =>
      s.withTransaction(async () => {
        await collection("scoreRequests").insertOne(
          { ...key, signature: "x", result: {} },
          { session: s },
        );
        throw Error("rollback");
      }),
    ),
  );
  assert.equal(await collection("scoreRequests").countDocuments(key), 0);
  const row = { ...key, signature: "x", result: {} };
  await collection("scoreRequests").insertOne({ ...row });
  await assert.rejects(collection("scoreRequests").insertOne({ ...row }), {
    code: 11000,
  });
  console.log("Replica-set API checks passed");
} finally {
  await client.close();
}
