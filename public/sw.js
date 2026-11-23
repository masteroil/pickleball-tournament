const root=self.registration.scope;
const name="pickleball:"+root+":v2";
self.addEventListener("install",e=>e.waitUntil((async()=>{
 const cache=await caches.open(name),res=await fetch(root,{cache:"reload"});
 const html=await res.clone().text();
 if(!res.ok)throw Error("Shell unavailable");
 await cache.addAll([...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map(m=>new URL(m[1],root).href));
 await cache.put(root,res); await self.skipWaiting();
})()));
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET"||!e.request.url.startsWith(root))return;
 if(e.request.mode==="navigate")e.respondWith(fetch(e.request).catch(()=>caches.match(root)));
 else if(e.request.url.startsWith(root+"assets/"))e.respondWith((async()=>{const c=await caches.open(name),hit=await c.match(e.request);if(hit)return hit;const r=await fetch(e.request);if(r.ok)await c.put(e.request,r.clone());return r;})());
});
