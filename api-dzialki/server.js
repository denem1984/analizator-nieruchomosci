const http=require('http');
const {URL}=require('url');
const proj4=require('proj4');
const {PNG}=require('pngjs');
const PORT=process.env.PORT||10000;
const WFS='https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza';
const OWNERSHIP_WMS='https://mapy.geoportal.gov.pl/wss/ext/MapaWlasnosci';
const PISKI_WFS='https://powiatpiski.geoportal2.pl/map/geoportal/wfs.php';
const CRS2180='+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs +type=crs';
proj4.defs('EPSG:2180',CRS2180);
function send(res,status,type,body){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS'});res.end(body)}
function bbox2180(bbox){const p=String(bbox||'').split(',').slice(0,4).map(Number);if(p.length!==4||p.some(v=>!Number.isFinite(v)))return null;const [south,west,north,east]=p;const corners=[[west,south],[east,south],[east,north],[west,north]].map(ll=>proj4('EPSG:4326','EPSG:2180',ll));const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);return{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)}}
function xmlDecode(s){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'\"').replace(/&apos;/g,"'").trim()}
function ringFromPosList(s){const n=String(s||'').trim().split(/\s+/).map(Number);if(n.length<8||n.length%2)return null;const out=[];for(let i=0;i<n.length;i+=2){if(!Number.isFinite(n[i])||!Number.isFinite(n[i+1]))return null;const y=n[i],x=n[i+1],p=proj4('EPSG:2180','EPSG:4326',[x,y]);out.push([p[0],p[1]])}return out}
function ringFromPosList4326(s,latLonOrder){const n=String(s||'').trim().split(/\s+/).map(Number);if(n.length<8||n.length%2)return null;const out=[];for(let i=0;i<n.length;i+=2){const a=n[i],b=n[i+1];if(!Number.isFinite(a)||!Number.isFinite(b))return null;out.push(latLonOrder?[b,a]:[a,b])}return out}
function firstMemberTags(text){const m=text.match(/<wfs:member\b[\s\S]*?<\/wfs:member>/i);if(!m)return[];const tags=new Set();const re=/<([a-zA-Z_][\w:.\-]*)[ \/>]/g;let mm;while((mm=re.exec(m[0]))){const t=mm[1];if(!/^gml:/i.test(t))tags.add(t)}return Array.from(tags)}
function parseGml4326(text,latLonOrder,includeGroup=false){const features=[];const members=text.match(/<wfs:member\b[\s\S]*?<\/wfs:member>/gi)||[];for(const member of members){const idm=member.match(/<[\w:]*id_dzialki\b[^>]*>([\s\S]*?)<\/[\w:]*id_dzialki>/i);const id=xmlDecode(idm&&idm[1]);if(!id)continue;let group=null;if(includeGroup){const gm=member.match(/<([\w:]*(?:grupa|rejestr)[\w:]*)\b[^>]*>([\s\S]*?)<\/\1>/i);group=xmlDecode(gm&&gm[2])||null}const rings=[];const re=/<gml:(?:exterior|interior)\b[\s\S]*?<gml:posList\b[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:(?:exterior|interior)>/gi;let m;while((m=re.exec(member))){const ring=ringFromPosList4326(m[1],latLonOrder);if(ring)rings.push(ring)}if(!rings.length)continue;features.push({type:'Feature',properties:{id_dzialki:id,GRUPA_REJESTROWA:group},geometry:{type:'Polygon',coordinates:rings}})}return{type:'FeatureCollection',features}}
function parseGml(text,includeGroup=false){const features=[];const members=text.match(/<wfs:member\b[\s\S]*?<\/wfs:member>/gi)||[];for(const member of members){const idm=member.match(/<(?:ms:)?id_dzialki\b[^>]*>([\s\S]*?)<\/(?:ms:)?id_dzialki>/i);const id=xmlDecode(idm&&idm[1]);if(!id)continue;let group=null;if(includeGroup){const gm=member.match(/<(?:ms:)?grupa_rejestrowa\b[^>]*>([\s\S]*?)<\/(?:ms:)?grupa_rejestrowa>/i);group=xmlDecode(gm&&gm[1])||null}const rings=[];const re=/<gml:(?:exterior|interior)\b[\s\S]*?<gml:posList\b[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:(?:exterior|interior)>/gi;let m;while((m=re.exec(member))){const ring=ringFromPosList(m[1]);if(ring)rings.push(ring)}if(!rings.length)continue;features.push({type:'Feature',properties:{id_dzialki:id,GRUPA_REJESTROWA:group},geometry:{type:'Polygon',coordinates:rings}})}return{type:'FeatureCollection',features}}
function normalizeJsonGeoJson(data,includeGroup=false){if(!data||!Array.isArray(data.features))return null;let transformed=0;function walk(v){if(!Array.isArray(v))return v;if(v.length>=2&&typeof v[0]==='number'&&typeof v[1]==='number'){const x=v[0],y=v[1];if(Math.abs(x)>180||Math.abs(y)>90){const p=proj4('EPSG:2180','EPSG:4326',[x,y]);transformed++;return[p[0],p[1],...v.slice(2)]}return v}return v.map(walk)}const out=JSON.parse(JSON.stringify(data));for(const f of out.features){if(f&&f.geometry&&f.geometry.coordinates)f.geometry.coordinates=walk(f.geometry.coordinates);if(includeGroup&&f&&f.properties&&!('GRUPA_REJESTROWA'in f.properties)){const p=f.properties;f.properties.GRUPA_REJESTROWA=p.grupa_rejestrowa??p.grupaRejestrowa??p.GROUP_REJESTROWA??null}}console.log('WFS_JSON_NORMALIZED',JSON.stringify({features:out.features.length,transformedCoordinates:transformed,sampleId:out.features[0]?.properties?.id_dzialki||out.features[0]?.properties?.idDzialki||null,sampleGroup:out.features[0]?.properties?.GRUPA_REJESTROWA||null,sampleGeometry:out.features[0]?.geometry?.type||null}));return out}
async function fetchWfs(target,includeGroup=false){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);try{const r=await fetch(target.href,{signal:controller.signal,headers:{'User-Agent':'MAPA ownership county diagnostic/1.0','Accept':'application/json,text/json,application/xml,text/xml,*/*'}});const text=await r.text();clearTimeout(timer);const ct=(r.headers.get('content-type')||'').toLowerCase();console.log('OWNERSHIP_WFS_RESPONSE',JSON.stringify({status:r.status,contentType:ct,bytes:text.length,preview:text.slice(0,180)}));if(ct.includes('json')){try{const data=normalizeJsonGeoJson(JSON.parse(text),includeGroup);if(data)return{status:r.status,data}}catch(e){console.error('OWNERSHIP_WFS_JSON_PARSE_ERROR',e.message)}return{status:r.status,error:'Nie udało się sparsować JSON WFS.'}}if(r.ok&&/<(?:wfs:)?FeatureCollection\b/i.test(text))return{status:200,data:parseGml(text,includeGroup)};return{status:r.status,error:'WFS nie zwrócił danych GeoJSON/GML.',preview:text.slice(0,500)}}catch(e){clearTimeout(timer);return{status:502,error:e.name==='AbortError'?'Powiatowy WFS przekroczył limit 60 s.':e.message}}}
async function piskiCapabilities(res){
  // Diagnostyka: pyta serwer WFS powiatu piskiego "jakie w ogóle masz warstwy?"
  // (standardowa funkcja WFS GetCapabilities) i wypisuje wszystkie nazwy warstw,
  // żeby znaleźć tę z grupą rejestrową / mapą własności, skoro warstwa
  // "ewns:dzialki" jej nie zawiera.
  const target=new URL(PISKI_WFS);
  target.searchParams.set('service','WFS');
  target.searchParams.set('request','GetCapabilities');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await fetch(target.href,{signal:controller.signal,headers:{'User-Agent':'MAPA capabilities probe/1.0'}});
    const text=await r.text();
    clearTimeout(timer);
    const names=Array.from(text.matchAll(/<Name>([^<]+)<\/Name>/gi)).map(m=>m[1]);
    const titles=Array.from(text.matchAll(/<Title>([^<]+)<\/Title>/gi)).map(m=>m[1]);
    const layers=names.map((n,i)=>({name:n,title:titles[i]||null}));
    const interesting=layers.filter(l=>/grup|wlasn|rejestr|własn/i.test(l.name+' '+(l.title||'')));
    console.log('PISKI_CAPABILITIES',JSON.stringify({status:r.status,totalLayers:layers.length,interesting}));
    return send(res,200,'application/json; charset=utf-8',JSON.stringify({status:r.status,totalLayers:layers.length,allLayers:layers,interesting},null,2));
  }catch(e){
    clearTimeout(timer);
    return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:e.name==='AbortError'?'Timeout':e.message}));
  }
}

