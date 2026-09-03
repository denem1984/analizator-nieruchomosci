const http=require('http');
const {URL}=require('url');
const PORT=process.env.PORT||10000;
const SOURCE='https://raw.githubusercontent.com/denem1984/analizator-nieruchomosci/main/index.html';
const API='https://analizator-nieruchomosci-api.onrender.com/api/wfs';
let cachedHtml=null,cachedAt=0;

function replacementLoader(){return `async function loadParcelLabels(){
  if(!document.getElementById("kieg").checked||map.getZoom()<13){
    clearParcelLabels();
    if(map.hasLayer(parcelLabelsWms))map.removeLayer(parcelLabelsWms);
    return
  }
  const my=++parcelLabelRequest;
  const b=map.getBounds(),pad=.12;
  const latSpan=b.getNorth()-b.getSouth(),lonSpan=b.getEast()-b.getWest();
  const south=Math.max(-90,b.getSouth()-latSpan*pad),north=Math.min(90,b.getNorth()+latSpan*pad);
  const west=b.getWest()-lonSpan*pad,east=b.getEast()+lonSpan*pad;
  const u=new URL(location.origin+"/api/wfs");
  const q={service:"WFS",version:"2.0.0",request:"GetFeature",typenames:"ms:dzialki",bbox:\`\${south},\${west},\${north},\${east},EPSG:4326\`,srsName:"EPSG:4326",outputFormat:"application/json",count:"2000",propertyName:"id_dzialki,geom"};
  Object.entries(q).forEach(([k,v])=>u.searchParams.set(k,v));
  try{
    const res=await fetch(u.href,{headers:{Accept:"application/json"}});
    if(my!==parcelLabelRequest)return;
    const text=await res.text();
    if(!res.ok)throw Error("WFS HTTP "+res.status+": "+text.slice(0,200));
    let data;try{data=JSON.parse(text)}catch{throw Error("Proxy WFS nie zwrócił GeoJSON")}
    const fs=(data.features||[]).filter(f=>f&&f.geometry);
    console.log("MAPA_WFS_OK",{features:fs.length,url:u.href});
    if(window.parcelDiag){window.parcelDiag.textContent="WFS działki: "+fs.length+" | etykiety: "+fs.length;window.parcelDiag.style.display="block"}
    renderParcelLabels(fs);
    if(map.hasLayer(parcelLabelsWms))map.removeLayer(parcelLabelsWms);
  }catch(e){
    console.warn("Dynamiczne etykiety działek:",e);
    if(window.parcelDiag){window.parcelDiag.textContent="WFS błąd: "+e.message;window.parcelDiag.style.display="block"}
    clearParcelLabels();
    if(!map.hasLayer(parcelLabelsWms))map.addLayer(parcelLabelsWms);
  }
}`}

async function getHtml(){
 if(cachedHtml&&Date.now()-cachedAt<30000)return cachedHtml;
 const r=await fetch(SOURCE,{headers:{'Cache-Control':'no-cache','User-Agent':'MAPA integration/7.0'}});
 if(!r.ok)throw new Error('GitHub source HTTP '+r.status);
 let html=await r.text();
 const start=html.indexOf('async function loadParcelLabels(){');
 const end=html.indexOf('function scheduleParcelLabels(){',start);
 if(start<0||end<0)throw new Error('Nie znaleziono funkcji loadParcelLabels/scheduleParcelLabels.');
 html=html.slice(0,start)+replacementLoader()+'\n'+html.slice(end);
 html=html.replace(/Math\.min\(15,10\+\(z-13\)\*\.72\)/g,'Math.min(16,10+(z-13)*.72)');
 const diag=`<script>(function(){function d(){if(window.parcelDiag)return;var e=document.createElement('div');e.id='parcelDiag';e.style.cssText='position:fixed;left:12px;bottom:12px;z-index:99999;background:rgba(0,0,0,.78);color:#fff;padding:6px 9px;border-radius:5px;font:12px Arial;display:none;pointer-events:none';e.textContent='WFS działki: oczekiwanie';document.body.appendChild(e);window.parcelDiag=e}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',d);else d()})();</script>`;
 html=html.replace('</body>',diag+'</body>');
 cachedHtml=html;cachedAt=Date.now();
 console.log('INTEGRATION_SOURCE_OK',JSON.stringify({loaderReplaced:html.includes('MAPA_WFS_OK'),font16:html.includes('Math.min(16,10+(z-13)*.72)'),length:html.length}));
 return html;
}
function send(res,status,type,body){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(body)}
async function proxyApi(req,res){
 const u=new URL(req.url,'http://localhost');
 const target=new URL(API);
 for(const [k,v] of u.searchParams)target.searchParams.set(k,v);
 console.log('INTEGRATION_WFS_PROXY_START',target.href);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),175000);
 try{const r=await fetch(target.href,{signal:controller.signal,headers:{Accept:'application/json'}});const body=await r.text();clearTimeout(timer);console.log('INTEGRATION_WFS_PROXY_RESULT',r.status,body.length);return send(res,r.status,r.headers.get('content-type')||'application/json; charset=utf-8',body)}
 catch(e){clearTimeout(timer);console.error('INTEGRATION_WFS_PROXY_ERROR',e.name,e.message);return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:e.name==='AbortError'?'API działek przekroczyło limit czasu.':e.message}))}
}
http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');console.log('INTEGRATION_REQUEST',req.method,u.pathname,u.search);
 if(req.method==='OPTIONS')return send(res,204,'text/plain','');
 if(u.pathname==='/health')return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'MAPA integration WFS v7'}));
 if(u.pathname==='/source-check'){const html=await getHtml();return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,loaderReplaced:html.includes('MAPA_WFS_OK'),fontMax16:html.includes('Math.min(16,10+(z-13)*.72)'),htmlLength:html.length,cachedAt:new Date(cachedAt).toISOString()}));}
 if(u.pathname==='/api/wfs')return proxyApi(req,res);
 if(u.pathname==='/test-wfs'){const target=new URL(API);target.searchParams.set('bbox','53.0,14.0,53.1,14.1');console.log('INTEGRATION_TEST_WFS',target.href);const r=await fetch(target.href,{headers:{Accept:'application/json'}});const body=await r.text();return send(res,r.status,r.headers.get('content-type')||'application/json; charset=utf-8',body)}
 if(u.pathname==='/'||u.pathname==='/index.html')return send(res,200,'text/html; charset=utf-8',await getHtml());
 return send(res,404,'text/plain; charset=utf-8','Not found');
}catch(e){console.error('INTEGRATION_ERROR',e);return send(res,500,'text/plain; charset=utf-8','Błąd integracji: '+e.message)}}).listen(PORT,'0.0.0.0',()=>console.log('MAPA integration WFS v7 listening on '+PORT));