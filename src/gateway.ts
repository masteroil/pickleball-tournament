import { requestId } from "./ids";
import type { Tournament, Division, Audit, Staff } from "../shared/model";
export const serverMode = Boolean(import.meta.env.VITE_API_URL);
export type View = {
  canCreate: boolean;
  catalog: Tournament[];
  t: Tournament | null;
  events: Division[];
  uid: string;
  role: Staff["role"];
  history: Record<string, Audit[]>;
};
export const empty: View = {
  canCreate: false,
  catalog: [],
  t: null,
  events: [],
  uid: "",
  role: "spectator",
  history: {},
};
const token = () => sessionStorage.getItem("demo-session") || "";
async function demo(path: string, body?: any) {
  if (import.meta.env.PROD)
    return (await import("./practice")).call(path, body);
  const res = await fetch("/demo/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: token(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.error) throw Error(data.error);
  return data;
}
const cloud = () => import("./remote");
export async function login(email: string, password: string) {
  if (serverMode) return (await cloud()).login(email, password);
  const r = await demo("login", { email, password });
  sessionStorage.setItem("demo-session", r.token);
  window.dispatchEvent(new Event("session"));
}
export async function logout() {
  if (serverMode) return (await cloud()).logout();
  await demo("logout", {});
  sessionStorage.removeItem("demo-session");
  window.dispatchEvent(new Event("session"));
}
export async function write(p: any) {
  if (!navigator.onLine) throw Error("Offline — reconnect to submit");
  p.requestId ??= requestId();
  return serverMode ? (await (await cloud()).write(p)).data : demo("write", p);
}
export function watch(
  tid: string,
  cb: (s: View) => void,
  status: (msg: string) => void,
) {
  let active = true,
    dispose = () => {};
  if (serverMode) {
    cloud()
      .then((m) => {
        if (active) dispose = m.watch(tid, cb, status);
      })
      .catch((e) => status(e.message));
  } else {
    const stream = import.meta.env.PROD
      ? null
      : new EventSource("/demo/stream");
    let seq = 0;
    const refresh = async () => {
      const n = ++seq;
      try {
        const v = await demo("read?tid=" + encodeURIComponent(tid));
        if (active && n === seq) {
          cb(v);
          status("Connected");
        }
      } catch {
        if (active) status("Offline");
      }
    };
    if (stream) stream.onmessage = refresh;
    window.addEventListener("storage", refresh);
    if (stream) stream.onerror = () => status("Offline");
    window.addEventListener("session", refresh);
    window.addEventListener("online", refresh);
    refresh();
    dispose = () => {
      stream?.close();
      window.removeEventListener("storage", refresh);
      window.removeEventListener("session", refresh);
      window.removeEventListener("online", refresh);
    };
  }
  return () => {
    active = false;
    dispose();
  };
}
