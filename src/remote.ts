import { io } from "socket.io-client";
import type { View } from "./gateway";
const base = import.meta.env.VITE_API_URL.replace(/\/$/, "");
async function request(path: string, p?: unknown) {
  const res = await fetch(base + "/api/" + path, {
    credentials: "include",
    method: p ? "POST" : "GET",
    headers: {
      ...(sessionStorage.getItem("court-token") ? {Authorization: "Bearer " + sessionStorage.getItem("court-token")} : {}),
      ...(p ? {"Content-Type":"application/json", "X-Tournament-Request":"1"} : {}),
    },
    body: p ? JSON.stringify(p) : undefined,
  });
  const result = await res.json();
  if (!res.ok) {
    if (res.status === 409) window.dispatchEvent(new Event("session"));
    throw Error(result.error || "Request failed");
  }
  return result;
}
export async function enterCourt(tid: string, court: number, code: string) {
  const result = await request("court-entry", {tid, court, code});
  sessionStorage.setItem("court-token", result.token);
  window.dispatchEvent(new Event("session"));
  return result.uid as string;
}
export async function login(email: string, password: string) {
  await request("login", { email, password });
  sessionStorage.removeItem("court-token");
  window.dispatchEvent(new Event("session"));
}
export async function logout() {
  await request("logout", {});
  sessionStorage.removeItem("court-token");
  window.dispatchEvent(new Event("session"));
}
export async function write(p: any) {
  return { data: await request("write", p) };
}
export function watch(
  tid: string,
  cb: (v: View) => void,
  status: (v: string) => void,
) {
  let active = true,
    seq = 0;
  const socket = io(base, {
    withCredentials: true,
    autoConnect: false,
    auth: done => done({tid, token: sessionStorage.getItem("court-token")}),
  });
  const read = async () => {
    const n = ++seq;
    try {
      const v = await request("read?tid=" + encodeURIComponent(tid));
      if (active && n === seq) {
        cb(v);
        status(socket.connected ? "Connected" : "Offline");
      }
    } catch {
      if (active) status("Offline");
    }
  };
  const reset = () => {
    socket.disconnect().connect();
    void read();
  };
  socket
    .on("connect", read)
    .on("changed", read)
    .on("disconnect", () => status("Offline"))
    .on("connect_error", () => status("Offline"));
  window.addEventListener("session", reset);
  socket.connect();
  void read();
  const timer = setInterval(read, 15000);
  return () => {
    active = false;
    clearInterval(timer);
    window.removeEventListener("session", reset);
    socket.removeAllListeners().disconnect();
  };
}
