const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const STORE = path.join(ROOT, 'data', 'state.json');
const DEFAULT_STATE = {
  savedCities: ['tokyo','sydney','los-angeles','new-york','london'],
  selectedCity: 'los-angeles',
  preferences: { timeFormat: '24', showSeconds: false, theme: 'light', mapStyle: 'minimal', animations: 'full' }
};

function readState() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(DEFAULT_STATE, null, 2)); return structuredClone(DEFAULT_STATE); }
}
function writeState(state) { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(state, null, 2)); }
function json(res, status, body) { const text = JSON.stringify(body); res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(text); }
function body(req) { return new Promise((resolve,reject)=>{ let raw=''; req.on('data', c=>raw+=c); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}}); }); }

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png' };

const server = http.createServer(async (req,res)=>{
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  try {
    if (pathname === '/api/state' && req.method === 'GET') return json(res,200,readState());
    if (pathname === '/api/state' && req.method === 'PUT') { const next = await body(req); const state = {...readState(), ...next}; writeState(state); return json(res,200,state); }
    if (pathname === '/api/locations' && req.method === 'POST') { const {cityId}=await body(req); const state=readState(); if(cityId && !state.savedCities.includes(cityId)) state.savedCities.push(cityId); writeState(state); return json(res,200,state); }
    if (pathname.startsWith('/api/locations/') && req.method === 'DELETE') { const cityId=pathname.split('/').pop(); const state=readState(); state.savedCities=state.savedCities.filter(id=>id!==cityId); if(state.selectedCity===cityId) state.selectedCity=state.savedCities[0]||null; writeState(state); return json(res,200,state); }
    if (pathname === '/api/locations/reorder' && req.method === 'PUT') { const {savedCities}=await body(req); const state=readState(); state.savedCities=Array.isArray(savedCities)?savedCities:state.savedCities; writeState(state); return json(res,200,state); }

    let file = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.normalize(path.join(PUBLIC, file));
    if (!filePath.startsWith(PUBLIC)) return json(res,403,{error:'Forbidden'});
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(PUBLIC,'index.html');
    res.writeHead(200, {'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream'});
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { console.error(e); json(res,500,{error:'Server error'}); }
});
server.listen(PORT, ()=>console.log(`Atlasclock running at http://localhost:${PORT}`));

