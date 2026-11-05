const headers={"Cache-Control":"private, no-store", "X-Robots-Tag":"noindex, nofollow, noarchive", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer", "Vary":"Cookie"};
export async function validSession(cookie,key,now=Math.floor(Date.now()/1000)) {
 if(!key || key.length<32 || !cookie) return false;
 const match=cookie.match(/(?:^|;\s*)sr_review=(\d{10})\.([0-9a-f]{64})(?:;|$)/); if(!match) return false;
 const exp=Number(match[1]); if(exp<=now || exp>now+86400) return false;
 const enc=new TextEncoder(); const k=await crypto.subtle.importKey("raw",enc.encode(key),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 const sig=new Uint8Array(match[2].match(/../g).map(x=>parseInt(x,16)));
 return await crypto.subtle.verify("HMAC",k,sig,enc.encode(match[1]));
}
export function parseRange(value,size) {
 if(!value) return null; const m=/^bytes=(\d*)-(\d*)$/.exec(value); if(!m || (!m[1]&&!m[2])) return false;
 let start,end; if(!m[1]) { const suffix=Number(m[2]); if(!Number.isSafeInteger(suffix)||suffix<=0) return false; start=Math.max(0,size-suffix);end=size-1; }
 else {start=Number(m[1]); end=m[2]?Number(m[2]):size-1; if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return false;end=Math.min(end,size-1);}
 return {start,end};
}
export async function handle(req,context,key,getVideo) {
 const path=new URL(req.url).pathname;
 if(path==="/coach-review/login.html") return context.next();
 if(!key || key.length<32) return new Response("Review page is not configured",{status:503,headers});
 if(!await validSession(req.headers.get("cookie"),key)) return new Response(null,{status:302,headers:{...headers,Location:"/coach-review/login.html"}});
 if(!["GET","HEAD"].includes(req.method)) return new Response("Method not allowed",{status:405,headers:{...headers,Allow:"GET, HEAD"}});
 if(path==="/coach-review/video.mp4") {
   const bytes=await getVideo(); if(!bytes) return new Response("Video unavailable",{status:503,headers});
   const size=bytes.byteLength, range=parseRange(req.headers.get("range"),size);
   if(range===false) return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${size}`}});
   const start=range?.start??0,end=range?.end??size-1; const videoHeaders={...headers,"Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":String(end-start+1)};
   if(range) videoHeaders["Content-Range"]=`bytes ${start}-${end}/${size}`;
   return new Response(req.method==="HEAD"?null:bytes.slice(start,end+1),{status:range?206:200,headers:videoHeaders});
 }
 if(!["/coach-review","/coach-review/","/coach-review/index.html","/coach-review/wing.png"].includes(path))return new Response("Not found",{status:404,headers});
 const response=await context.next(); const h=new Headers(response.headers); for(const [k,v] of Object.entries(headers))h.set(k,v); return new Response(response.body,{status:response.status,headers:h});
}
export default async (req,context)=>handle(req,context,Deno.env.get("SR_REVIEW_KEY"),async()=>{const {getStore}=await import("@netlify/blobs");return getStore("saints-coaching-review").get("developer-video",{type:"arrayBuffer"});});
export const config={path:["/coach-review","/coach-review/*"],onError:"fail"};
