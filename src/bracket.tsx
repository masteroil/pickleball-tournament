import type { Match } from "../shared/model";

export function Bracket({ matches, names, open }: {matches:Match[], names:(id:string)=>string, open:(id:string)=>void}) {
  const playoffs = matches.filter(m => m.phase === "playoff");
  if (!playoffs.length) return null;
  const byId = new Map(playoffs.map(m => [m.id, m]));
  const last = Math.max(...playoffs.map(m => m.round));
  const final = playoffs.find(m => m.round === last)!;
  const width = 216, gap = 36, row = 98;
  const height = row * 2 ** last;
  const positions = new Map<string, {x:number,y:number}>();
  function place(m:Match, top:number, span:number) {
    positions.set(m.id, {x:m.round*(width+gap), y:top+span/2});
    const a = byId.get(m.fromA), b = byId.get(m.fromB);
    if (a) place(a, top, span/2);
    if (b) place(b, top+span/2, span/2);
  }
  place(final, 0, height);
  const totalWidth = (last+1)*(width+gap)-gap;
  return <div className="bracket-scroll" tabIndex={0} aria-label="Playoff bracket">
    <div style={{width:totalWidth}}>
      <div className="bracket-head" style={{gridTemplateColumns:'repeat('+(last+1)+', '+width+'px)',gap}}>
        {Array.from({length:last+1},(_,r)=><strong key={r}>{["Final","Semifinals","Quarterfinals"][last-r] || "Round of "+2**(last-r+1)}</strong>)}
      </div>
      <div className="bracket-tree" style={{height}}>
        <svg aria-hidden="true" width={totalWidth} height={height}>
          {playoffs.flatMap(m => [m.fromA,m.fromB].map(source => {
            const from=positions.get(source), to=positions.get(m.id);
            if (!from || !to) return null;
            return <path key={source} d={`M ${from.x+width} ${from.y} H ${to.x-gap/2} V ${to.y} H ${to.x}`} />;
          }))}
        </svg>
        {playoffs.map(m => {
          const pos=positions.get(m.id);
          if (!pos) return null;
          return <button className="tree-match" key={m.id} style={{left:pos.x,top:pos.y,width}} onClick={()=>open(m.id)}>
            <small>{m.id} · {m.status}</small>
            {[m.a,m.b].map((team,i)=><span className={team && m.winner === team ? "tree-winner" : ""} key={i}>
              <strong>{team ? names(team) : (i ? m.fromB : m.fromA) ? "Winner of "+(i ? m.fromB : m.fromA) : "Pending qualifier"}</strong>
              <b>{m.status === "scheduled" ? "–" : m.games.map(g=>g[i]).join(" · ")}</b>
            </span>)}
          </button>
        })}
      </div>
    </div>
  </div>;
}
