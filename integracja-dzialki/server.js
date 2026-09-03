const http=require('http');
const {URL}=require('url');
const PORT=process.env.PORT||10000;
const SOURCE='https://raw.githubusercontent.com/denem1984/analizator-nieruchomosci/main/index.html';
const API='https://analizator-nieruchomosci-api.onrender.com/api/wfs';
const WFS_RE=/const\s+parcelWfs\s*=\s*["'][^"']+["']/;
let cachedHtml=null,cachedAt=0;
async function getHtml(){
  if(cachedHtml&&Date.now()-cachedAt<30000)return cachedHtml;
  const r=await fetch(SOURCE,{headers:{'Cache-Control':'no-cache','User-Agent':'MAPA integration/4.0'}});
  if(!r.ok)throw new Error('GitHub source HTTP '+r.status);
  let html=await r.text();
  const m=html.match(WFS_RE);
  if(!m)throw new Error('Nie znaleziono deklaracji parcelWfs w źródle produkcyjnym.');
  html=html.replace(WFS_RE,'const parcelWfs=location.origin+"/api/wfs"');
  html=html.replace(/Math\.min\(15,10\+\(z-13\)\*\.72\)/g,'Math.min(16,10+(z-13)*.72)');
  const wfsOk=html.includes('const parcelWfs=location.origin+"/api/wfs"');
  if(!wfsOk)throw new Error('Nie udało się podmienić źródła WFS.');
  cachedHtml=html;cachedAt=Date.now();
  console.log('INTEGRATION_SOURCE_OK',JSON.stringify({wfsReplaced:wfsOk,font16:html.includes('Math.min(16,10+(z-13)*.72)'),length:html.length}));
  return html;
}
function send(res,status,type,body){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(body)}
async function proxyApi(req,res){
  const u=new URL(req.url,'http://localhost');
  const target=new URL(API);
  for(const [k,v] of u.searchParams)target.searchParams.set(k,v);
  console.log('INTEGRATION_WFS_PROXY',target.searchParams.get('bbox')||'no-bbox');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),175000);
  try{
    const r=await fetch(target.href,{signal:controller.signal,headers:{Accept:'application/json'}});
    const body=await r.text();
    clearTimeout(timer);
    console.log('INTEGRATION_WFS_RESULT',r.status,body.length);
    return send(res,r.status,r.headers.get('content-type')||'application/json; charset=utf-8',body);
  }catch(e){
    clearTimeout(timer);
    console.error('INTEGRATION_WFS_ERROR',e.message);
    return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:e.name==='AbortError'?'API działek przekroczyło limit czasu.':e.message}));
  }
}
http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    console.log('INTEGRATION_REQUEST',req.method,u.pathname);
    if(req.method==='OPTIONS')return send(res,204,'text/plain','');
    if(u.pathname==='/health')return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'MAPA integration WFS v4'}));
    if(u.pathname==='/source-check'){
      const html=await getHtml();
      return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,wfsProxy:html.includes('const parcelWfs=location.origin+"/api/wfs"'),fontMax16:html.includes('Math.min(16,10+(z-13)*.72)'),htmlLength:html.length,cachedAt:new Date(cachedAt).toISOString()}));
    }
    if(u.pathname==='/api/wfs')return proxyApi(req,res);
    if(u.pathname==='/'||u.pathname==='/index.html')return send(res,200,'text/html; charset=utf-8',await getHtml());
    return send(res,404,'text/plain; charset=utf-8','Not found');
  }catch(e){console.error('INTEGRATION_ERROR',e);return send(res,500,'text/plain; charset=utf-8','Błąd integracji: '+e.message)}
}).listen(PORT,'0.0.0.0',()=>console.log('MAPA integration WFS v4 listening on '+PORT));