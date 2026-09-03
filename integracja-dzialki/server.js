const http=require('http');
const {URL}=require('url');
const PORT=process.env.PORT||10000;
const SOURCE='https://raw.githubusercontent.com/denem1984/analizator-nieruchomosci/main/index.html';
const API='https://analizator-nieruchomosci-api.onrender.com/api/wfs';
const WFS_RE=/const\s+parcelWfs\s*=\s*["'][^"']+["']/;
const FONT_RE=/Math\.min\(15,10\+\(z-13\)\.72\)/g;
let cachedHtml=null,cachedAt=0;
async function getHtml(){
  if(cachedHtml&&Date.now()-cachedAt<30000)return cachedHtml;
  const r=await fetch(SOURCE,{headers:{'Cache-Control':'no-cache','User-Agent':'MAPA integration tester/3.0'}});
  if(!r.ok)throw new Error('GitHub source HTTP '+r.status);
  let html=await r.text();
  const before=html;
  const m=html.match(WFS_RE);
  if(!m)throw new Error('Nie znaleziono deklaracji parcelWfs w źródle produkcyjnym.');
  html=html.replace(WFS_RE,'const parcelWfs='+JSON.stringify(API));
  html=html.replace(FONT_RE,'Math.min(16,10+(z-13)*.72)');
  html=html.replace('</head>','<script>window.__MAPA_INTEGRATION_WFS_API__='+JSON.stringify(API)+';</script></head>');
  const ok=html.includes('const parcelWfs='+JSON.stringify(API))&&html.includes(JSON.stringify(API));
  if(!ok||html===before)throw new Error('Nie udało się zastosować transformacji integracji.');
  cachedHtml=html;cachedAt=Date.now();
  console.log('INTEGRATION_SOURCE_OK',JSON.stringify({wfsReplaced:true,font16:html.includes('Math.min(16,10+(z-13)*.72)'),length:html.length}));
  return html;
}
function send(res,status,type,body){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(body)}
http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    console.log('INTEGRATION_REQUEST',req.method,u.pathname);
    if(u.pathname==='/health')return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'MAPA integration WFS v3'}));
    if(u.pathname==='/source-check'){
      const html=await getHtml();
      return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,wfsApi:html.includes('const parcelWfs='+JSON.stringify(API)),fontMax16:html.includes('Math.min(16,10+(z-13)*.72)'),htmlLength:html.length,cachedAt:new Date(cachedAt).toISOString()}));
    }
    if(u.pathname==='/'||u.pathname==='/index.html')return send(res,200,'text/html; charset=utf-8',await getHtml());
    return send(res,404,'text/plain; charset=utf-8','Not found');
  }catch(e){console.error('INTEGRATION_ERROR',e);return send(res,500,'text/plain; charset=utf-8','Błąd integracji: '+e.message)}
}).listen(PORT,'0.0.0.0',()=>console.log('MAPA integration WFS v3 listening on '+PORT));