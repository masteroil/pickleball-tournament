import {
  additionalDivisions,
  mutate,
  tournament,
  division,
} from "../shared/service";
import {
  check,
  type Audit,
  type Division,
  type Tournament,
  type Staff,
} from "../shared/model";
export interface RecordSet {
  t: Tournament;
  events: Division[];
  staff: Record<string, Staff["role"]>;
  history: Record<string, Audit[]>;
}
export function change(
  r: RecordSet | undefined,
  uid: string,
  p: any,
): RecordSet {
  const mode = p.mode;
  if (mode === "create") {
    check(!r, "Duplicate tournament");
    return {
      t: tournament(p.tid, uid, p.tournament),
      events: [
        division(p.eid, p.division),
        ...additionalDivisions(p.eid, p.additional),
      ],
      staff: { [uid]: "admin" },
      history: {},
    };
  } else {
    check(r, "Unknown tournament");
    const role = r.staff[uid] || "spectator";
    if (mode === "action") {
      const d = r.events.find((e) => e.id === p.eid);
      check(d, "Unknown division");
      const ev = mutate(
        d,
        r.t,
        r.events.filter((e) => e !== d),
        { uid, role },
        p.action,
        Date.now(),
      );
      (r.history[d.id] ??= []).push(ev);
    } else {
      check(role === "admin", "Permission denied");
      if (mode === "settings") {
        const t = tournament(p.tid, r.t.owner, { ...r.t, ...p.settings });
        check(t.courts.length >= r.t.courts.length, "Cannot remove courts");
        r.t = t;
      } else if (mode === "staff") {
        check(
          p.uid !== r.t.owner && ["referee", "spectator"].includes(p.role),
          "Invalid role",
        );
        r.staff[p.uid] = p.role;
      } else if (mode === "division") {
        check(!r.events.some((d) => d.id === p.eid), "Duplicate division");
        const ds = [
          division(p.eid, p.division),
          ...additionalDivisions(p.eid, p.additional),
        ];
        check(
          !ds.some((v) => r.events.some((e) => v.id === e.id)),
          "Duplicate division",
        );
        r.events.push(...ds);
      } else throw Error("Unknown operation");
    }
  }

  return r!;
}
