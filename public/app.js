const state = {
  cities: [],
  countries: [],
  worldSvg: '',
  savedCities: [],
  selectedCity: 'los-angeles',
  selectedCountry: null,
  selectedZone: null,
  page: 'world-clock',
  preferences: { timeFormat: '24', showSeconds: false, theme: 'light', mapStyle: 'minimal', animations: 'full' },
  compareTime: null,
  mapScale: 1,
  mapOffsetX: 0,
  mapOffsetY: 0,
  modal: null,
  search: '',
  revealObserver: null
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const city = id => state.cities.find(c => c.id === id);
const countryById = id => state.countries.find(c => c.id === id);
const initials = name => String(name).split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const icon = name => ({ 'World Clock':'◉', Map:'◇', Compare:'◌', Places:'⌖', Settings:'⚙', About:'ⓘ' }[name] || '•');

function getTimeParts(tz, date = new Date()) {
  const opts = { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: state.preferences.timeFormat === '12' };
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
  const obj = {}; parts.forEach(p => obj[p.type] = p.value); return obj;
}
function getDate(tz, date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday:'short', month:'short', day:'numeric', year:'numeric' }).format(date);
}
function getOffset(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:tz, timeZoneName:'longOffset' }).formatToParts(date);
  const v = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
  if (v === 'GMT') return 'UTC+0';
  const m = v.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return v.replace('GMT', 'UTC');
  return `UTC${m[1]}${m[2].padStart(2,'0')}${m[3] ? ':' + m[3] : ''}`;
}
function solarData(date = new Date()) {
  const d = new Date(date);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
  const minutesUtc = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (minutesUtc / 1440));
  const eqtime = 229.18 * (0.000075 + 0.001868*Math.cos(gamma) - 0.032077*Math.sin(gamma) - 0.014615*Math.cos(2*gamma) - 0.040849*Math.sin(2*gamma));
  const decl = 0.006918 - 0.399912*Math.cos(gamma) + 0.070257*Math.sin(gamma) - 0.006758*Math.cos(2*gamma) + 0.000907*Math.sin(2*gamma) - 0.002697*Math.cos(3*gamma) + 0.00148*Math.sin(3*gamma);
  let subsolarLon = (720 - minutesUtc - eqtime) / 4;
  subsolarLon = ((subsolarLon + 180) % 360 + 360) % 360 - 180;
  return { decl, eqtime, subsolarLon };
}
function solarElevation(latitude, longitude, date = new Date()) {
  const { decl, eqtime } = solarData(date);
  const d = new Date(date);
  const minutesUtc = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const trueSolarMinutes = minutesUtc + eqtime + 4 * Number(longitude);
  let hourAngle = trueSolarMinutes / 4 - 180;
  hourAngle = ((hourAngle + 180) % 360 + 360) % 360 - 180;
  const lat = Number(latitude) * Math.PI / 180;
  const h = hourAngle * Math.PI / 180;
  const cosZenith = Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(h);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) * 180 / Math.PI;
}
function dayState(tz, date = new Date()) {
  const sample = state.cities.find(c => c.timezone === tz);
  if (sample && Number.isFinite(Number(sample.latitude)) && Number.isFinite(Number(sample.longitude))) {
    return solarElevation(sample.latitude, sample.longitude, date) > -0.833 ? 'day' : 'night';
  }
  const p = new Intl.DateTimeFormat('en-US', { timeZone:tz, hour:'2-digit', hourCycle:'h23' }).formatToParts(date);
  const h = Number(p.find(x => x.type === 'hour')?.value || 0);
  return h >= 6 && h < 18 ? 'day' : 'night';
}
function cityDayState(c, date = new Date()) {
  if (c && Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))) {
    return solarElevation(c.latitude, c.longitude, date) > -0.833 ? 'day' : 'night';
  }
  return dayState(c?.timezone, date);
}
function dayIcon(tz) {
  return dayState(tz) === 'day'
    ? '<span class="light-icon sun-icon" aria-label="Day">☀</span>'
    : '<span class="light-icon moon-icon" aria-label="Night">☾</span>';
}
function cityAsset(c) {
  const known = ['tokyo','sydney','los-angeles','new-york','london','new-delhi'];
  return known.includes(c?.id) ? `./assets/${c.id}.svg` : './assets/tokyo.svg';
}
function timeString(tz, date = state.compareTime || new Date()) {
  const p = getTimeParts(tz, date);
  return `${p.hour}:${p.minute}${state.preferences.showSeconds ? ':' + p.second : ''}${p.dayPeriod ? ' ' + p.dayPeriod : ''}`;
}
function offsetHours(tz, date = new Date()) {
  const s = getOffset(tz, date).replace('UTC', '');
  if (!s) return 0;
  const sign = s[0] === '-' ? -1 : 1;
  const [h, m = '0'] = s.slice(1).split(':');
  return sign * (Number(h) + Number(m) / 60);
}
function project(lon, lat) {
  return { x: (Number(lon) + 180) / 360 * 1000, y: (90 - Number(lat)) / 180 * 500 };
}
// The photographic atlas is an equirectangular world map (2:1).
// Keep every live overlay in exactly the same projection as the image.
const MAP_W = 903;
const MAP_H = 352;
function mapProject(lon, lat) {
  return {
    x: ((Number(lon) + 180) / 360) * MAP_W,
    y: ((90 - Number(lat)) / 180) * MAP_H
  };
}
// Backwards-compatible alias used by a few live solar helpers.
function referenceProject(lon, lat) { return mapProject(lon, lat); }

function saveLocal() {
  localStorage.setItem('atlasclock-state', JSON.stringify({ savedCities:state.savedCities, selectedCity:state.selectedCity, preferences:state.preferences }));
}
async function saveServer() {
  if (location.port && location.port !== '4173') return;
  try {
    await fetch('./api/state', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ savedCities:state.savedCities, selectedCity:state.selectedCity, preferences:state.preferences }) });
  } catch {}
}
function persist() { saveLocal(); saveServer(); }

