import { scryptSync, timingSafeEqual, createHmac } from "node:crypto";
const secureHeaders = { "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer" };
export async function handler(req, env = process.env) {
  if (req.method !== "POST") return new Response("Method not allowed", { status:405, headers:{...secureHeaders, Allow:"POST"} });
  const hashSpec=env.SR_REVIEW_HASH, key=env.SR_REVIEW_KEY;
  if (!hashSpec || !key || key.length < 32) return new Response("Review page is not configured", {status:503,headers:secureHeaders});
  const origin=req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin) return new Response("Forbidden", {status:403,headers:secureHeaders});
  if (Number(req.headers.get("content-length") || 0)>1024) return new Response("Request too large",{status:413,headers:secureHeaders});
  let form; try { const text=await req.text(); if(text.length>1024) throw Error(); form=new URLSearchParams(text); } catch { return new Response("Bad request",{status:400,headers:secureHeaders}); }
  const password=form.get("password") || ""; const [saltHex,expectedHex]=hashSpec.split(":");
  if (!/^[0-9a-f]{32}$/i.test(saltHex || "") || !/^[0-9a-f]{64}$/i.test(expectedHex || "") || password.length>128) return new Response("Review page is not configured",{status:503,headers:secureHeaders});
  const actual=scryptSync(password,Buffer.from(saltHex,"hex"),32,{N:16384,r:8,p:1,maxmem:64*1024*1024}); const expected=Buffer.from(expectedHex,"hex");
  if(!timingSafeEqual(actual,expected)) return new Response('Incorrect password. <a href="/coach-review/login.html">Try again</a>.',{status:401,headers:{...secureHeaders,"Content-Type":"text/html; charset=utf-8"}});
  const expires=Math.floor(Date.now()/1000)+86400; const payload=String(expires); const sig=createHmac("sha256",key).update(payload).digest("hex");
  return new Response(null,{status:303,headers:{...secureHeaders,Location:"/coach-review/","Set-Cookie":`sr_review=${payload}.${sig}; Path=/coach-review; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`}});
}
export default (req) => handler(req);