async function mapaWlasnosciCapabilities(res){
  // Diagnostyka: pyta ogólnopolski WMS GUGiK "Mapa własności" o listę jego
  // warstw (standardowe GetCapabilities), żeby poznać poprawną nazwę warstwy
  // zamiast zgadywać ("dzialki" było tylko domysłem w starym kodzie).
  const target=new URL(OWNERSHIP_WMS);
  target.searchParams.set('SERVICE','WMS');
  target.searchParams.set('REQUEST','GetCapabilities');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await fetch(target.href,{signal:controller.signal,headers:{'User-Agent':'MAPA capabilities probe/1.0'}});
    const text=await r.text();
    clearTimeout(timer);
    const names=Array.from(text.matchAll(/<Name>([^<]+)<\/Name>/gi)).map(m=>m[1]);
    const titles=Array.from(text.matchAll(/<Title>([^<]+)<\/Title>/gi)).map(m=>m[1]);
    const layers=names.map((n,i)=>({name:n,title:titles[i]||null}));
    // Szukamy konkretnie bloku <Layer> dla warstwy "dzialki" i wypisujemy
    // jej dostępne STYLE (nazwa techniczna + tytuł) — to prawdopodobnie tam
    // jest ukryty styl kolorujący wg grupy rejestrowej, którego nie prosiliśmy.
    let dzialkiStyles=[];
    const layerBlockMatch=text.match(/<Layer[^>]*>\s*<Name>dzialki<\/Name>[\s\S]*?<\/Layer>/i);
    if(layerBlockMatch){
      const block=layerBlockMatch[0];
      const styleBlocks=block.match(/<Style>[\s\S]*?<\/Style>/gi)||[];
      dzialkiStyles=styleBlocks.map(sb=>{
        const n=sb.match(/<Name>([^<]+)<\/Name>/i);
        const t=sb.match(/<Title>([^<]+)<\/Title>/i);
        return{name:n?n[1]:null,title:t?t[1]:null};
      });
    }
    console.log('MAPA_WLASNOSCI_CAPABILITIES',JSON.stringify({status:r.status,contentType:r.headers.get('content-type'),totalLayers:layers.length,dzialkiStyles}));
    return send(res,200,'application/json; charset=utf-8',JSON.stringify({status:r.status,contentType:r.headers.get('content-type'),totalLayers:layers.length,layers,dzialkiStyles,dzialkiLayerFound:!!layerBlockMatch,rawPreview:text.slice(0,4000)},null,2));
  }catch(e){
    clearTimeout(timer);
    return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:e.name==='AbortError'?'Timeout':e.message}));
  }
}

