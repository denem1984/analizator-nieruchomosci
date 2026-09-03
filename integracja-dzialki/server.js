const http=require('http');
const {URL}=require('url');
const PORT=process.env.PORT||10000;
const SOURCE='https://raw.githubusercontent.com/denem1984/analizator-nieruchomosci/main/index.html';
const API='https://analizator-nieruchomosci-api.onrender.com/api/wfs';
let cachedHtml=null,cachedAt=0;
async function getHtml(){
  if(cachedHtml&&Date.now()-cachedAt<30000)return cachedHtml;
  const r=await fetch(SOURCE,{headers:{'Cache-Control':'no-cache','User-Agent':'MAPA integration tester/2.0'}});
  if(!r.ok)throw new Error('GitHub source HTTP '+r.status);
  let html=await r.text();
  const original=html;
  html=html.replace('const parcelWfs="https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza"','const parcelWfs='+JSON.stringify(API));
  html=html.replace('Math.min(15,10+(z-13)*.72)','Math.min(16,10+(z-13)*.72)');
  if(html===original)throw new Error('Nie udało się podmienić WFS w źródle produkcyjnym.');
  cachedHtml=html;cachedAt=Date.now();return html;
}
function send(res,status,type,body){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body)}
http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/health')return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'MAPA integration WFS v2'}));
    if(u.pathname==='/source-check'){
      const html=await getHtml();
      return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,wfsApi:html.includes(JSON.stringify(API)),fontMax16:html.includes('Math.min(16,10+(z-13)*.72)'),htmlLength:html.length,cachedAt:new Date(cachedAt).toISOString()}));
    }
    if(u.pathname==='/'||u.pathname==='/index.html')return send(res,200,'text/html; charset=utf-8',await getHtml());
    return send(res,404,'text/plain; charset=utf-8','Not found');
  }catch(e){return send(res,500,'text/plain; charset=utf-8','Błąd integracji: '+e.message)}
}).listen(PORT,'0.0.0.0',()=>console.log('MAPA integration WFS v2 listening on '+PORT));