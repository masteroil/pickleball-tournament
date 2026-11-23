import { change, type RecordSet } from "../shared/operations";
import { demoTournament, demoDivision } from "../shared/seed";
import { check } from "../shared/model";

const key = "elnido.practice.v1";
type State = {
  records: Record<string, RecordSet>;
  requests: Record<string, string>;
};
function load(): State {
  const raw = localStorage.getItem(key);
  return raw
    ? JSON.parse(raw)
    : {
        records: {
          demo: {
            t: demoTournament,
            events: [demoDivision()],
            history: {},
            staff: { admin: "admin", referee: "referee", referee2: "referee" },
          },
        },
        requests: {},
      };
}
export async function call(path: string, p?: any) {
  const uid = sessionStorage.getItem("demo-session") || "";
  if (path === "login") {
    const who = String(p.email).split("@")[0];
    check(
      ["admin", "referee", "referee2"].includes(who) &&
        p.email === who + "@demo.test" &&
        p.password === "Courtside26!",
      "Invalid demo login",
    );
    return { token: who };
  }
  if (path === "logout") return {};
  if (path.startsWith("read?")) {
    const records = Object.values(load().records).filter(
      (r) => r.t.visible || ["admin", "referee"].includes(r.staff[uid]),
    );
    const r = records.find(
      (r) => r.t.id === new URLSearchParams(path.split("?")[1]).get("tid"),
    );
    const role = r?.staff[uid] || "spectator";
    return {
      uid,
      role,
      canCreate: uid === "admin",
      catalog: records.map((r) => r.t),
      t: r?.t || null,
      events: r?.events || [],
      history: role === "spectator" ? {} : r?.history,
    };
  }
  check(uid, "Sign in first");
  if (p.mode === "create") check(uid === "admin", "Permission denied");
  return navigator.locks.request(key, () => {
    const state = load();
    const id = [uid, p.tid, p.requestId].join("/");
    const sig = JSON.stringify(p);
    if (state.requests[id]) {
      check(state.requests[id] === sig, "Request ID reused");
      return { ok: true };
    }
    state.records[p.tid] = change(state.records[p.tid], uid, p);
    state.requests[id] = sig;
    localStorage.setItem(key, JSON.stringify(state));
    window.dispatchEvent(new Event("session"));
    return { ok: true };
  });
}