async function ownershipCounty(reqUrl,res){
  const u=new URL(reqUrl,'http://localhost');
  const rawBbox=u.searchParams.get('bbox');
  const parts=String(rawBbox||'').split(',').slice(0,4).map(Number);
  if(parts.length!==4||parts.some(v=>!Number.isFinite(v)))return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'Nieprawidłowy bbox EPSG:4326.'}));
  const[south,west,north,east]=parts;

  // POPRAWKA: serwer WFS powiatu piskiego (geoportal2.pl) NIE przyjmuje
  // współrzędnych w metrach (EPSG:2180) — sonda diagnostyczna pokazała
  // 0 wyników dla tego formatu. Zwraca dane wyłącznie, gdy bbox podamy
  // wprost w stopniach (EPSG:4326), bez żadnej konwersji. Nie wiemy z góry,
  // czy zwrócone współrzędne w GML są w kolejności lat,lon czy lon,lat —
  // dlatego (ten sam wzorzec co gdzie indziej w tym pliku) sprawdzamy
  // (inBounds), czy wynik faktycznie leży w żądanym obszarze, i w razie
  // potrzeby próbujemy drugiej interpretacji.

  function inBounds(data){
    if(!data||!Array.isArray(data.features)||!data.features.length)return false;
    const f=data.features[0];
    let c=f&&f.geometry&&f.geometry.coordinates;
    while(Array.isArray(c)&&Array.isArray(c[0]))c=c[0];
    if(!Array.isArray(c)||typeof c[0]!=='number'||typeof c[1]!=='number')return false;
    const[lon,lat]=c;
    const padLat=Math.max(north-south,0.05),padLon=Math.max(east-west,0.05);
    return lon>=west-padLon&&lon<=east+padLon&&lat>=south-padLat&&lat<=north+padLat;
  }

  async function attempt(latLonOrder){
    const target=new URL(PISKI_WFS);
    for(const[k,v]of Object.entries({
      service:'WFS',
      version:'2.0.0',
      request:'GetFeature',
      typenames:'ewns:dzialki',
      srsName:'EPSG:4326',
      bbox:rawBbox,
      startIndex:'0',
      count:'1000',
      propertyName:'id_dzialki,grupa_rejestrowa,geom'
    }))target.searchParams.set(k,v);
    const label=latLonOrder?'lat,lon':'lon,lat';
    console.log('OWNERSHIP_COUNTY_ATTEMPT',JSON.stringify({axisOrder:label,bbox:rawBbox}));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
      const r=await fetch(target.href,{signal:controller.signal,headers:{'User-Agent':'MAPA ownership county/2.0','Accept':'application/json,text/json,application/xml,text/xml,*/*'}});
      const text=await r.text();
      clearTimeout(timer);
      const ct=(r.headers.get('content-type')||'').toLowerCase();
      let data=null;
      if(r.ok&&/<(?:wfs:)?FeatureCollection\b/i.test(text))data=parseGml4326(text,latLonOrder,true);
      console.log('OWNERSHIP_COUNTY_FIELDS',JSON.stringify({axisOrder:label,tags:firstMemberTags(text)}));
      const valid=data&&inBounds(data);
      if(data){
        const groups={};for(const f of data.features||[]){const g=f.properties?.GRUPA_REJESTROWA??'BRAK';groups[g]=(groups[g]||0)+1}
        console.log('OWNERSHIP_COUNTY_RESULT',JSON.stringify({axisOrder:label,features:data.features?.length||0,groups,inBounds:!!valid}));
      }
      return{ok:!!data,valid:!!valid,status:r.status,ct,text,data};
    }catch(e){
      clearTimeout(timer);
      return{ok:false,valid:false,error:e.name==='AbortError'?'Powiatowy WFS przekroczył limit 60 s.':e.message};
    }
  }

  let out=await attempt(true);   // najpierw zakładamy oficjalną kolejność EPSG:4326 (lat,lon)
  if(!out.valid){
    const out2=await attempt(false); // w razie czego: lon,lat
    if(out2.valid)out=out2;
    else if(out2.ok&&!out.ok)out=out2;
  }

  if(out.ok&&out.data)return send(res,200,'application/json; charset=utf-8',JSON.stringify(out.data));
  if(out.error)return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:out.error}));
  return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:'WFS powiatu piskiego nie zwrócił danych.',status:out.status,contentType:out.ct,preview:(out.text||'').slice(0,500)}));
}