async function boot() {
  try { state.cities = await fetch('./cities.json').then(r => r.json()); } catch { state.cities = []; }
  try { state.worldSvg = await fetch('./world.svg').then(r => r.text()); } catch { state.worldSvg = ''; }
  try { state.countries = await fetch('./countries.json').then(r => r.json()); } catch { state.countries = []; }
  try {
    const local = JSON.parse(localStorage.getItem('atlasclock-state'));
    if (local) Object.assign(state, local);
  } catch {}
  if (!location.port || location.port === '4173') {
    try {
      const server = await fetch('./api/state').then(r => r.json());
      if (server?.savedCities) {
        state.savedCities = server.savedCities;
        state.selectedCity = server.selectedCity;
        state.preferences = { ...state.preferences, ...server.preferences };
      }
    } catch {}
  }
  state.savedCities = (state.savedCities || []).filter(id => city(id));
  if (!state.savedCities.length) state.savedCities = ['tokyo','sydney','los-angeles','new-york','london'].filter(id => city(id));
  if (!city(state.selectedCity)) state.selectedCity = state.savedCities[0];
  applyTheme();
  render();
  setInterval(() => { updateClocks(); updateTimeline(); updateCountryClock(); }, 1000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
function applyTheme() {
  const dark = state.preferences.theme === 'dark' || (state.preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.motion = state.preferences.animations;
  document.documentElement.dataset.mapstyle = state.preferences.mapStyle;
}

function navButton(name) {
  const key = name.toLowerCase().replace(/\s+/g,'-');
  const active = state.page === key || (state.page === 'world-clock' && name === 'World Clock');
  return `<button class="nav-link ${active ? 'active' : ''}" data-nav="${key}"><b>${icon(name)}</b><span>${name}</span></button>`;
}
function render() {
  const app = $('#app');
  const landing = state.page === 'world-clock';
  app.innerHTML = `<div class="shell ${landing ? 'landing-mode' : ''}">
    <aside class="sidebar">
      <button class="brand brand-button" data-nav="world-clock" aria-label="Atlasclock home"><span class="brand-mark">◎</span><span>Atlasclock</span></button>
      <nav class="nav">${['World Clock','Map','Compare','Places','Settings','About'].map(navButton).join('')}</nav>
      <div class="sidebar-quote"><span>“Time connects a more open world.”</span><small>— Atlasclock</small></div>
    </aside>
    <main class="main">${renderPage()}</main>
    <nav class="mobile-nav">${['World Clock','Map','Compare','Settings'].map(navButton).join('')}</nav>
    <button class="back-top" data-action="top" aria-label="Back to top">↑</button>
  </div>`;
  bind();
  if (state.page === 'world-clock' || state.page === 'map') setupInteractiveMap();
  setupReveals();
  startHourglass();
}

function renderPage() {
  if (state.page === 'map') return renderMapPage();
  if (state.page === 'compare') return renderComparePage();
  if (state.page === 'places') return renderPlacesPage();
  if (state.page === 'settings') return renderSettingsPage();
  if (state.page === 'about') return renderAboutPage();
  return renderHomePage();
}

function header() {
  return `<header class="topbar">
    <div><div class="eyebrow">Private · Offline-first</div><h1 class="title">Atlasclock</h1><div class="subtitle">A calm way to track time around the world.</div></div>
    <div class="actions"><button class="search-pill" data-action="search">⌕ <span>Search cities, countries or timezones…</span><kbd>/</kbd></button><button class="add-btn" data-action="add">+ Add City</button><button class="icon-btn" data-action="theme" aria-label="Toggle theme">${state.preferences.theme === 'dark' ? '☼' : '◐'}</button></div>
  </header>`;
}

function renderLandingNav(){
  return `<nav class="landing-nav">
    <button class="landing-brand" data-nav="world-clock"><span class="brand-mark">◎</span><b>Atlasclock</b></button>
    <div class="landing-links">
      <button class="active" data-scroll-target="home-top">Home</button>
      <button data-scroll-target="features">Features</button>
      <button data-scroll-target="map-section">Map</button>
      <button data-scroll-target="tools-section">Tools</button>
      <button data-scroll-target="about-section">About</button>
    </div>
    <div class="landing-actions"><button class="mini-theme" data-action="theme" aria-label="Toggle theme">${state.preferences.theme === 'dark' ? '☼' : '◐'}</button><button class="primary-cta nav-cta" data-action="get-started">Get Started <span>→</span></button></div>
  </nav>`;
}

function renderHomePage() {
  const cityChips = state.savedCities.map(id => { const c = city(id); return `<button class="chip ${id === state.selectedCity ? 'active':''}" data-city="${id}"><span class="avatar photo-avatar"><img src="${cityAsset(c)}" alt=""></span>${esc(c.name)}</button>`; }).join('');
  const quick = [
    ['◉','World Clock','Track time anywhere','world-clock'],['⌖','Interactive Map','Tap any country','map'],['◌','Compare Time','Find the best time','compare'],['▣','Plan Meetings','Across time zones','meeting'],['⌖','Explore Places','Discover the world','places'],['♧','Offline First','Your data, your device','offline']
  ];
  return `${renderLandingNav()}
    <section class="landing-hero reveal" id="home-top">
      <div class="hero-copy">
        <div class="eyebrow">Private · Offline-first</div>
        <h1>A more connected <span>tomorrow.</span></h1>
        <p>Atlasclock helps you stay in sync with the world — whether you’re working, travelling, or just curious. Beautifully simple. Powerfully useful.</p>
        <div class="hero-actions"><button class="primary-cta" data-action="get-started">Get Started <span>→</span></button><button class="secondary-cta" data-action="scroll-features"><span>◉</span> Explore Features</button></div>
      </div>
      <div class="globe-stage hero-globe" aria-label="Animated Atlasclock globe"><div class="globe"><img src="./assets/globe-reference-isolated.png" alt="Atlasclock world globe"><div class="globe-highlight"></div></div><div class="globe-live-callout callout-ny"><span>☀</span><div><b>New York</b><strong data-clock="new-york">${timeString(city('new-york')?.timezone || 'America/New_York')}</strong></div></div><div class="globe-live-callout callout-london"><span>☀</span><div><b>London</b><strong data-clock="london">${timeString(city('london')?.timezone || 'Europe/London')}</strong></div></div><div class="globe-live-callout callout-tokyo"><span>☾</span><div><b>Tokyo</b><strong data-clock="tokyo">${timeString(city('tokyo')?.timezone || 'Asia/Tokyo')}</strong></div></div><div class="globe-live-callout callout-sydney"><span>☾</span><div><b>Sydney</b><strong data-clock="sydney">${timeString(city('sydney')?.timezone || 'Australia/Sydney')}</strong></div></div></div>
      <div class="hero-stats"><div><b>193+</b><span>Countries</span></div><div><b>400+</b><span>Time zones</span></div><div><b>Always</b><span>In sync</span></div><div><b>100%</b><span>Offline</span></div></div>
    </section>
    <section class="feature-strip reveal" id="features">${quick.map((f,i)=>`<button ${f[3]==='meeting'?'data-action="meeting"':f[3]==='offline'?'data-action="offline"':`data-nav="${f[3]}"`}><span class="feature-icon ${i%3===1?'blue':''} ${i===4?'coral':''}">${f[0]}</span><b>${f[1]}</b><small>${f[2]}</small></button>`).join('')}</section>
    <section class="story-section reveal"><div class="story-copy"><div class="eyebrow">Time brings people together</div><h2>Different places.<br><span>Same moments.</span></h2><p>From business meetings to family calls, Atlasclock helps you find the right time, every time. Because the world feels smaller when time works for you.</p><button class="primary-cta" data-scroll-target="map-section">Explore the atlas <span>→</span></button></div><div class="story-cards"><article class="story-card work"><span>01</span><div class="story-art-icon laptop-icon">▣</div><div><b>Work</b><small>Collaborate globally</small></div></article><article class="story-card travel"><span>02</span><div class="story-art-icon plane-icon">✈</div><div><b>Travel</b><small>Plan with confidence</small></div></article><article class="story-card connect"><span>03</span><div class="story-art-icon connect-icon">⌁</div><div><b>Stay Connected</b><small>Be closer, always</small></div></article></div></section>
    <section class="dashboard-showcase reveal" id="map-section"><div class="dashboard-mini-side"><button class="mini-brand" data-nav="world-clock"><span class="brand-mark">◎</span><b>Atlasclock</b></button><nav>${['World Clock','Map','Compare','Places','Settings','About'].map(navButton).join('')}</nav><div class="mini-theme-row"><button class="mini-theme" data-action="theme">${state.preferences.theme === 'dark' ? '☼' : '◐'}</button><span>Light / Dark</span></div></div><div class="dashboard-main"><div class="dashboard-head"><div><div class="eyebrow">Private · Offline-first</div><h2>Atlasclock</h2><p>A calm way to track time around the world.</p></div><div class="actions"><button class="search-pill" data-action="search">⌕ <span>Search cities, countries or timezones…</span><kbd>/</kbd></button><button class="add-btn" data-action="add">+ Add City</button><button class="icon-btn" data-action="theme">${state.preferences.theme === 'dark' ? '☼' : '◐'}</button></div></div><div class="city-strip">${cityChips}<button class="chip" data-action="add">＋ Add</button></div><div class="workspace atlas-workspace" id="clock-workspace"><section class="clock-list" id="clock-list">${renderCards()}</section>${renderMapPanel()}</div>${renderDashboardBottom()}${renderTimeline()}</div></section>
    ${renderMeetingSection()}
    ${renderDayNightSection()}
    ${renderJourneySection()}
    ${renderLivePulseSection()}
    ${renderFeatureGrid()}
    ${renderToolsSection()}
    ${renderConnectedSection()}
    <section class="about-anchor reveal" id="about-section"><div><div class="eyebrow">Atlasclock philosophy</div><h2>Less noise.<br><span>More world.</span></h2><p>Time is local, personal and always moving. Atlasclock keeps that complexity underneath a calm interface — with accurate geography, real timezone rules and no external time API.</p></div><div class="about-pill-grid"><div><b>0</b><small>external time APIs</small></div><div><b>78</b><small>local city records</small></div><div><b>177</b><small>mapped countries</small></div><div><b>100%</b><small>local-first core</small></div></div></section>
    ${renderFooterCTA()}`;
}


function renderDashboardRail(){
  const selected=city(state.selectedCity) || state.cities[0];
  const tz=selected?.timezone || 'Etc/UTC';
  const day=selected ? cityDayState(selected)==='day' : true;
  return `<aside class="dashboard-rail">
    <div class="rail-card rail-selected-card">
      <div class="rail-eyebrow">Selected location</div>
      <div class="rail-selected-row"><div><h3>${esc(selected?.name || 'Choose a city')}</h3><strong>${timeString(tz)}</strong><p>${esc(tz)}</p></div><span class="rail-day-icon ${day?'day':'night'}">${day?'☀':'☾'}</span></div>
      <small>${selected ? esc(getDate(tz)) : 'Tap a city marker'}</small>
    </div>
    <div class="rail-card rail-stats-card">
      <div class="rail-eyebrow">World stats</div>
      <div class="rail-stats"><div><b>${state.countries.length || 177}</b><span>Countries</span></div><div><b>${Math.max(500,state.cities.length)}+</b><span>Cities</span></div><div><b>24</b><span>Time zones</span></div></div>
    </div>
  </aside>`;
}

function renderDashboardBottom(){
  const selected=city(state.selectedCity) || state.cities[0];
  const tz=selected?.timezone || 'Etc/UTC';
  const day=selected ? cityDayState(selected)==='day' : true;
  return `<section class="dashboard-bottom-widgets" aria-label="Atlasclock dashboard details">
    <article class="bottom-widget bottom-selected-card">
      <div class="bottom-widget-eyebrow">Selected location</div>
      <div class="bottom-selected-content"><div><h3>${esc(selected?.name || 'Choose a city')}</h3><strong>${timeString(tz)}</strong><p>${esc(getDate(tz))}<br>${esc(tz)}</p></div><span class="rail-day-icon ${day?'day':'night'}">${day?'☀':'☾'}</span></div>
    </article>
    <article class="bottom-widget bottom-stats-card">
      <div class="bottom-widget-eyebrow">World stats</div>
      <div class="rail-stats"><div><b>${state.countries.length || 177}</b><span>Countries</span></div><div><b>${Math.max(500,state.cities.length)}+</b><span>Cities</span></div><div><b>24</b><span>Time zones</span></div></div>
    </article>
  </section>`;
}

function renderToolsSection(){
  return `<section class="tools-section reveal" id="tools-section"><div class="section-heading"><div><div class="eyebrow">Tools for real life</div><h2>Everything you need,<br><span>without the noise.</span></h2></div><p>Small utilities that turn world time into something you can actually use.</p></div><div class="tools-grid"><button class="tool-card" data-action="meeting"><span>▣</span><b>Meeting planner</b><small>Find overlapping work hours.</small><i>→</i></button><button class="tool-card" data-nav="compare"><span>◌</span><b>Compare cities</b><small>Read several local times together.</small><i>→</i></button><button class="tool-card" data-nav="places"><span>⌖</span><b>Explore places</b><small>Browse the local city atlas.</small><i>→</i></button><button class="tool-card" data-nav="map"><span>◇</span><b>Country time</b><small>Tap any country and inspect its zones.</small><i>→</i></button></div></section>`;
}

function renderCards() {
  return state.savedCities.map(id => { const c = city(id); return `<article class="clock-card reveal ${id===state.selectedCity?'active':''}" data-select="${id}"><div class="avatar city-avatar"><img src="${cityAsset(c)}" alt=""></div><div><div class="meta">${getOffset(c.timezone)}</div><div class="city-name">${esc(c.name)}</div><div class="date">${getDate(c.timezone)}</div></div><div class="clock-right"><div class="day">${dayIcon(c.timezone)}</div><div class="time" data-clock="${id}">${timeString(c.timezone)}</div></div></article>`; }).join('');
}

function solarMaskColor(elevation){
  // Keep the satellite atlas visible while adding only a subtle, physically
  // computed night tint. The terminator is derived from solar elevation at
  // every map pixel, so it follows the same equirectangular projection as the
  // photographic atlas without polygon seams or country overlays.
  if(elevation >= -0.833) return 0;
  if(elevation <= -12) return 0.42;
  return 0.42 * Math.min(1, Math.max(0, (-elevation - 0.833) / 11.167));
}
function renderSolarOverlay(){
  const selected=city(state.selectedCity);
  const loc=selected?mapProject(selected.longitude,selected.latitude):null;
  return `<canvas class="solar-canvas" width="452" height="176" aria-hidden="true"></canvas>${loc?`<svg class="selected-location-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="none" aria-hidden="true"><g class="live-selected-location" transform="translate(${loc.x.toFixed(2)} ${loc.y.toFixed(2)})"><circle class="location-halo" r="18"/><circle class="location-dot" r="6"/></g></svg>`:''}`;
}
function updateSolarCanvas(){
  const canvas=$('.solar-canvas');
  if(!canvas) return;
  const ctx=canvas.getContext('2d'); if(!ctx) return;
  const w=canvas.width,h=canvas.height;
  const img=ctx.createImageData(w,h), data=img.data;
  const now=new Date();
  const {decl,eqtime}=solarData(now);
  const minutesUtc=now.getUTCHours()*60+now.getUTCMinutes()+now.getUTCSeconds()/60;
  const sd=Math.sin(decl),cd=Math.cos(decl);
  for(let y=0;y<h;y++){
    const lat=(90-(y/(h-1))*180)*Math.PI/180;
    const sl=Math.sin(lat),cl=Math.cos(lat);
    for(let x=0;x<w;x++){
      const lon=-180+(x/(w-1))*360;
      let ha=((minutesUtc+eqtime+4*lon)/4-180);
      ha=((ha+180)%360+360)%360-180;
      const hz=Math.PI/180*ha;
      const elevation=90-Math.acos(Math.max(-1,Math.min(1,sl*sd+cl*cd*Math.cos(hz))))*180/Math.PI;
      const a=solarMaskColor(elevation);
      const i=(y*w+x)*4;
      data[i]=3; data[i+1]=18; data[i+2]=38; data[i+3]=Math.round(a*255);
    }
  }
  ctx.putImageData(img,0,0);
}
function mapOverlaySvg(){
  const markers=state.savedCities.map(id=>{
    const c=city(id); if(!c) return '';
    const p=mapProject(c.longitude,c.latitude);
    const active=id===state.selectedCity;
    const isDay=cityDayState(c)==='day';
    let dx=12, dy=-34;
    if(p.x>MAP_W-150) dx=-118;
    if(p.y<44) dy=14;
    if(p.y>MAP_H-45) dy=-46;
    return `<div class="map-marker-html" data-map-city="${id}" style="left:${(p.x/MAP_W*100).toFixed(4)}%;top:${(p.y/MAP_H*100).toFixed(4)}%;"><span class="marker-ring ${active?'active':''}"></span><span class="marker-dot"></span><span class="marker-label-wrap" style="transform:translate(${dx}px,${dy}px)"><b>${esc(c.name)}</b><small>${esc(timeString(c.timezone))} <em>${isDay?'☀':'☾'}</em></small></span></div>`;
  }).join('');
  const selected=city(state.selectedCity);
  const line=selected?`<div class="live-longitude-line-html" style="left:${(((Number(selected.longitude)+180)/360)*100).toFixed(4)}%;"></div>`:'';
  const loc=selected?mapProject(selected.longitude,selected.latitude):null;
  const selectedDot=loc?`<div class="selected-location-html" style="left:${(loc.x/MAP_W*100).toFixed(4)}%;top:${(loc.y/MAP_H*100).toFixed(4)}%;"><span></span></div>`:'';
  return `<div class="marker-layer live-marker-layer" aria-label="Live city markers">${line}${selectedDot}${markers}</div>`;
}
function renderMapPanel(extraClass='') {
  return `<section class="map-panel ${extraClass}">
    <div class="map-head"><div class="map-label"><b>World map</b><br><span class="muted">Tap any country · view local time</span></div><div class="map-tools"><button data-map="zoomIn" aria-label="Zoom in">+</button><button data-map="zoomOut" aria-label="Zoom out">−</button><button data-map="reset" aria-label="Reset map">⌂</button></div></div>
    <div class="map-wrap" id="map-wrap"><div class="map-viewport" id="map-viewport"><div class="map-reference-hint"><b>World map</b><span>Tap any country · view local time</span></div><div class="solar-layer" aria-hidden="true">${renderSolarOverlay()}</div>${mapOverlaySvg()}<div class="map-interaction-layer" aria-label="Interactive map controls"></div></div><div id="map-country-card" class="country-card" ${state.selectedCountry?'':'hidden'}>${renderCountryCard()}</div></div>
    <div class="map-bottom"><span><i class="legend-dot"></i> Live</span><span>${state.countries.length || 0} countries mapped</span><span>Same projection · precise markers</span></div>
  </section>`;
}

function worldHitSvg() {
  if (!state.worldSvg) return '';
  let svg = state.worldSvg;
  svg = svg.replace(/<svg\b/i, '<svg class="world-map country-hit-map"');
  svg = svg.replace(/\sclass="[^"]*world-map[^"]*"/i, ' class="world-map country-hit-map"');
  svg = svg.replace(/\s(fill|stroke|style)="[^"]*"/gi, '');
  svg = svg.replace(/<path\b/gi, '<path fill="transparent" stroke="transparent" pointer-events="all"');
  return svg;
}

function renderCountryCard() {
  const c=state.selectedCountry; if(!c) return '';
  const zones=c.timezones?.length ? c.timezones : ['Etc/UTC'];
  const tz=state.selectedZone || zones[0];
  const cities=(c.cityIds||[]).map(city).filter(Boolean).slice(0,3);
  return `<button class="country-close" data-country-close aria-label="Close country time">×</button><div class="country-kicker">LOCAL TIME · ${esc(c.iso2 || '')}</div><div class="country-name">${esc(c.name)}</div><div class="country-time">${timeString(tz)}</div><div class="country-date">${esc(getDate(tz))}</div><div class="country-zone">${esc(tz)} · ${getOffset(tz)} · ${countryDayState(c)==='day'?'Daylight':'Night'}</div>${zones.length>1?`<div class="country-zones"><span>Time zones</span>${zones.slice(0,8).map(z=>`<button class="${z===tz?'active':''}" data-country-zone="${esc(z)}">${esc(shortZone(z))}</button>`).join('')}</div>`:''}${cities.length?`<div class="country-cities"><span>Nearby mapped cities</span>${cities.map(x=>`<button data-country-city="${x.id}">${esc(x.name)} <small>${timeString(x.timezone)}</small></button>`).join('')}</div>`:''}`;
}
function shortZone(tz) { const parts=tz.split('/'); return parts[parts.length-1].replace(/_/g,' '); }
function openCountry(id) {
  const c=countryById(id); if(!c) return;
  state.selectedCountry=c; state.selectedZone=c.timezones?.[0] || 'Etc/UTC';
  renderCountryCardInPlace();
  $$('.world-map .country-layer path.is-selected').forEach(p=>p.classList.remove('is-selected'));
  const path=document.querySelector(`.world-map .country-layer path#${CSS.escape(id)}`); if(path) path.classList.add('is-selected');
}
function renderCountryCardInPlace() {
  const card=$('#map-country-card'); if(!card) return;
  card.innerHTML=renderCountryCard(); card.hidden=!state.selectedCountry;
  card.querySelector('[data-country-close]')?.addEventListener('click',()=>{state.selectedCountry=null;card.hidden=true;$$('.world-map .country-layer path.is-selected').forEach(p=>p.classList.remove('is-selected'));});
  card.querySelectorAll('[data-country-zone]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();state.selectedZone=b.dataset.countryZone;renderCountryCardInPlace();}));
  card.querySelectorAll('[data-country-city]').forEach(b=>b.addEventListener('click',()=>selectCity(b.dataset.countryCity)));
}
function bindMapMarkerEvents(){
  $$('.live-marker-layer [data-map-city]').forEach(g=>g.addEventListener('click',e=>{e.stopPropagation();selectCity(g.dataset.mapCity);}));
}

function setupInteractiveMap() {
  const viewport=$('#map-viewport'); if(!viewport) return;
  // The reference satellite atlas is the visible map. Keep the geographic SVG
  // out of the render tree so it can never paint black country silhouettes over it.
  const hit=viewport.querySelector('.map-interaction-layer');
  if(hit){
    hit.innerHTML=worldHitSvg();
    hit.setAttribute('aria-hidden','false');
    hit.style.pointerEvents='auto';
    hit.querySelectorAll('.country-layer path').forEach(path=>{
      path.addEventListener('click',e=>{e.stopPropagation();openCountry(path.id);});
      path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCountry(path.id);}});
    });
  }
  applyMapTransform();
  bindMapMarkerEvents();
  updateSolarCanvas();
  renderCountryCardInPlace();
}

function applyMapTransform() {
  const viewport=$('#map-viewport'); if(!viewport)return;
  const inner=viewport.querySelector('.map-interaction-layer .world-map'), overlay=viewport.querySelector('.marker-layer');
  const transform=`translate(${state.mapOffsetX}px, ${state.mapOffsetY}px) scale(${state.mapScale})`;
  if(inner) inner.style.transform=transform; if(overlay) overlay.style.transform=transform;
}

function renderTimeline() {
  return `<section class="timeline reveal"><div class="timeline-top"><div><div class="section-title">TIMEZONE TIMELINE</div><div class="muted small">Drag the reference moment to compare your cities.</div></div><b id="timeline-readout">${timelineLabel()}</b></div><input class="range" id="timeline" type="range" min="0" max="1439" value="${timelineValue()}"><div class="ticks"><span>UTC−12</span><span>UTC−8</span><span>UTC−4</span><span>UTC±0</span><span>UTC+4</span><span>UTC+8</span><span>UTC+12</span></div><div class="range-note">${state.compareTime?'Comparing a fixed moment.':'Live mode · all clocks follow the current moment.'}</div></section>`;
}
function timelineValue(){const d=state.compareTime||new Date();return d.getUTCHours()*60+d.getUTCMinutes();}
function timelineLabel(){const d=state.compareTime||new Date();return new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hour12:state.preferences.timeFormat==='12',timeZone:'UTC'}).format(d)+' UTC';}

