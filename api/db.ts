import { MongoClient, type ClientSession } from "mongodb";
import { table } from "../shared/engine";
import type { RecordSet } from "../shared/operations";
import type { Division } from "../shared/model";
import { z } from "zod";

export const client = new MongoClient(
  z
    .string()
    .regex(/^mongodb(?:\+srv)?:\/\//)
    .parse(process.env.MONGODB_URI),
);
export const db = client.db(process.env.MONGODB_DB || "pickleball");
export const collection = (name: string) => db.collection<any>(name);
const scopes: Record<string, string[]> = {
  umpireCodes: ["tournamentId", "uid", "name", "key"],
  users: ["email", "hash", "uid"],
  sessions: ["digest", "uid", "expires"],
  tournaments: ["tournamentId", "value", "version"],
  tournamentStaff: ["tournamentId", "uid", "role"],
  courts: ["tournamentId", "id"],
  events: ["tournamentId", "eventId", "value"],
  teams: ["tournamentId", "eventId", "value"],
  pools: ["tournamentId", "eventId", "id"],
  matches: ["tournamentId", "eventId", "value"],
  standings: ["tournamentId", "eventId", "id"],
  brackets: ["tournamentId", "eventId", "value"],
  scoreEvents: ["tournamentId", "eventId", "value", "created"],
  scoreRequests: [
    "tournamentId",
    "eventId",
    "requestId",
    "signature",
    "result",
  ],
};
export async function initialize() {
  for (const [name, required] of Object.entries(scopes)) {
    const validator = { $jsonSchema: { bsonType: "object", required } };
    if (!(await db.listCollections({ name }).hasNext()))
      await db.createCollection(name, { validator });
    if (name !== "tournaments" && required.includes("tournamentId"))
      await collection(name).createIndex(
        required.includes("eventId")
          ? { tournamentId: 1, eventId: 1 }
          : { tournamentId: 1 },
      );
  }
  for (const [name, keys] of Object.entries({
    umpireCodes: { tournamentId: 1, key: 1 },
    users: { email: 1 },
    sessions: { digest: 1 },
    tournaments: { tournamentId: 1 },
    tournamentStaff: { tournamentId: 1, uid: 1 },
    teams: { tournamentId: 1, eventId: 1, "value.id": 1 },
    matches: { tournamentId: 1, eventId: 1, "value.id": 1 },
    scoreRequests: { tournamentId: 1, eventId: 1, matchId: 1, requestId: 1 },
    courts: { tournamentId: 1, id: 1 },
  }))
    await collection(name).createIndex(keys as any, { unique: true });
  await collection("users").createIndex({ uid: 1 }, { unique: true });
  await collection("sessions").createIndex(
    { expires: 1 },
    { expireAfterSeconds: 0 },
  );
  await collection("scoreEvents").createIndex({
    tournamentId: 1,
    eventId: 1,
    "value.match": 1,
    created: 1,
  });
}
export async function load(
  tournamentId: string,
  session: ClientSession,
): Promise<RecordSet | undefined> {
  const root = await collection("tournaments").findOne(
    { tournamentId },
    { session },
  );
  if (!root) return;
  const rows = async (name: string) =>
    collection(name).find({ tournamentId }, { session }).toArray();
  const events = await rows("events"),
    teams = await rows("teams"),
    matches = await rows("matches"),
    staff = await rows("tournamentStaff");
  return {
    t: root.value,
    events: events.map((e) => ({
      ...e.value,
      teams: teams.filter((t) => t.eventId === e.eventId).map((t) => t.value),
      matches: matches
        .filter((m) => m.eventId === e.eventId)
        .map((m) => m.value),
    })),
    staff: Object.fromEntries(staff.map((s) => [s.uid, s.role])),
    history: {},
  };
}
export async function save(
  r: RecordSet,
  session: ClientSession,
  eids: string[],
) {
  const tournamentId = r.t.id;
  await collection("tournaments").updateOne(
    { tournamentId },
    { $set: { value: r.t }, $inc: { version: 1 } },
    { session, upsert: true },
  );
  async function replaceRows(
    name: string,
    query: Record<string, unknown>,
    rows: object[],
  ) {
    await collection(name).deleteMany(query, { session });
    if (rows.length)
      await collection(name).insertMany(
        rows.map((row) => ({ ...query, ...row })),
        { session },
      );
  }
  await replaceRows(
    "tournamentStaff",
    { tournamentId },
    Object.entries(r.staff).map(([uid, role]) => ({ uid, role })),
  );
  await replaceRows(
    "courts",
    { tournamentId },
    r.t.courts.map((name, id) => ({ name, id })),
  );
  for (const d of r.events.filter((d) => eids.includes(d.id))) {
    const scope = { tournamentId, eventId: d.id };
    const { teams, matches, ...value } = d;
    await collection("events").updateOne(
      scope,
      { $set: { value } },
      { session, upsert: true },
    );
    await replaceRows(
      "teams",
      scope,
      teams.map((value) => ({ value })),
    );
    await replaceRows(
      "matches",
      scope,
      matches.map((value) => ({ value })),
    );
    await replaceRows(
      "pools",
      scope,
      d.config.sizes.map((size, id) => ({ size, id })),
    );
    await replaceRows(
      "standings",
      scope,
      d.config.sizes.map((_, id) => ({ id, value: table(d, id) })),
    );
    await replaceRows(
      "brackets",
      scope,
      matches
        .filter((m) => m.phase === "playoff")
        .map((m) => ({ value: m.id })),
    );
    for (const value of r.history[d.id] || [])
      await collection("scoreEvents").insertOne(
        { ...scope, value, created: new Date() },
        { session },
      );
  }
}
export function publicDivision(d: Division): Division {
  return {
    ...d,
    orders: d.published ? d.orders : {},
    matches: d.matches.map((m) => ({
      ...m,
      undo: [],
      reason: "",
      ref: "",
      confirmedBy: "",
    })),
  };
}