async function ownershipCountyProbe(reqUrl,res){const u=new URL(reqUrl,'http://localhost');const b=bbox2180(u.searchParams.get('bbox'));if(!b)return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'Nieprawidłowy bbox EPSG:4326.'}));const bbox=`${b.minX.toFixed(2)},${b.minY.toFixed(2)},${b.maxX.toFixed(2)},${b.maxY.toFixed(2)}`;const variants=[
{name:'A_bbox_no_property',params:{service:'WFS',version:'2.0.0',request:'GetFeature',typenames:'ewns:dzialki',srsName:'EPSG:2180',bbox,startIndex:'0',count:'5'}},
{name:'B_bbox_id_geom',params:{service:'WFS',version:'2.0.0',request:'GetFeature',typenames:'ewns:dzialki',srsName:'EPSG:2180',bbox,startIndex:'0',count:'5',propertyName:'id_dzialki,geom'}},
{name:'C_bbox_id_group_geom',params:{service:'WFS',version:'2.0.0',request:'GetFeature',typenames:'ewns:dzialki',srsName:'EPSG:2180',bbox,startIndex:'0',count:'5',propertyName:'id_dzialki,grupa_rejestrowa,geom'}},
{name:'D_no_bbox',params:{service:'WFS',version:'2.0.0',request:'GetFeature',typenames:'ewns:dzialki',srsName:'EPSG:2180',startIndex:'0',count:'1',propertyName:'id_dzialki,geom'}},
{name:'E_4326_bbox',params:{service:'WFS',version:'2.0.0',request:'GetFeature',typenames:'ewns:dzialki',srsName:'EPSG:4326',bbox:u.searchParams.get('bbox'),startIndex:'0',count:'5',propertyName:'id_dzialki,geom'}}
];
const results=[];for(const v of variants){const target=new URL(PISKI_WFS);for(const[k,val]of Object.entries(v.params))target.searchParams.set(k,val);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{const r=await fetch(target.href,{signal:controller.signal,headers:{'User-Agent':'MAPA ownership WFS probe/1.0','Accept':'application/json,application/xml,text/xml,*/*'}});const text=await r.text();clearTimeout(timer);const ct=(r.headers.get('content-type')||'').toLowerCase();const m=text.match(/numberMatched="([^"]*)"[^>]*numberReturned="([^"]*)"/i);const firstId=(text.match(/<id_dzialki[^>]*>([^<]+)</i)||[])[1]||null;const hasGroup=/grupa_rejestrowa/i.test(text);const result={name:v.name,status:r.status,contentType:ct,bytes:text.length,numberMatched:m?.[1]??null,numberReturned:m?.[2]??null,firstId,hasGroup,preview:text.slice(0,220)};results.push(result);console.log('OWNERSHIP_WFS_PROBE',JSON.stringify(result));}catch(e){clearTimeout(timer);const result={name:v.name,status:502,error:e.name==='AbortError'?'timeout':e.message};results.push(result);console.log('OWNERSHIP_WFS_PROBE',JSON.stringify(result))}}
return send(res,200,'application/json; charset=utf-8',JSON.stringify({bbox4326:u.searchParams.get('bbox'),bbox2180:bbox,results},null,2))}
function q(u,name){return u.searchParams.get(name)||u.searchParams.get(name.toLowerCase())||u.searchParams.get(name.toUpperCase())}
function bbox4326From3857(bbox){const p=String(bbox||'').split(',').slice(0,4).map(Number);if(p.length!==4||p.some(v=>!Number.isFinite(v)))return null;const [minX,minY,maxX,maxY]=p;const a=proj4('EPSG:3857','EPSG:4326',[minX,minY]),b=proj4('EPSG:3857','EPSG:4326',[maxX,maxY]);return [a[0],a[1],b[0],b[1]].join(',')}
async function ownership(reqUrl,res){const u=new URL(reqUrl,'http://localhost');const target=new URL(OWNERSHIP_WMS);const incomingBbox=q(u,'bbox');const incomingSrs=q(u,'srs')||q(u,'crs');const incomingVersion=q(u,'version');const sourceBbox=incomingSrs&&incomingSrs.toUpperCase().includes('3857')?bbox4326From3857(incomingBbox):incomingBbox;for(const[k,v]of u.searchParams.entries())target.searchParams.set(k,v);target.searchParams.set('SERVICE','WMS');target.searchParams.set('REQUEST','GetMap');target.searchParams.set('VERSION','1.1.1');target.searchParams.set('LAYERS',q(u,'layers')||'dzialki');target.searchParams.set('STYLES',q(u,'styles')||'');target.searchParams.set('FORMAT',q(u,'format')||'image/png');target.searchParams.set('TRANSPARENT',q(u,'transparent')||'true');target.searchParams.set('SRS','EPSG:4326');target.searchParams.delete('CRS');if(sourceBbox)target.searchParams.set('BBOX',sourceBbox);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);try{const r=await fetch(target.href,{signal:controller.signal,headers:{'User-Agent':'MAPA ownership proxy/1.1','Accept':'image/png,image/jpeg,text/xml,*/*'}});const body=Buffer.from(await r.arrayBuffer());clearTimeout(timer);const ct=r.headers.get('content-type')||'application/octet-stream';const diag={status:r.status,contentType:ct,bytes:body.length,layer:target.searchParams.get('LAYERS'),srs:target.searchParams.get('SRS'),bbox:target.searchParams.get('BBOX'),incomingSrs,incomingVersion};if(r.ok&&ct.toLowerCase().includes('image/png')){try{const png=PNG.sync.read(body);const counts=new Map();for(let i=0;i<png.data.length;i+=4){const a=png.data[i+3];if(a===0)continue;const key=`${png.data[i]},${png.data[i+1]},${png.data[i+2]},${a}`;counts.set(key,(counts.get(key)||0)+1)}diag.width=png.width;diag.height=png.height;diag.uniqueColors=counts.size;diag.topColors=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)}catch(e){diag.pngParseError=e.message}}console.log('OWNERSHIP_PROXY',JSON.stringify(diag));
    if(!ct.toLowerCase().startsWith('image/')){
      // Serwer GUGiK zwrócił błąd (np. XML z opisem problemu) zamiast obrazka.
      // Pokazujemy to jako czytelny tekst w przeglądarce zamiast wymuszać
      // pobranie dziwnego pliku.
      return send(res,200,'application/json; charset=utf-8',JSON.stringify({...diag,serverMessage:body.toString('utf-8').slice(0,60000)},null,2));
    }
    return send(res,r.status,ct,body)}catch(e){clearTimeout(timer);return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:e.name==='AbortError'?'Mapa własności przekroczyła limit 90 s.':e.message}))}}