function renderMeetingSection() {
  return `<section class="meeting-section reveal" id="meeting"><div class="section-heading"><div><div class="eyebrow">Plan meetings</div><h2>Find a time that works<br><span>for everyone.</span></h2></div><p>Choose two saved locations and Atlasclock finds overlapping daytime hours without any external service.</p></div><div class="meeting-card"><div class="meeting-fields"><label>First city<select id="meeting-a">${state.savedCities.map(id=>{const c=city(id);return `<option value="${id}">${esc(c.name)}</option>`}).join('')}</select></label><button class="swap-btn" data-action="swap-meeting">⇄</button><label>Second city<select id="meeting-b">${state.savedCities.map((id,i)=>{const c=city(id);return `<option value="${id}" ${i===1?'selected':''}>${esc(c.name)}</option>`}).join('')}</select></label><label>Date<input type="date" id="meeting-date" value="${localDateValue()}"></label><button class="primary-cta small-cta" data-action="find-meeting">Find Best Time</button></div><div class="meeting-result" id="meeting-result"><span class="result-icon">◷</span><div><b>Best overlap</b><strong>2:00 PM – 6:00 PM</strong><small>Select cities and find the best local window.</small></div></div></div></section>`;
}
function localDateValue(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function findMeeting(){
  const a=city($('#meeting-a')?.value), b=city($('#meeting-b')?.value); if(!a||!b)return;
  const base=new Date(); const slots=[];
  for(let min=0;min<1440;min+=30){const t=new Date(base);t.setUTCHours(0,min,0,0);const ha=Number(getTimeParts(a.timezone,t).hour)%24, hb=Number(getTimeParts(b.timezone,t).hour)%24;const workA=ha>=9&&ha<18, workB=hb>=9&&hb<18;if(workA&&workB)slots.push({t,ha,hb});}
  const result=$('#meeting-result'); if(!result)return;
  if(!slots.length){result.innerHTML='<span class="result-icon">×</span><div><b>No shared daytime window</b><strong>Try another pair</strong><small>The selected cities have no 9 AM–6 PM overlap today.</small></div>';return;}
  const first=slots[0], last=slots[slots.length-1];
  result.innerHTML=`<span class="result-icon">◷</span><div><b>Best overlap</b><strong>${formatHour(first.t,a.timezone)} – ${formatHour(last.t,b.timezone)}</strong><small>${esc(a.name)} ${formatHour(first.t,a.timezone)} · ${esc(b.name)} ${formatHour(first.t,b.timezone)}</small></div>`;
}
function formatHour(date,tz){return new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit',hour12:true}).format(date);}

function renderDayNightSection(){
  const ids=state.savedCities.slice(0,5); return `<section class="daynight-section reveal"><div class="section-heading compact"><div><div class="eyebrow">Day & night</div><h2>See where the sun is <span>shining.</span></h2></div><p>The same world, different moments. Every city gets a live light state, a visual scene and a local time.</p></div><div class="daynight-grid">${ids.map(id=>{const c=city(id);const day=cityDayState(c)==='day';return `<article class="day-card ${day?'is-day':'is-night'}"><div class="day-sky city-scene"><img src="${cityAsset(c)}" alt="${esc(c.name)} scene"><span class="sun-or-moon">${day?'☀':'☾'}</span><span class="horizon"></span></div><div class="day-meta"><b>${esc(c.name)}</b><small>${day?'Daylight':'Night'} · ${getOffset(c.timezone)}</small></div><strong data-day-clock="${id}">${timeString(c.timezone)}</strong></article>`}).join('')}</div></section>`;
}

function renderJourneySection(){
  const cards=[
    ['01','WORK','New York → London','Find overlap before the calendar invite.','09:35','14:35','new-york','london','✦'],
    ['02','TRAVEL','Delhi → Tokyo','Know the local moment before you land.','19:05','22:35','new-delhi','tokyo','✈'],
    ['03','STAY CLOSE','Sydney → Los Angeles','Call when both sides are actually awake.','23:35','06:35','sydney','los-angeles','⌁']
  ];
  return `<section class="journey-section reveal"><div class="section-heading"><div><div class="eyebrow">Different places · same moments</div><h2>Designed around the way<br><span>you move through time.</span></h2></div><p>World time should feel spatial, human and immediate — not like a spreadsheet of offsets.</p></div><div class="journey-grid">${cards.map((x,i)=>`<article class="journey-card j${i+1}"><div class="journey-no">${x[0]}</div><div class="journey-art route-art"><img src="./assets/${x[6]}.svg" alt="${x[2]}"><span class="route-icon">${x[8]}</span><div class="route-connector"><span></span><i>→</i><span></span></div><img src="./assets/${x[7]}.svg" alt="${x[2]}"></div><div class="journey-copy"><small>${x[1]}</small><h3>${x[2]}</h3><p>${x[3]}</p><div class="journey-times"><b>${x[4]}</b><span>↔</span><b>${x[5]}</b></div></div></article>`).join('')}</div></section>`;
}
function renderLivePulseSection(){
  const ids=state.savedCities.slice(0,5);
  return `<section class="pulse-section reveal"><div class="pulse-copy"><div class="eyebrow">Live around the world</div><h2>One moment.<br><span>Five local realities.</span></h2><p>Every pulse is calculated locally with IANA timezone rules. No time API is required.</p><button class="primary-cta" data-nav="map">Open interactive map →</button></div><div class="pulse-board">${ids.map((id,i)=>{const c=city(id);return `<div class="pulse-row" style="--delay:${i*90}ms"><span class="pulse-dot"></span><div><b>${esc(c.name)}</b><small>${getOffset(c.timezone)} · ${cityDayState(c)==='day'?'Daylight':'Night'}</small></div><strong data-pulse-clock="${id}">${timeString(c.timezone)}</strong></div>`}).join('')}</div></section>`;
}
function renderFeatureGrid(){
  const features=[['◎','Accurate World Map','Tap any country for local time.'],['◌','Multiple Time Zones','Detailed zone information.'],['▣','Meeting Planner','Find the best time.'],['☀','Day & Night View','See sunlight across the globe.'],['◉','Compare Cities','Side by side comparison.'],['ϟ','Beautiful & Fast','Smooth, responsive experience.']];
  return `<section class="feature-grid-section reveal"><div class="eyebrow">Built for a global world</div><h2>Powerful features for<br><span>a more open tomorrow.</span></h2><div class="feature-grid">${features.map((f,i)=>`<button class="feature-card" data-feature="${i}"><span class="feature-icon ${i%3===1?'blue':''}">${f[0]}</span><span><b>${f[1]}</b><small>${f[2]}</small></span><i>→</i></button>`).join('')}</div></section>`;
}
function renderConnectedSection(){
  return `<section class="connected-section reveal"><div class="connected-copy"><div class="eyebrow">Time brings people together</div><h2>Time doesn’t just tell us<br>when things happen…<br><span>It tells us what’s possible.</span></h2><p>From business meetings to family calls, Atlasclock makes global time feel human, visual and simple.</p><button class="secondary-cta" data-nav="compare">Compare Cities →</button></div><div class="hourglass-stage" aria-label="One hour Atlasclock sandglass"><div class="hourglass-orbit orbit-h1"></div><div class="hourglass-orbit orbit-h2"></div><div class="hourglass-glow"></div><div class="hourglass hourglass-3d" id="hourglass" data-hourglass aria-label="Animated one hour 3D sandglass"><img src="./assets/hourglass-reference-isolated.png" alt="" draggable="false"><span class="hourglass-3d-shine"></span><span class="sand-stream-live" aria-hidden="true"></span><span class="sand-grains-live" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><div class="hourglass-progress"><span></span></div><div class="hourglass-label">60 MIN</div></div><div class="hourglass-caption"><span>◷</span><div><b>Time flows</b><small>one calm hour at a time.</small></div></div></div><div class="metrics"><div><b>${Math.max(300,state.cities.length)}+</b><span>Major cities</span></div><div><b>${state.countries.length || 193}+</b><span>Countries</span></div><div><b>400+</b><span>Time zones</span></div><div><b>100%</b><span>Local-first</span></div></div></section>`;
}
function renderFooterCTA(){return `<section class="footer-cta reveal"><div><div class="eyebrow">Atlasclock</div><h2>Your world.<br><span>One calm clock.</span></h2><p>Keep every timezone within reach — beautifully.</p></div><button class="primary-cta" data-action="get-started">Get Started <span>→</span></button></section>`;}

function renderMapPage(){
  return `${header()}<section class="map-page-intro reveal"><div><div class="eyebrow">Interactive atlas</div><h2>Explore the world,<br><span>one country at a time.</span></h2><p>Tap a real country boundary to see its live local time. Markers use the same geographic projection as the Natural Earth-derived map.</p></div><div class="map-search"><input id="country-search" placeholder="Find a country…"><button data-action="country-search">⌕</button></div></section><div class="map-page-layout reveal">${renderMapPanel('map-page-map')}<aside class="map-info"><div class="info-card"><div class="eyebrow">Selected location</div><h3 id="map-selected-name">${esc(city(state.selectedCity)?.name || 'Choose a city')}</h3><div class="big-map-time" id="map-selected-time">${city(state.selectedCity)?timeString(city(state.selectedCity).timezone):'—'}</div><p id="map-selected-zone">${city(state.selectedCity)?esc(city(state.selectedCity).timezone):'Tap a marker or country.'}</p></div><div class="info-card"><div class="eyebrow">How it works</div><ul class="clean-list"><li>Real country geometry</li><li>Latitude / longitude markers</li><li>IANA timezone rules</li><li>Live browser calculation</li></ul></div><div class="info-card"><div class="eyebrow">Map legend</div><div class="legend-row"><i class="legend-dot"></i><span>Saved city</span></div><div class="legend-row"><i class="legend-line"></i><span>Selected longitude</span></div><div class="legend-row"><i class="legend-country"></i><span>Country boundary</span></div></div></aside></div>${renderTimeline()}${renderUtcSection()}`;
}
function renderUtcSection(){return `<section class="utc-section reveal"><div class="section-heading compact"><div><div class="eyebrow">Explore time zones</div><h2>Every hour has a <span>place.</span></h2></div><p>Use the offset rail to understand how the world moves around UTC.</p></div><div class="utc-rail">${[-12,-9,-6,-3,0,3,6,9,12].map((n,i)=>`<div class="utc-cell ${n===0?'zero':''}" style="--i:${i}"><span></span><b>UTC${n>0?'+':''}${n}</b></div>`).join('')}</div></section>`;}

function renderComparePage(){const ids=state.savedCities.slice(0,8);return `${header()}<section class="page-hero reveal"><div class="eyebrow">Compare time</div><h2>Make global schedules<br><span>feel local.</span></h2><p>See saved locations side by side, then drag the timeline to compare a fixed moment.</p></section><div class="compare-grid large reveal">${ids.map(id=>{const c=city(id);return `<article class="compare-card"><div class="meta">${getOffset(c.timezone)}</div><b>${esc(c.name)}</b><div class="compare-time" data-compare="${id}">${timeString(c.timezone)}</div><div class="muted small">${cityDayState(c)==='day'?'☀ Day':'☾ Night'} · ${getDate(c.timezone)}</div></article>`}).join('')}</div>${renderMeetingSection()}${renderTimeline()}${renderDayNightSection()}`;}
function renderPlacesPage(){const regions=[...new Set(state.cities.map(c=>c.region).filter(Boolean))].slice(0,8);return `${header()}<section class="page-hero reveal"><div class="eyebrow">Explore places</div><h2>Every city has<br><span>its own rhythm.</span></h2><p>Browse the local city dataset and jump straight into its clock.</p></section><div class="places-grid reveal">${regions.map(region=>`<section class="place-region"><div class="eyebrow">${esc(region)}</div>${state.cities.filter(c=>c.region===region).slice(0,8).map(c=>`<button data-city="${c.id}"><span class="avatar">${initials(c.name)}</span><span><b>${esc(c.name)}</b><small>${esc(c.country)} · ${getOffset(c.timezone)}</small></span><strong>${timeString(c.timezone)}</strong></button>`).join('')}</section>`).join('')}</div>`;}
function renderSettingsPage(){const p=state.preferences;return `${header()}<section class="page-hero reveal"><div class="eyebrow">Settings</div><h2>Make Atlasclock<br><span>feel like yours.</span></h2><p>All preferences stay local on this device.</p></section><div class="settings-grid reveal"><section class="setting-card"><div class="section-title">Display</div><div class="setting-row"><span>Time format</span><div class="segmented"><button class="${p.timeFormat==='12'?'active':''}" data-pref="timeFormat" data-value="12">12-hour</button><button class="${p.timeFormat==='24'?'active':''}" data-pref="timeFormat" data-value="24">24-hour</button></div></div><div class="setting-row"><span>Show seconds</span><button class="switch ${p.showSeconds?'on':''}" data-pref-toggle="showSeconds"></button></div><div class="setting-row"><span>Theme</span><div class="segmented">${['light','dark','system'].map(x=>`<button class="${p.theme===x?'active':''}" data-pref="theme" data-value="${x}">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div></div></section><section class="setting-card"><div class="section-title">Map & motion</div><div class="setting-row"><span>Map style</span><div class="segmented">${['minimal','contrast','night'].map(x=>`<button class="${p.mapStyle===x?'active':''}" data-pref="mapStyle" data-value="${x}">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div></div><div class="setting-row"><span>Motion</span><div class="segmented">${['full','reduced'].map(x=>`<button class="${p.animations===x?'active':''}" data-pref="animations" data-value="${x}">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div></div></section></div>`;}
function renderAboutPage(){return `${header()}<section class="about-long reveal"><div class="about-copy"><div class="brand-mark">◎</div><div class="eyebrow">Private · Offline-first</div><h2>Modern world time,<br><span>quietly designed.</span></h2><p>Atlasclock is a lightweight world clock built around clarity, time-zone awareness, accurate local map geometry and a calm editorial interface.</p></div><div class="about-stats"><div><b>0</b><span>external time APIs</span></div><div><b>${state.cities.length}+</b><span>cities in local dataset</span></div><div><b>${state.countries.length}+</b><span>mapped countries</span></div><div><b>100%</b><span>local-first core</span></div></div></section>${renderFeatureGrid()}${renderConnectedSection()}${renderFooterCTA()}`;}

function countryDayState(c, date = new Date()) {
  const rp = c?.representativePoint;
  if (rp && Number.isFinite(Number(rp.latitude)) && Number.isFinite(Number(rp.longitude))) return solarElevation(rp.latitude, rp.longitude, date) > -0.833 ? 'day' : 'night';
  const tz = c?.timezones?.[0] || 'Etc/UTC';
  return dayState(tz, date);
}
function updateClocks(){
  document.querySelectorAll('[data-clock]').forEach(el=>{const c=city(el.dataset.clock);if(c)el.textContent=timeString(c.timezone)});
  document.querySelectorAll('[data-compare]').forEach(el=>{const c=city(el.dataset.compare);if(c)el.textContent=timeString(c.timezone)});
  document.querySelectorAll('[data-day-clock]').forEach(el=>{const c=city(el.dataset.dayClock);if(c)el.textContent=timeString(c.timezone)});
  document.querySelectorAll('[data-pulse-clock]').forEach(el=>{const c=city(el.dataset.pulseClock);if(c)el.textContent=timeString(c.timezone)});
  document.querySelectorAll('.clock-card [data-clock]').forEach(el=>{const c=city(el.dataset.clock);const holder=el.closest('.clock-card')?.querySelector('.day');if(c&&holder)holder.innerHTML=dayIcon(c.timezone);});
  document.querySelectorAll('.day-card').forEach(card=>{const id=card.querySelector('[data-day-clock]')?.dataset.dayClock;const c=city(id);if(!c)return;const isDay=cityDayState(c)==='day';card.classList.toggle('is-day',isDay);card.classList.toggle('is-night',!isDay);const iconEl=card.querySelector('.sun-or-moon');if(iconEl)iconEl.textContent=isDay?'☀':'☾';const meta=card.querySelector('.day-meta small');if(meta)meta.textContent=`${isDay?'Daylight':'Night'} · ${getOffset(c.timezone)}`;});
  document.querySelectorAll('.pulse-row').forEach(row=>{const id=row.querySelector('[data-pulse-clock]')?.dataset.pulseClock;const c=city(id);if(!c)return;const small=row.querySelector('small');if(small)small.textContent=`${getOffset(c.timezone)} · ${cityDayState(c)==='day'?'Daylight':'Night'}`;});
  updateSolarCanvas();
  const markerLayer=$('.live-marker-layer'); if(markerLayer){markerLayer.outerHTML=mapOverlaySvg(); bindMapMarkerEvents();}
  if(state.selectedCountry&&$('#map-country-card')){const card=$('#map-country-card');const zone=state.selectedZone||state.selectedCountry.timezones?.[0]||'Etc/UTC';const el=card.querySelector('.country-time');if(el)el.textContent=timeString(zone);const date=card.querySelector('.country-date');if(date)date.textContent=getDate(zone);const status=card.querySelector('.country-zone');if(status)status.textContent=`${zone} · ${getOffset(zone)} · ${countryDayState(state.selectedCountry)==='day'?'Daylight':'Night'}`;}}
function updateTimeline(){const t=$('#timeline-readout');if(t)t.textContent=timelineLabel();}

function setupReveals(){
  if(state.revealObserver)state.revealObserver.disconnect();
  const els=$$('.reveal');
  if(state.preferences.animations==='reduced'||!('IntersectionObserver' in window)){els.forEach(e=>e.classList.add('visible'));return;}
  state.revealObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');state.revealObserver.unobserve(e.target);}}),{threshold:.12});
  els.forEach(e=>state.revealObserver.observe(e));
}

function showModal(type){state.modal=type;state.search='';renderModal();}
function renderModal(){
  $('.modal-backdrop')?.remove(); if(!state.modal)return;
  const content=state.modal==='onboarding'?renderOnboardingModal():state.modal==='meeting'?renderMeetingModal():`<div class="modal"><div class="modal-head"><div><div class="eyebrow">${state.modal==='add'?'Add location':'Quick search'}</div><h2>${state.modal==='add'?'Add a city':'Search Atlasclock'}</h2></div><button class="icon-btn" data-close>×</button></div><input autofocus class="search" id="city-search" placeholder="Search cities, countries or timezones…"><div class="results" id="results"></div></div>`;
  const b=document.createElement('div'); b.className='modal-backdrop'; b.innerHTML=content; document.body.appendChild(b);
  if($('#city-search')){$('#city-search').addEventListener('input',e=>{state.search=e.target.value;renderResults();});renderResults();}
  bindModal();
}
function renderOnboardingModal(){
  const selected=state.savedCities.slice(0,6); return `<div class="modal onboarding"><div class="modal-head"><div><div class="eyebrow">Atlasclock setup</div><h2>Make your clock yours.</h2></div><button class="icon-btn" data-close>×</button></div><div class="onboard-progress"><span class="active"></span><span></span><span></span><span></span></div><div class="onboard-step" data-step="1"><div class="step-kicker">01 · Cities</div><h3>Choose the places you care about.</h3><p>Start with your saved cities. You can add more anytime.</p><div class="onboard-city-list">${state.cities.slice(0,24).map(c=>`<button class="onboard-city ${selected.includes(c.id)?'selected':''}" data-onboard-city="${c.id}"><span class="avatar">${initials(c.name)}</span><span>${esc(c.name)}</span><i>${selected.includes(c.id)?'✓':'+'}</i></button>`).join('')}</div><button class="primary-cta full" data-onboard-next="2">Continue →</button></div><div class="onboard-step hidden" data-step="2"><div class="step-kicker">02 · Format</div><h3>How do you read time?</h3><div class="choice-grid"><button class="choice ${state.preferences.timeFormat==='12'?'selected':''}" data-onboard-pref="timeFormat" data-value="12"><b>12-hour</b><span>10:35 PM</span></button><button class="choice ${state.preferences.timeFormat==='24'?'selected':''}" data-onboard-pref="timeFormat" data-value="24"><b>24-hour</b><span>22:35</span></button></div><button class="primary-cta full" data-onboard-next="3">Continue →</button></div><div class="onboard-step hidden" data-step="3"><div class="step-kicker">03 · Theme</div><h3>Choose your atmosphere.</h3><div class="choice-grid"><button class="choice ${state.preferences.theme==='light'?'selected':''}" data-onboard-pref="theme" data-value="light"><b>Light</b><span>Warm & quiet</span></button><button class="choice ${state.preferences.theme==='dark'?'selected':''}" data-onboard-pref="theme" data-value="dark"><b>Dark</b><span>Deep & focused</span></button></div><button class="primary-cta full" data-onboard-next="4">Finish setup →</button></div><div class="onboard-step hidden" data-step="4"><div class="step-kicker">04 · Ready</div><h3>Your world is ready.</h3><p>Atlasclock will keep your cities, format and theme saved locally.</p><div class="ready-preview"><span>◎</span><b>Atlasclock</b><small>Local-first world time</small></div><button class="primary-cta full" data-onboard-finish>Open Atlasclock →</button></div></div>`;
}
function renderMeetingModal(){return `<div class="modal"><div class="modal-head"><div><div class="eyebrow">Meeting planner</div><h2>Plan across time zones.</h2></div><button class="icon-btn" data-close>×</button></div><p class="muted">Use the full planner in the page, or jump there now.</p><button class="primary-cta full" data-action="jump-meeting">Open meeting planner →</button></div>`;}
function renderResults(){const el=$('#results');if(!el)return;const q=state.search.trim().toLowerCase();const cityResults=state.cities.filter(c=>!q||`${c.name} ${c.country} ${c.timezone} ${c.region}`.toLowerCase().includes(q)).slice(0,12);const countryResults=state.countries.filter(c=>!q||`${c.name} ${c.iso2}`.toLowerCase().includes(q)).slice(0,8);el.innerHTML=[...cityResults.map(c=>`<button class="result" data-result="${c.id}"><span class="result-main"><span class="avatar">${initials(c.name)}</span><span><b>${esc(c.name)}</b><small>${esc(c.country)} · ${getOffset(c.timezone)}</small></span></span><span>＋</span></button>`),...countryResults.map(c=>`<button class="result country-result" data-result-country="${c.id}"><span class="result-main"><span class="avatar">◎</span><span><b>${esc(c.name)}</b><small>Country · ${c.timezones?.length||1} time zone${(c.timezones?.length||1)>1?'s':''}</small></span></span><span>⌖</span></button>`)].join('')||'<div class="muted result-empty">No locations found.</div>';}

function bindModal(){
  $$('.modal [data-onboard-next]').forEach(b=>b.addEventListener('click',()=>showOnboardStep(Number(b.dataset.onboardNext))));
  $$('.modal [data-onboard-pref]').forEach(b=>b.addEventListener('click',()=>{state.preferences[b.dataset.onboardPref]=b.dataset.value;persist();renderModal();showOnboardStep(Number(b.closest('.onboard-step').dataset.step));}));
  $$('.modal [data-onboard-city]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.onboardCity;if(state.savedCities.includes(id)){state.savedCities=state.savedCities.filter(x=>x!==id);if(!state.savedCities.length)state.savedCities=[id];}else{state.savedCities.push(id);}state.selectedCity=id;persist();renderModal();}));
  $('[data-onboard-finish]')?.addEventListener('click',()=>{state.modal=null;$('.modal-backdrop')?.remove();state.page='world-clock';applyTheme();render();window.scrollTo({top:0,behavior:'smooth'});});
  $$('[data-action="jump-meeting"]').forEach(b=>b.addEventListener('click',()=>{state.modal=null;$('.modal-backdrop')?.remove();state.page='world-clock';render();setTimeout(()=>$('#meeting')?.scrollIntoView({behavior:'smooth',block:'start'}),60);}));
}
function showOnboardStep(n){$$('.onboard-step').forEach(s=>s.classList.toggle('hidden',Number(s.dataset.step)!==n));$$('.onboard-progress span').forEach((s,i)=>s.classList.toggle('active',i<n));bindModal();}

function selectCity(id){if(!city(id))return;state.selectedCity=id;state.compareTime=null;persist();render();}
function addCity(id){if(!city(id))return;if(!state.savedCities.includes(id))state.savedCities.push(id);state.selectedCity=id;persist();state.modal=null;$('.modal-backdrop')?.remove();render();toast(`${city(id).name} added`);}
function toast(text){const x=document.createElement('div');x.className='toast';x.textContent=text;document.body.appendChild(x);setTimeout(()=>x.remove(),1800);}


let hourglassTimer=null;
function startHourglass(){
  const els=$$('.hourglass'); if(!els.length) return;
  if(hourglassTimer) clearTimeout(hourglassTimer);
  els.forEach(el=>{
    el.classList.remove('is-flipping','is-running');
    el.style.setProperty('--hourglass-cycle', '3600s');
    el.style.setProperty('--hourglass-progress', '1');
    void el.offsetWidth;
    el.classList.add('is-running');
  });
  hourglassTimer=setTimeout(()=>{
    els.forEach(el=>el.classList.add('is-flipping'));
    setTimeout(()=>startHourglass(), 1900);
  },3600000);
}
function bind(){
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>{state.page=b.dataset.nav;state.selectedCountry=null;render();window.scrollTo({top:0,behavior:'smooth'});}));
  $$('[data-action="add"]').forEach(b=>b.addEventListener('click',()=>showModal('add')));
  $$('[data-action="search"]').forEach(b=>b.addEventListener('click',()=>showModal('search')));
  $$('[data-action="theme"]').forEach(b=>b.addEventListener('click',()=>{state.preferences.theme=state.preferences.theme==='dark'?'light':'dark';applyTheme();persist();render();}));
  $$('[data-action="get-started"]').forEach(b=>b.addEventListener('click',()=>showModal('onboarding')));
  $$('[data-action="meeting"]').forEach(b=>b.addEventListener('click',()=>{state.page='world-clock';render();setTimeout(()=>$('#meeting')?.scrollIntoView({behavior:'smooth'}),60);}));
  $$('[data-action="scroll-features"]').forEach(b=>b.addEventListener('click',()=>$('#features')?.scrollIntoView({behavior:'smooth'})));
  $$('[data-scroll-target]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.scrollTarget)?.scrollIntoView({behavior:'smooth',block:'start'})));
  $$('[data-action="offline"]').forEach(b=>b.addEventListener('click',()=>toast('Atlasclock is designed to keep core time data local.')));
  $$('[data-action="top"]').forEach(b=>b.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'})));
  $$('[data-city],[data-select]').forEach(b=>b.addEventListener('click',()=>selectCity(b.dataset.city||b.dataset.select)));
  $$('[data-map]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.map==='zoomIn')state.mapScale=Math.min(2.8,state.mapScale+.2);if(b.dataset.map==='zoomOut')state.mapScale=Math.max(.7,state.mapScale-.2);if(b.dataset.map==='reset'){state.mapScale=1;state.mapOffsetX=0;state.mapOffsetY=0;}applyMapTransform();}));
  const range=$('#timeline');if(range)range.addEventListener('input',()=>{const d=new Date();d.setUTCHours(0,Number(range.value),0,0);state.compareTime=d;updateClocks();updateTimeline();});
  $$('[data-pref]').forEach(b=>b.addEventListener('click',()=>{state.preferences[b.dataset.pref]=b.dataset.value;applyTheme();persist();render();}));
  $$('[data-pref-toggle]').forEach(b=>b.addEventListener('click',()=>{state.preferences[b.dataset.prefToggle]=!state.preferences[b.dataset.prefToggle];persist();render();}));
  $('[data-action="find-meeting"]')?.addEventListener('click',findMeeting);
  $('[data-action="swap-meeting"]')?.addEventListener('click',()=>{const a=$('#meeting-a'),b=$('#meeting-b');if(a&&b){const v=a.value;a.value=b.value;b.value=v;}});
  $('[data-action="country-search"]')?.addEventListener('click',searchCountry);
  $('#country-search')?.addEventListener('keydown',e=>{if(e.key==='Enter')searchCountry();});
}
function searchCountry(){const q=($('#country-search')?.value||'').trim().toLowerCase();if(!q)return;const c=state.countries.find(x=>x.name.toLowerCase().includes(q)||String(x.iso2).toLowerCase()===q);if(c)openCountry(c.id);else toast('Country not found');}

document.addEventListener('click',e=>{
  if(e.target.matches('[data-close]')||e.target.classList.contains('modal-backdrop')){state.modal=null;$('.modal-backdrop')?.remove();return;}
  const r=e.target.closest('[data-result]'); if(r){addCity(r.dataset.result);return;}
  const cr=e.target.closest('[data-result-country]'); if(cr){state.modal=null;$('.modal-backdrop')?.remove();state.page='map';render();setTimeout(()=>openCountry(cr.dataset.resultCountry),50);}
});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();showModal('search');}if(e.key==='Escape'){state.modal=null;$('.modal-backdrop')?.remove();}});
window.addEventListener('scroll',()=>{ $('.back-top')?.classList.toggle('show',window.scrollY>500); const p=$('#scroll-progress'); if(p){const max=document.documentElement.scrollHeight-innerHeight;p.style.transform=`scaleX(${max>0?scrollY/max:0})`; } },{passive:true});
boot();