async function wfs(reqUrl,res){
  const u=new URL(reqUrl,'http://localhost');
  const rawBbox=u.searchParams.get('bbox');
  const parts=String(rawBbox||'').split(',').slice(0,4).map(Number);
  if(parts.length!==4||parts.some(v=>!Number.isFinite(v)))return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'Nieprawidłowy bbox EPSG:4326.'}));
  const[south,west,north,east]=parts;
  const b=bbox2180(rawBbox);
  if(!b)return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'Nieprawidłowy bbox EPSG:4326.'}));

  // POPRAWKA #1: GUGiK WFS (ms:dzialki) zaczął odrzucać zapytania w formacie
  // fes:Filter/gml:Envelope ("InvalidParameterValue" / "Unsupported FILTER").
  // Używamy prostszego, standardowego parametru BBOX (WFS 2.0.0), tak jak już
  // działa to w funkcji ownershipCounty() w tym samym pliku.
  //
  // POPRAWKA #2: nie wiadomo z góry, czy serwer oczekuje kolejności X,Y czy
  // Y,X — a co gorsza, przy błędnej kolejności serwer NIE zwraca błędu, tylko
  // po cichu podaje działki z zupełnie innego miejsca w Polsce. Dlatego po
  // otrzymaniu odpowiedzi sprawdzamy (inBounds), czy zwrócone działki faktycznie
  // leżą w żądanym obszarze mapy. Jeśli nie — automatycznie próbujemy drugiej
  // kolejności współrzędnych, zanim cokolwiek odeślemy do przeglądarki.
  // Front-end i mechanizm rysowania etykiet pozostają bez zmian.

  function inBounds(data){
    if(!data||!Array.isArray(data.features)||!data.features.length)return false;
    const f=data.features[0];
    let c=f&&f.geometry&&f.geometry.coordinates;
    while(Array.isArray(c)&&Array.isArray(c[0]))c=c[0];
    if(!Array.isArray(c)||typeof c[0]!=='number'||typeof c[1]!=='number')return false;
    const[lon,lat]=c;
    const padLat=Math.max(north-south,0.05),padLon=Math.max(east-west,0.05);
    return lon>=west-padLon&&lon<=east+padLon&&lat>=south-padLat&&lat<=north+padLat;
  }

  async function attempt(bboxStr,axisLabel){
    const target=new URL(WFS);
    for(const[k,v]of Object.entries({
      service:'WFS',
      version:'2.0.0',
      request:'GetFeature',
      typenames:'ms:dzialki',
      srsName:'EPSG:2180',
      bbox:bboxStr,
      startIndex:'0',
      count:'1000',
      propertyName:'id_dzialki,geom'
    }))target.searchParams.set(k,v);
    console.log('WFS_BBOX_ATTEMPT',JSON.stringify({axisOrder:axisLabel,bbox:bboxStr}));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),170000);
    try{
      const r=await fetch(target.href,{signal:controller.signal,headers:{'User-Agent':'MAPA production parcel labels/2.4','Accept':'application/json,text/json,application/xml,text/xml,*/*'}});
      const text=await r.text();
      clearTimeout(timer);
      const ct=(r.headers.get('content-type')||'').toLowerCase();
      const isException=/<(?:ows:)?ExceptionReport\b/i.test(text)||/InvalidParameterValue/i.test(text);
      let data=null;
      if(!isException){
        if(ct.includes('json')){
          try{data=normalizeJsonGeoJson(JSON.parse(text))}catch(e){console.error('WFS_JSON_PARSE_ERROR',e.message)}
        }else if(r.ok&&/<(?:wfs:)?FeatureCollection\b/i.test(text)){
          data=parseGml(text);
        }
      }
      const valid=data&&inBounds(data);
      console.log('WFS_RESPONSE',JSON.stringify({axisOrder:axisLabel,status:r.status,contentType:ct,bytes:text.length,hasData:!!data,featureCount:data?.features?.length??0,inBounds:valid,preview:text.slice(0,180)}));
      return{ok:!!data,valid:!!valid,status:r.status,ct,text,data};
    }catch(e){
      clearTimeout(timer);
      return{ok:false,valid:false,error:e.name==='AbortError'?'GUGiK WFS przekroczył limit 170 s.':e.message};
    }
  }

  const bboxXY=`${b.minX.toFixed(2)},${b.minY.toFixed(2)},${b.maxX.toFixed(2)},${b.maxY.toFixed(2)}`;
  const bboxYX=`${b.minY.toFixed(2)},${b.minX.toFixed(2)},${b.maxY.toFixed(2)},${b.maxX.toFixed(2)}`;

  let out=await attempt(bboxXY,'X,Y');
  if(!out.valid){
    const out2=await attempt(bboxYX,'Y,X');
    if(out2.valid)out=out2;
    else if(out2.ok&&!out.ok)out=out2;
  }

  if(out.ok&&out.data)return send(res,200,'application/json; charset=utf-8',JSON.stringify(out.data));
  if(out.error)return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:out.error}));
  return send(res,502,'application/json; charset=utf-8',JSON.stringify({error:'WFS nie zwrócił danych GeoJSON/GML.',status:out.status,contentType:out.ct,preview:(out.text||'').slice(0,500)}));
}

const server=http.createServer((req,res)=>{if(req.method==='OPTIONS')return send(res,204,'text/plain','');try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/health')return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'MAPA production parcel labels API',format:'GeoJSON',outputCrs:'EPSG:4326',ownershipProxy:true,ownershipCountyDiagnostic:true}));if(u.pathname==='/api/wfs')return wfs(req.url,res);if(u.pathname==='/api/ownership')return ownership(req.url,res);if(u.pathname==='/api/ownership-county')return ownershipCounty(req.url,res);if(u.pathname==='/api/ownership-county-probe')return ownershipCountyProbe(req.url,res);if(u.pathname==='/api/piski-capabilities')return piskiCapabilities(res);if(u.pathname==='/api/mapa-wlasnosci-capabilities')return mapaWlasnosciCapabilities(res);return send(res,404,'application/json; charset=utf-8',JSON.stringify({error:'Not found'}))}catch(e){return send(res,500,'application/json; charset=utf-8',JSON.stringify({error:e.message}))}});
server.listen(PORT,'0.0.0.0',()=>console.log('MAPA production parcel labels API listening on '+PORT));