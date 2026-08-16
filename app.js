/* ============================================================
   Chittoor Police — Crime Against Women Public Feedback Dashboard
   Client-side only: parses monthly Excel uploads, stores each
   month's snapshot, and rolls it up into Month / Quarter / Year
   performance views. Designed to run as a static GitHub Pages site.
   ============================================================ */

const LS_KEY = 'caw_dashboard_months_v1';
const HIDDEN_KEY = 'caw_dashboard_hidden_v1';
const ADMIN_KEY = 'caw_admin_v1';
// SHA-256 hash of the admin password — never store the plain password in this file.
// Default password is "Chittoor@CAW2026" — CHANGE THIS before publishing (see README).
const ADMIN_HASH = 'b698a3e95e7bd4abd43a80ba96a1139ea1d4ad7a7384049f066a98516af6b099';
const TABS = [
  {id:'overview', label:'Overview'},
  {id:'rankings', label:'PS Rankings'},
  {id:'heatmap',  label:'Heatmap'},
  {id:'detail',   label:'PS Detail'},
  {id:'data',     label:'Data & Upload'},
  {id:'method',   label:'Methodology'},
];

const STATE = {
  months: [],          // array of month objects, each {month, source, rows:[...], questions, questionsShort}
  activeTab: 'overview',
  rankPeriod: 'month',  // month | quarter | half | year | all
  detailPS: null,
  heatmapMonth: null,
  isAdmin: false,
};

const CHARTS = {};

/* ---------------- admin gate ---------------- */
async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function checkAdminSession(){
  try{ STATE.isAdmin = localStorage.getItem(ADMIN_KEY) === '1'; }catch(e){ STATE.isAdmin = false; }
}
async function adminLogin(){
  const pw = prompt('Enter admin password to unlock Data & Upload:');
  if(pw === null) return false; // cancelled
  let hash;
  try{ hash = await sha256Hex(pw); }catch(e){ alert('This browser cannot verify the password (Web Crypto unavailable). Try a modern browser over HTTPS.'); return false; }
  if(hash === ADMIN_HASH){
    STATE.isAdmin = true;
    try{ localStorage.setItem(ADMIN_KEY, '1'); }catch(e){}
    return true;
  }
  alert('Incorrect password.');
  return false;
}
function adminLogout(){
  STATE.isAdmin = false;
  try{ localStorage.removeItem(ADMIN_KEY); }catch(e){}
  if(STATE.activeTab==='data') STATE.activeTab = 'overview';
  paintChrome();
  renderAll();
  toast('Logged out of admin mode.');
}

/* ---------------- storage helpers ---------------- */
function loadLocalMonths(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return [];
    return JSON.parse(raw);
  }catch(e){ return []; }
}
function saveLocalMonths(list){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(list)); }catch(e){}
}
function loadHiddenMonths(){
  try{
    const raw = localStorage.getItem(HIDDEN_KEY);
    if(!raw) return [];
    return JSON.parse(raw);
  }catch(e){ return []; }
}
function saveHiddenMonths(list){
  try{ localStorage.setItem(HIDDEN_KEY, JSON.stringify(list)); }catch(e){}
}

/* ---------------- boot / merge data sources ---------------- */
async function fetchManifestMonths(){
  const out = [];
  try{
    const res = await fetch('data/manifest.json', {cache:'no-store'});
    if(!res.ok) return out;
    const manifest = await res.json();
    const list = manifest.months || [];
    for(const m of list){
      try{
        const r2 = await fetch(`data/months/${m}.json`, {cache:'no-store'});
        if(r2.ok){ const obj = await r2.json(); obj.__source='github'; out.push(obj); }
      }catch(e){}
    }
  }catch(e){ /* likely opened via file:// or manifest not published yet */ }
  return out;
}

function mergeMonths(githubMonths, localMonths, seedMonth){
  const byKey = {};
  // lowest priority first so higher priority overwrites
  if(seedMonth){ const s = JSON.parse(JSON.stringify(seedMonth)); s.__source='seed'; byKey[s.month] = s; }
  for(const m of githubMonths){ byKey[m.month] = m; }
  for(const m of localMonths){ m.__source = m.__source || 'local'; byKey[m.month] = m; }
  return Object.values(byKey).sort((a,b)=> a.month < b.month ? -1 : 1);
}

async function boot(){
  checkAdminSession();
  setSource(false, 'Loading data…');
  const [githubMonths] = await Promise.all([fetchManifestMonths()]);
  const localMonths = loadLocalMonths();
  const hidden = new Set(loadHiddenMonths());
  const visibleGithubMonths = githubMonths.filter(m=>!hidden.has(m.month));
  // Only fall back to embedded seed data when nothing else is available at all,
  // so a fresh GitHub Pages deploy still shows a working example.
  const useSeed = (visibleGithubMonths.length === 0 && localMonths.length === 0) ? window.SEED_MONTH : null;
  STATE.months = mergeMonths(visibleGithubMonths, localMonths, useSeed);
  paintChrome();
  renderAll();
  const src = STATE.months.some(m=>m.__source==='github') ? 'github'
            : STATE.months.some(m=>m.__source==='local') ? 'local' : 'seed';
  if(src==='seed'){
    setSource('warn', `Showing sample data (${STATE.months[0]?.reportLabel||STATE.months[0]?.month}). Upload your monthly Excel report to replace it.`);
  } else {
    const ghCount = STATE.months.filter(m=>m.__source==='github').length;
    const localCount = STATE.months.filter(m=>m.__source==='local').length;
    setSource(true, `${STATE.months.length} month(s) loaded — ${ghCount} from GitHub, ${localCount} from this browser's local uploads.`);
  }
}

function setSource(ok, text){
  const dot = document.getElementById('srcdot');
  dot.className = 'srcdot' + (ok===true?' ok':ok==='warn'?' warn':'');
  document.getElementById('srctext').textContent = text;
}

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>t.classList.remove('show'), 3200);
}

/* ---------------- excel parsing ---------------- */
function normHeader(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim(); }

function parseWorkbookAOA(aoa){
  // find header row: first row containing both a "Mandal" cell and a "Location" cell
  let headerRowIdx = -1;
  for(let i=0;i<Math.min(aoa.length,8);i++){
    const row = aoa[i].map(normHeader).map(c=>c.toLowerCase());
    if(row.includes('mandal') && row.includes('location')){ headerRowIdx = i; break; }
  }
  if(headerRowIdx === -1) throw new Error('Could not find a header row containing "Mandal" and "Location" columns. Please check the file matches the expected template.');

  const header = aoa[headerRowIdx].map(normHeader);
  const lower = header.map(h=>h.toLowerCase());
  const idxMandal = lower.indexOf('mandal');
  const idxLocation = lower.indexOf('location');
  const idxTotal = lower.indexOf('total');

  // detect question column pairs: any header containing "+ve" followed later by one containing "-ve"
  const questions = [];
  const qCols = [];
  for(let c=0;c<header.length;c++){
    const h = lower[c];
    if(h && h.includes('+ve')){
      // find the next -ve column after it
      let negC = -1;
      for(let c2=c+1;c2<header.length;c2++){
        if(lower[c2] && lower[c2].includes('-ve')){ negC = c2; break; }
      }
      if(negC>-1){
        const qtext = header[c].replace(/\+ve\s*\(%\)/i,'').trim();
        questions.push(qtext);
        qCols.push([c, negC]);
      }
    }
  }
  if(qCols.length === 0) throw new Error('Could not find any "+ve(%)" / "-ve(%)" question column pairs in the header row.');

  const rows = [];
  for(let r=headerRowIdx+1; r<aoa.length; r++){
    const row = aoa[r];
    if(!row) continue;
    const mandal = normHeader(row[idxMandal]);
    const location = normHeader(row[idxLocation]);
    if(!mandal && !location) continue;
    const total = idxTotal>-1 ? toNum(row[idxTotal]) : null;
    const q = qCols.map(([pc,nc])=>({ pos: toNum(row[pc]), neg: toNum(row[nc]) }));
    // skip fully-empty question rows
    if(q.every(x=>x.pos==null && x.neg==null)) continue;
    rows.push({mandal, location, total: total==null?0:total, q});
  }

  return { questions, rows };
}

function toNum(v){
  if(v==null || v==='') return null;
  const n = parseFloat(String(v).replace(/[,%]/g,'').trim());
  return isNaN(n) ? null : Math.round(n*100)/100;
}

function readFileAsArrayBuffer(file){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

function guessMonthFromFilename(name){
  const s = name.toLowerCase();
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const now = new Date();
  // yyyy-mm
  let m = s.match(/(20\d{2})[-_.](0?[1-9]|1[0-2])\b/);
  if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}`;
  // dd.mm.yyyy or dd-mm-yyyy
  m = s.match(/\b(0?[1-9]|[12]\d|3[01])[.\-_](0?[1-9]|1[0-2])[.\-_](20\d{2})\b/);
  if(m) return `${m[3]}-${String(m[2]).padStart(2,'0')}`;
  // month name + year
  for(let i=0;i<12;i++){
    if(s.includes(months[i])){
      const y = s.match(/20\d{2}/);
      const year = y ? y[0] : String(now.getFullYear());
      return `${year}-${String(i+1).padStart(2,'0')}`;
    }
  }
  return null;
}

function monthLabel(key){
  if(!key) return '';
  const [y,m] = key.split('-');
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[parseInt(m,10)-1]} ${y}`;
}

async function handleFiles(fileList){
  const files = Array.from(fileList).filter(f=>/\.(xlsx|xls|csv)$/i.test(f.name));
  if(files.length===0){ toast('Please choose an Excel (.xlsx) file.'); return; }
  for(const file of files){
    try{
      const buf = await readFileAsArrayBuffer(file);
      const wb = XLSX.read(buf, {type:'array'});
      const sheetName = wb.SheetNames.find(n=>/location/i.test(n)) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
      const parsed = parseWorkbookAOA(aoa);
      const guess = guessMonthFromFilename(file.name);
      const monthKey = await askMonth(guess, file.name);
      if(!monthKey) continue;
      const shortLabels = parsed.questions.map((q,i)=> STATE.months[0]?.questionsShort?.[i] || `Question ${i+1}`);
      const monthObj = {
        month: monthKey,
        reportLabel: monthLabel(monthKey),
        reportAsOn: '',
        sourceFile: file.name,
        surveyTitle: 'PS WISE PUBLIC FEEDBACK ON CRIME AGAINST WOMEN',
        questions: parsed.questions,
        questionsShort: shortLabels,
        rows: parsed.rows,
        __source: 'local',
      };
      upsertMonth(monthObj);
      toast(`Loaded ${monthObj.reportLabel}: ${parsed.rows.length} police stations, ${parsed.questions.length} questions.`);
    }catch(err){
      console.error(err);
      toast('Could not read "'+file.name+'": '+err.message);
    }
  }
  paintChrome();
  renderAll();
  const ghCount = STATE.months.filter(m=>m.__source==='github').length;
  const localCount = STATE.months.filter(m=>m.__source==='local').length;
  setSource(true, `${STATE.months.length} month(s) loaded — ${ghCount} from GitHub, ${localCount} from this browser's local uploads.`);
}

function upsertMonth(monthObj){
  const local = loadLocalMonths();
  const idx = local.findIndex(m=>m.month===monthObj.month);
  if(idx>-1) local[idx] = monthObj; else local.push(monthObj);
  saveLocalMonths(local);
  const gIdx = STATE.months.findIndex(m=>m.month===monthObj.month);
  if(gIdx>-1) STATE.months[gIdx] = monthObj; else STATE.months.push(monthObj);
  STATE.months.sort((a,b)=> a.month<b.month?-1:1);
}

function deleteMonth(key){
  let local = loadLocalMonths();
  local = local.filter(m=>m.month!==key);
  saveLocalMonths(local);
  STATE.months = STATE.months.filter(m=>m.month!==key || m.__source!=='local');
  paintChrome();
  renderAll();
  toast('Removed local upload for '+monthLabel(key)+'. (GitHub-published data, if any, is untouched.)');
}

function hideGithubMonth(key){
  if(!confirm('Remove '+monthLabel(key)+' from this dashboard?\n\nThis only hides it in this browser. To delete it from the published site for everyone, also remove data/months/'+key+'.json and its entry in data/manifest.json from your GitHub repo, then commit & push.')) return;
  const hidden = loadHiddenMonths();
  if(!hidden.includes(key)) hidden.push(key);
  saveHiddenMonths(hidden);
  STATE.months = STATE.months.filter(m=>m.month!==key);
  paintChrome();
  renderAll();
  toast('Hidden '+monthLabel(key)+' in this browser. Delete data/months/'+key+'.json + its manifest.json entry in your repo to remove it everywhere.');
}

function unhideGithubMonth(key){
  let hidden = loadHiddenMonths();
  hidden = hidden.filter(k=>k!==key);
  saveHiddenMonths(hidden);
  toast('Restored '+monthLabel(key)+'. Reloading…');
  boot();
}

/* month confirmation modal */
function askMonth(guess, filename){
  return new Promise(resolve=>{
    const bg = document.getElementById('monthModalBg');
    const sel = document.getElementById('mmMonth');
    document.getElementById('mmSub').textContent = `File: ${filename}. Confirm the reporting month for this snapshot.`;
    sel.innerHTML = '';
    const now = new Date();
    const opts = [];
    for(let i=0;i<24;i++){
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      opts.push(key);
    }
    if(guess && !opts.includes(guess)) opts.unshift(guess);
    for(const key of opts){
      const o = document.createElement('option');
      o.value = key; o.textContent = monthLabel(key);
      if(key===guess) o.selected = true;
      sel.appendChild(o);
    }
    bg.classList.add('show');
    const cleanup = ()=>{ bg.classList.remove('show'); save.onclick=null; cancel.onclick=null; };
    const save = document.getElementById('mmSave');
    const cancel = document.getElementById('mmCancel');
    save.onclick = ()=>{ const v = sel.value; cleanup(); resolve(v); };
    cancel.onclick = ()=>{ cleanup(); resolve(null); };
  });
}

/* ---------------- computation engine ---------------- */
// Sorted ascending by month already maintained in STATE.months
function monthsDesc(){ return [...STATE.months].sort((a,b)=> a.month<b.month?1:-1); }

function windowMonths(count){
  // count=null means "all"
  const desc = monthsDesc();
  return count==null ? desc : desc.slice(0, count);
}

function nQuestions(){
  for(const m of STATE.months) if(m.questions && m.questions.length) return m.questions.length;
  return 0;
}
function questionLabels(short){
  for(const m of monthsDesc()){
    if(m.questions && m.questions.length) return short ? (m.questionsShort||m.questions) : m.questions;
  }
  return [];
}

// weighted mean of a field ('pos'|'neg') for question index qi, across a set of rows
function weightedMean(rows, qi, field){
  let sumW=0, sumWV=0, n=0;
  for(const r of rows){
    const cell = r.q && r.q[qi];
    if(!cell || cell[field]==null) continue;
    const w = (r.total!=null && r.total>0) ? r.total : 1;
    sumW += w; sumWV += w*cell[field]; n++;
  }
  if(n===0) return null;
  return sumWV/sumW;
}

function allRowsIn(monthsList){
  const out = [];
  for(const m of monthsList) for(const r of m.rows) out.push(r);
  return out;
}

// Overall district stats for a set of months: per-question pooled weighted mean,
// plus an overall score = simple mean across questions (each question represents
// one independent survey item asked of the same respondent base).
function periodStats(monthsList){
  const nq = nQuestions();
  const rows = allRowsIn(monthsList);
  const perQ = [];
  for(let qi=0; qi<nq; qi++){
    perQ.push({ pos: weightedMean(rows, qi, 'pos'), neg: weightedMean(rows, qi, 'neg') });
  }
  const posVals = perQ.map(x=>x.pos).filter(v=>v!=null);
  const negVals = perQ.map(x=>x.neg).filter(v=>v!=null);
  const overallPos = posVals.length ? posVals.reduce((a,b)=>a+b,0)/posVals.length : null;
  const overallNeg = negVals.length ? negVals.reduce((a,b)=>a+b,0)/negVals.length : null;
  return { perQ, overallPos, overallNeg, nMonths: monthsList.length, monthKeys: monthsList.map(m=>m.month) };
}

function periodDateRange(monthsList){
  if(monthsList.length===0) return '—';
  const sorted = [...monthsList].sort((a,b)=>a.month<b.month?-1:1);
  const first = sorted[0], last = sorted[sorted.length-1];
  return first.month===last.month ? monthLabel(first.month) : `${monthLabel(first.month)} – ${monthLabel(last.month)}`;
}

// Station (PS) level rollup across a set of months
function stationRollup(monthsList){
  const nq = nQuestions();
  const byLoc = {};
  for(const m of monthsList){
    for(const r of m.rows){
      const key = r.location || r.mandal;
      if(!byLoc[key]) byLoc[key] = {location:r.location, mandal:r.mandal, rows:[]};
      byLoc[key].rows.push(r);
      byLoc[key].mandal = r.mandal || byLoc[key].mandal; // keep latest mandal name
    }
  }
  const list = Object.values(byLoc).map(st=>{
    const perQ = [], perQNeg = [];
    for(let qi=0; qi<nq; qi++){
      perQ.push(weightedMean(st.rows, qi, 'pos'));
      perQNeg.push(weightedMean(st.rows, qi, 'neg'));
    }
    const valid = perQ.filter(v=>v!=null);
    const score = valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : null;
    const validNeg = perQNeg.filter(v=>v!=null);
    const scoreNeg = validNeg.length ? validNeg.reduce((a,b)=>a+b,0)/validNeg.length : null;
    const totalResp = st.rows.reduce((a,r)=>a+(r.total||0),0);
    return { location: st.location, mandal: st.mandal, perQ, perQNeg, score, scoreNeg, totalResp, nSnapshots: st.rows.length };
  }).filter(s=>s.score!=null);
  list.sort((a,b)=> b.score - a.score);
  list.forEach((s,i)=> s.rank = i+1);
  return list;
}

function periodWindowForKey(key){
  // returns list of months for a named period, most-recent-first source is monthsDesc()
  if(key==='month') return windowMonths(1);
  if(key==='quarter') return windowMonths(3);
  if(key==='half') return windowMonths(6);
  if(key==='year') return windowMonths(12);
  return windowMonths(null);
}

/* ---------------- color helpers ---------------- */
function posColor(v){
  if(v==null) return '#94a3b8';
  if(v>=70) return '#16a36a';
  if(v>=60) return '#3f9fe6';
  if(v>=50) return '#e3b53d';
  if(v>=40) return '#f3792b';
  return '#ec4848';
}
function posSoftBg(v){
  if(v==null) return '#eef1f6';
  if(v>=70) return '#e6f7ee';
  if(v>=60) return '#e8f1fd';
  if(v>=50) return '#fdf3da';
  if(v>=40) return '#fdeadd';
  return '#fbe3e3';
}
function fmt1(v){ return v==null ? '—' : v.toFixed(1); }
function fmtPill(v){
  if(v==null) return '<span class="small">—</span>';
  return `<span class="pill" style="background:${posSoftBg(v)};color:${posColor(v)}">${v.toFixed(1)}%</span>`;
}
// negative-percentage coloring: high negative = bad (red), low negative = good (green) — mirror of posColor
function negColor(v){ return v==null ? '#94a3b8' : posColor(100-v); }
function negSoftBg(v){ return v==null ? '#eef1f6' : posSoftBg(100-v); }
function fmtPillNeg(v){
  if(v==null) return '<span class="small">—</span>';
  return `<span class="pill" style="background:${negSoftBg(v)};color:${negColor(v)}">${v.toFixed(1)}%</span>`;
}

/* ---------------- chrome (header stats, tabs) ---------------- */
function paintChrome(){
  const nq = nQuestions();
  const desc = monthsDesc();
  const latest = desc[0];
  document.getElementById('s-ps').textContent = latest ? new Set(latest.rows.map(r=>r.location)).size : '—';
  document.getElementById('s-q').textContent = nq || '—';
  document.getElementById('s-mo').textContent = STATE.months.length || '—';
  document.getElementById('h-asof').textContent = latest ? `Latest report: ${latest.reportLabel||monthLabel(latest.month)}` : 'Report as on: —';

  const visibleTabs = TABS.filter(t=> t.id!=='data' || STATE.isAdmin);
  const tabrow = document.getElementById('tabrow');
  tabrow.innerHTML = visibleTabs.map(t=>`<button class="tabbtn ${t.id===STATE.activeTab?'active':''}" data-tab="${t.id}">${t.label}</button>`).join('');
  tabrow.querySelectorAll('.tabbtn').forEach(b=> b.onclick = ()=> switchTab(b.dataset.tab));

  const btnUp = document.getElementById('btnGoUpload');
  if(btnUp) btnUp.innerHTML = STATE.isAdmin ? '⬆ Upload Monthly Report' : '🔒 Admin Login';
  const btnLogout = document.getElementById('btnAdminLogout');
  if(btnLogout) btnLogout.style.display = STATE.isAdmin ? 'inline-flex' : 'none';
}

async function switchTab(id){
  if(id==='data' && !STATE.isAdmin){
    const ok = await adminLogin();
    if(!ok) return;
    paintChrome();
  }
  STATE.activeTab = id;
  document.querySelectorAll('.tabbtn').forEach(b=> b.classList.toggle('active', b.dataset.tab===id));
  document.querySelectorAll('.panel').forEach(p=> p.classList.remove('active'));
  document.getElementById('p-'+id).classList.add('active');
  renderTab(id);
}

function renderAll(){ renderTab(STATE.activeTab); }

function renderTab(id){
  if(id==='data' && !STATE.isAdmin){
    document.getElementById('p-data').innerHTML = `<div class="card"><div class="emptynote">
      <div class="big">🔒</div><h3>Admin only</h3>
      <p style="margin-top:6px">Report uploads are restricted to district admins.</p>
    </div></div>`;
    return;
  }
  if(STATE.months.length===0 && id!=='data' && id!=='method'){
    document.getElementById('p-'+id).innerHTML = emptyState();
    return;
  }
  ({
    overview: renderOverview,
    rankings: renderRankings,
    heatmap: renderHeatmap,
    detail: renderDetail,
    data: renderData,
    method: renderMethod,
  })[id]();
}

function emptyState(){
  const cta = STATE.isAdmin
    ? `<div style="margin-top:14px"><button class="btn primary" onclick="switchTab('data')">Go to Data &amp; Upload</button></div>`
    : '';
  return `<div class="card"><div class="emptynote">
    <div class="big">📊</div>
    <h3>No report data published yet</h3>
    <p style="margin-top:6px">The monthly "Mandal / Location Wise Analysis Report" is uploaded by district admins. Please check back soon.</p>
    ${cta}
  </div></div>`;
}

/* ---------------- OVERVIEW ---------------- */
function renderOverview(){
  const el = document.getElementById('p-overview');
  const periods = [
    {key:'month', label:'Monthly Score', months: periodWindowForKey('month')},
    {key:'quarter', label:'Quarter Score', months: periodWindowForKey('quarter')},
    {key:'year', label:'Year Score', months: periodWindowForKey('year')},
  ];
  const stats = periods.map(p=>({ ...p, stat: periodStats(p.months) }));

  const cards = stats.map(p=>{
    const s = p.stat;
    return `<div class="scorecard">
      <div class="sctop"><h4>${p.label}</h4><span class="scdate">${periodDateRange(p.months)}</span></div>
      <div class="scrow">
        <div class="scitem"><div class="scicon pos">👍</div><div><div class="scval" style="color:var(--up)">${fmt1(s.overallPos)}%</div><div class="sclabel">Positive</div></div></div>
        <div class="scitem"><div class="scicon neg">👎</div><div><div class="scval" style="color:var(--down)">${fmt1(s.overallNeg)}%</div><div class="sclabel">Negative</div></div></div>
      </div>
      <div class="scfoot">Based on ${s.nMonths} month(s) of uploaded data</div>
    </div>`;
  }).join('');

  const qLabels = questionLabels(false);
  const qShort = questionLabels(true);
  const colSets = [
    {label:'Current Month', months: periodWindowForKey('month')},
    {label:'Last Month', months: windowMonths(2).slice(1,2)},
    {label:'Last 6 Months', months: periodWindowForKey('half')},
    {label:'Last 1 Year', months: periodWindowForKey('year')},
  ];
  const colStats = colSets.map(c=> ({...c, stat: periodStats(c.months)}));

  let rowsHtml = '';
  for(let qi=0; qi<qLabels.length; qi++){
    rowsHtml += `<tr><td class="rank">${qi+1}</td><td><div style="font-weight:600">${qShort[qi]}</div><div class="qtxt">${qLabels[qi]}</div></td>`;
    for(const c of colStats){
      const pos = c.stat.perQ[qi]?.pos, neg = c.stat.perQ[qi]?.neg;
      rowsHtml += `<td class="center" style="background:${posSoftBg(pos)}"><b style="color:${posColor(pos)}">${fmt1(pos)}</b></td>`;
      rowsHtml += `<td class="center" style="background:${posSoftBg(neg==null?null:100-neg)}"><b style="color:${posColor(neg==null?null:100-neg)}">${fmt1(neg)}</b></td>`;
    }
    rowsHtml += `</tr>`;
  }

  const theadCols = colStats.map(c=>`<th class="center" colspan="2">${c.label}</th>`).join('');
  const subCols = colStats.map(()=>`<th class="center">+ve (%)</th><th class="center">-ve (%)</th>`).join('');

  el.innerHTML = `
    <div class="grid g3">${cards}</div>
    <div class="card">
      <div class="ch"><h3>Question-wise Feedback Breakdown</h3></div>
      <div class="cb" style="overflow-x:auto">
        <table>
          <thead><tr><th></th><th>Question</th>${theadCols}</tr><tr><th></th><th></th>${subCols}</tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="10" class="emptynote">No question data available.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="grid g2">
      <div class="card">
        <div class="ch"><h3>Top 5 Police Stations — Current Month</h3></div>
        <div class="cb">${miniRankTable(stationRollup(periodWindowForKey('month')).slice(0,5))}</div>
      </div>
      <div class="card">
        <div class="ch"><h3>Bottom 5 Police Stations — Need Attention</h3></div>
        <div class="cb">${miniRankTable(stationRollup(periodWindowForKey('month')).slice(-5).reverse())}</div>
      </div>
    </div>
  `;
}

function miniRankTable(list){
  if(list.length===0) return `<div class="emptynote">No data</div>`;
  return `<table><thead><tr><th></th><th>Police Station</th><th>Mandal</th><th class="right">+ve</th><th class="right">-ve</th></tr></thead><tbody>
    ${list.map(s=>`<tr><td class="rank">#${s.rank}</td><td>${psShortName(s.location)}</td><td class="small">${s.mandal}</td><td class="right">${fmtPill(s.score)}</td><td class="right">${fmtPillNeg(s.scoreNeg)}</td></tr>`).join('')}
  </tbody></table>`;
}

function psShortName(loc){
  if(!loc) return '—';
  const parts = String(loc).split(',');
  return parts.length>1 ? parts.slice(1).join(',').trim() : loc;
}

/* ---------------- RANKINGS ---------------- */
function renderRankings(){
  const el = document.getElementById('p-rankings');
  const periodOpts = [['month','This Month'],['quarter','Last 3 Months'],['half','Last 6 Months'],['year','Last 12 Months'],['all','All Loaded Data']];
  el.innerHTML = `
    <div class="card">
      <div class="ch" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <h3>Police Station Rankings — Positive Feedback Score</h3>
        <select id="rankPeriodSel">${periodOpts.map(([k,l])=>`<option value="${k}" ${k===STATE.rankPeriod?'selected':''}>${l}</option>`).join('')}</select>
      </div>
      <div class="cb"><div class="chart-box" id="rankChartBox" style="height:520px"><canvas id="c-rank"></canvas></div></div>
    </div>
    <div class="card">
      <div class="ch"><h3>Full Ranking Table</h3></div>
      <div class="cb" style="overflow-x:auto" id="rankTableWrap"></div>
    </div>
  `;
  document.getElementById('rankPeriodSel').onchange = (e)=>{ STATE.rankPeriod = e.target.value; drawRankings(); };
  drawRankings();
}

function drawRankings(){
  const months = periodWindowForKey(STATE.rankPeriod);
  const list = stationRollup(months);
  const qShort = questionLabels(true);

  destroyChart('rank');
  const ctx = document.getElementById('c-rank');
  if(ctx){
    CHARTS.rank = new Chart(ctx, {
      type:'bar',
      data:{
        labels: list.map(s=>psShortName(s.location)),
        datasets:[{
          label:'Positive Score (%)',
          data: list.map(s=>s.score),
          backgroundColor: list.map(s=>posColor(s.score)),
          borderRadius:4,
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>`${c.parsed.x.toFixed(1)}% positive`}}},
        scales:{ x:{min:0,max:100,grid:{color:'#eef1f6'}}, y:{grid:{display:false}, ticks:{autoSkip:false,font:{size:10}}} }
      }
    });
  }

  const rows = list.map(s=>`<tr>
    <td class="rank">#${s.rank}</td>
    <td><b>${psShortName(s.location)}</b></td>
    <td class="small">${s.mandal}</td>
    <td class="right">${(s.totalResp||0).toLocaleString()}</td>
    ${qShort.map((q,i)=>`<td class="center">${fmtPill(s.perQ[i])}</td><td class="center">${fmtPillNeg(s.perQNeg[i])}</td>`).join('')}
    <td class="right"><b style="color:${posColor(s.score)}">${fmt1(s.score)}%</b></td>
    <td class="right"><b style="color:${negColor(s.scoreNeg)}">${fmt1(s.scoreNeg)}%</b></td>
  </tr>`).join('');

  const qHead = qShort.map(q=>`<th class="center" colspan="2">${q}</th>`).join('');
  const qSubHead = qShort.map(()=>`<th class="center small">+ve</th><th class="center small">-ve</th>`).join('');

  document.getElementById('rankTableWrap').innerHTML = `
    <table><thead>
    <tr><th rowspan="2">Rank</th><th rowspan="2">Police Station</th><th rowspan="2">Mandal</th><th rowspan="2" class="right">Responses</th>
    ${qHead}<th class="center" colspan="2">Overall</th></tr>
    <tr>${qSubHead}<th class="center small">+ve</th><th class="center small">-ve</th></tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="12" class="emptynote">No data for this period.</td></tr>`}</tbody></table>`;
}

/* ---------------- HEATMAP ---------------- */
function renderHeatmap(){
  const el = document.getElementById('p-heatmap');
  const desc = monthsDesc();
  if(!STATE.heatmapMonth || !desc.find(m=>m.month===STATE.heatmapMonth)) STATE.heatmapMonth = desc[0]?.month;
  const opts = desc.map(m=>`<option value="${m.month}" ${m.month===STATE.heatmapMonth?'selected':''}>${m.reportLabel||monthLabel(m.month)}</option>`).join('');
  el.innerHTML = `
    <div class="card">
      <div class="ch" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <h3>Police Station × Question Heatmap</h3>
        <select id="heatMonthSel">${opts}</select>
      </div>
      <div class="cb" style="overflow-x:auto" id="heatWrap"></div>
    </div>
  `;
  document.getElementById('heatMonthSel').onchange = (e)=>{ STATE.heatmapMonth = e.target.value; drawHeatmap(); };
  drawHeatmap();
}

function drawHeatmap(){
  const m = STATE.months.find(x=>x.month===STATE.heatmapMonth);
  const qShort = questionLabels(true);
  if(!m){ document.getElementById('heatWrap').innerHTML = `<div class="emptynote">No data.</div>`; return; }
  const rows = [...m.rows].sort((a,b)=> (a.mandal||'').localeCompare(b.mandal||'') || (a.location||'').localeCompare(b.location||''));
  const body = rows.map(r=>{
    const cells = r.q.map(c=>`<td class="center" style="background:${posSoftBg(c.pos)}">
      <b style="color:${posColor(c.pos)}">${fmt1(c.pos)}</b><span class="small"> / </span><span style="color:${negColor(c.neg)}">${fmt1(c.neg)}</span>
    </td>`).join('');
    return `<tr><td class="small">${r.mandal}</td><td>${psShortName(r.location)}</td><td class="right small">${r.total||0}</td>${cells}</tr>`;
  }).join('');
  document.getElementById('heatWrap').innerHTML = `
    <table><thead><tr><th>Mandal</th><th>Police Station</th><th class="right">Responses</th>${qShort.map(q=>`<th class="center">${q}</th>`).join('')}</tr></thead>
    <tbody>${body || `<tr><td colspan="10" class="emptynote">No rows.</td></tr>`}</tbody></table>
    <div class="small" style="margin-top:10px">Each cell shows <b>+ve% / -ve%</b>. Background &amp; bold value reflect the positive score — green = strong, red = needs attention.</div>`;
}

/* ---------------- PS DETAIL ---------------- */
function renderDetail(){
  const el = document.getElementById('p-detail');
  const allTime = stationRollup(windowMonths(null));
  if(!STATE.detailPS && allTime.length) STATE.detailPS = allTime[0].location;
  const opts = allTime.map(s=>`<option value="${s.location}" ${s.location===STATE.detailPS?'selected':''}>#${s.rank} — ${psShortName(s.location)}</option>`).join('');
  el.innerHTML = `
    <div class="card">
      <div class="ch" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <h3>Police Station Detail</h3>
        <select id="detailSel" style="min-width:260px">${opts}</select>
      </div>
      <div class="cb" id="detailBody"></div>
    </div>
  `;
  document.getElementById('detailSel').onchange = (e)=>{ STATE.detailPS = e.target.value; drawDetail(); };
  drawDetail();
}

function drawDetail(){
  const loc = STATE.detailPS;
  const body = document.getElementById('detailBody');
  if(!loc){ body.innerHTML = `<div class="emptynote">No station selected.</div>`; return; }
  const monthRollup = stationRollup(periodWindowForKey('month')).find(s=>s.location===loc);
  const quarterRollup = stationRollup(periodWindowForKey('quarter')).find(s=>s.location===loc);
  const yearRollup = stationRollup(periodWindowForKey('year')).find(s=>s.location===loc);
  const qShort = questionLabels(true);
  const mandal = monthRollup?.mandal || quarterRollup?.mandal || yearRollup?.mandal || '—';

  body.innerHTML = `
    <div class="grid g3">
      <div class="scorecard"><div class="sctop"><h4>This Month</h4></div>
        <div class="scrow" style="margin-top:8px">
          <div class="scitem"><div class="scicon pos">👍</div><div><div class="scval" style="color:${posColor(monthRollup?.score)}">${fmt1(monthRollup?.score)}%</div><div class="sclabel">Positive</div></div></div>
          <div class="scitem"><div class="scicon neg">👎</div><div><div class="scval" style="color:${negColor(monthRollup?.scoreNeg)}">${fmt1(monthRollup?.scoreNeg)}%</div><div class="sclabel">Negative</div></div></div>
        </div>
        <div class="scfoot">Rank #${monthRollup?.rank ?? '—'}</div></div>
      <div class="scorecard"><div class="sctop"><h4>Last 3 Months</h4></div>
        <div class="scrow" style="margin-top:8px">
          <div class="scitem"><div class="scicon pos">👍</div><div><div class="scval" style="color:${posColor(quarterRollup?.score)}">${fmt1(quarterRollup?.score)}%</div><div class="sclabel">Positive</div></div></div>
          <div class="scitem"><div class="scicon neg">👎</div><div><div class="scval" style="color:${negColor(quarterRollup?.scoreNeg)}">${fmt1(quarterRollup?.scoreNeg)}%</div><div class="sclabel">Negative</div></div></div>
        </div>
        <div class="scfoot">Rank #${quarterRollup?.rank ?? '—'}</div></div>
      <div class="scorecard"><div class="sctop"><h4>Last 12 Months</h4></div>
        <div class="scrow" style="margin-top:8px">
          <div class="scitem"><div class="scicon pos">👍</div><div><div class="scval" style="color:${posColor(yearRollup?.score)}">${fmt1(yearRollup?.score)}%</div><div class="sclabel">Positive</div></div></div>
          <div class="scitem"><div class="scicon neg">👎</div><div><div class="scval" style="color:${negColor(yearRollup?.scoreNeg)}">${fmt1(yearRollup?.scoreNeg)}%</div><div class="sclabel">Negative</div></div></div>
        </div>
        <div class="scfoot">Rank #${yearRollup?.rank ?? '—'}</div></div>
    </div>
    <div class="small" style="margin:4px 0 14px">Mandal: <b>${mandal}</b> &nbsp;•&nbsp; Full name: ${loc}</div>
    <div class="grid g2">
      <div class="card" style="margin-bottom:0">
        <div class="ch"><h3>Question-wise Breakdown (This Month)</h3></div>
        <div class="cb"><div class="chart-box" style="height:300px"><canvas id="c-det-bars"></canvas></div></div>
      </div>
      <div class="card" style="margin-bottom:0">
        <div class="ch"><h3>Monthly Trend for this Station</h3></div>
        <div class="cb"><div class="chart-box" style="height:300px"><canvas id="c-det-trend"></canvas></div></div>
      </div>
    </div>
    <div class="card">
      <div class="ch"><h3>Question-wise Figures</h3></div>
      <div class="cb" style="overflow-x:auto">
        <table><thead><tr><th>Question</th><th class="center">+ve (%)</th><th class="center">-ve (%)</th></tr></thead>
        <tbody>${qShort.map((q,i)=>`<tr><td>${q}</td><td class="center">${fmtPill(monthRollup?.perQ[i])}</td><td class="center">${fmtPillNeg(monthRollup?.perQNeg[i])}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>
  `;

  destroyChart('detbars');
  const bctx = document.getElementById('c-det-bars');
  if(bctx){
    const posVals = qShort.map((q,i)=> monthRollup?.perQ[i] ?? null);
    const negVals = qShort.map((q,i)=> monthRollup?.perQNeg[i] ?? null);
    CHARTS.detbars = new Chart(bctx, { type:'bar',
      data:{ labels: qShort, datasets:[
        { label:'Positive (%)', data: posVals, backgroundColor:'#16a36a', borderRadius:4 },
        { label:'Negative (%)', data: negVals, backgroundColor:'#ec4848', borderRadius:4 },
      ] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true, position:'bottom', labels:{boxWidth:12,font:{size:11}}}},
        scales:{ y:{min:0,max:100,grid:{color:'#eef1f6'}}, x:{grid:{display:false}, ticks:{font:{size:10}}} } } });
  }

  destroyChart('dettrend');
  const tctx = document.getElementById('c-det-trend');
  if(tctx){
    const asc = [...STATE.months].sort((a,b)=> a.month<b.month?-1:1);
    const labels = [], vals = [], negVals = [];
    for(const m of asc){
      const rows = m.rows.filter(r=>r.location===loc);
      if(rows.length===0) continue;
      const nq = nQuestions();
      const perQ = [], perQNeg = [];
      for(let qi=0; qi<nq; qi++){ perQ.push(weightedMean(rows, qi, 'pos')); perQNeg.push(weightedMean(rows, qi, 'neg')); }
      const valid = perQ.filter(v=>v!=null);
      const validNeg = perQNeg.filter(v=>v!=null);
      labels.push(m.reportLabel||monthLabel(m.month));
      vals.push(valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : null);
      negVals.push(validNeg.length ? validNeg.reduce((a,b)=>a+b,0)/validNeg.length : null);
    }
    CHARTS.dettrend = new Chart(tctx, { type:'line',
      data:{ labels, datasets:[
        { label:'Positive (%)', data: vals, borderColor:'#16a36a', backgroundColor:'#16a36a22', fill:true, tension:.3, pointRadius:4 },
        { label:'Negative (%)', data: negVals, borderColor:'#ec4848', backgroundColor:'#ec484822', fill:true, tension:.3, pointRadius:4 },
      ] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true, position:'bottom', labels:{boxWidth:12,font:{size:11}}}},
        scales:{ y:{min:0,max:100,grid:{color:'#eef1f6'}}, x:{grid:{display:false}} } } });
  }
}

/* ---------------- DATA & UPLOAD ---------------- */
function renderData(){
  const el = document.getElementById('p-data');
  const desc = monthsDesc();
  const rows = desc.map(m=>{
    const badge = m.__source==='github' ? '<span class="badge gh">GitHub</span>'
                : m.__source==='local' ? '<span class="badge local">This Browser</span>'
                : '<span class="badge seed">Sample</span>';
    return `<tr><td><b>${m.reportLabel||monthLabel(m.month)}</b></td><td class="small">${m.sourceFile||'—'}</td>
      <td>${badge}</td><td class="right">${new Set(m.rows.map(r=>r.location)).size}</td>
      <td class="right">${m.questions?.length ?? '—'}</td>
      <td class="right">
        <button class="linkbtn" onclick="downloadMonthJson('${m.month}')">Export JSON</button>
        ${m.__source==='local' ? ` &nbsp;·&nbsp; <button class="linkbtn" style="color:var(--down)" onclick="deleteMonth('${m.month}')">Remove</button>` : ''}
        ${m.__source==='github' ? ` &nbsp;·&nbsp; <button class="linkbtn" style="color:var(--down)" onclick="hideGithubMonth('${m.month}')">Remove</button>` : ''}
      </td></tr>`;
  }).join('');

  const hiddenKeys = loadHiddenMonths();
  const hiddenRow = hiddenKeys.length ? `
    <div class="card">
      <div class="ch"><h3>Hidden in This Browser</h3></div>
      <div class="cb small">
        ${hiddenKeys.map(k=>`<div style="margin-bottom:6px">${monthLabel(k)} &nbsp;·&nbsp; <button class="linkbtn" onclick="unhideGithubMonth('${k}')">Restore</button></div>`).join('')}
      </div>
    </div>` : '';

  el.innerHTML = `
    <div class="card">
      <div class="ch"><h3>Upload This Month's Report</h3></div>
      <div class="cb">
        <div class="dropzone" id="dropzone">
          <div class="dzicon">📁</div>
          <div class="dzlabel">Click to choose, or drag & drop your Excel file here</div>
          <div class="dzsub">Expected format: "District / Mandal / Location Wise Analysis Report" (.xlsx) — same layout every month, with Mandal, Location, Total and one +ve(%)/-ve(%) column pair per question.</div>
        </div>
        <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" multiple hidden>
        <div class="small" style="margin-top:10px">Uploaded files are parsed entirely in your browser and stored locally so this dashboard keeps working month after month. Nothing is sent to any server.</div>
      </div>
    </div>

    <div class="card">
      <div class="ch"><h3>Loaded Months</h3></div>
      <div class="cb" style="overflow-x:auto">
        <table><thead><tr><th>Month</th><th>Source File</th><th>Origin</th><th class="right">Stations</th><th class="right">Questions</th><th class="right">Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="emptynote">Nothing loaded yet.</td></tr>`}</tbody></table>
      </div>
    </div>

    ${hiddenRow}

    <div class="card">
      <div class="ch"><h3>Publish to GitHub (recommended)</h3></div>
      <div class="cb">
        <p style="color:var(--muted);font-size:13.5px;line-height:1.6">
        Local uploads only live in this browser. To make a month's data show up for everyone who visits your GitHub Pages site
        (and to keep it safe if you clear your browser), export it and commit it to your repository:
        </p>
        <ol style="margin:12px 0 0 20px;color:var(--muted);font-size:13.5px;line-height:1.9">
          <li>Click <b>Export JSON</b> next to a month above — this downloads e.g. <code>2026-07.json</code>.</li>
          <li>Add the file to <code>data/months/</code> in your GitHub repository.</li>
          <li>Add the month key (e.g. <code>"2026-07"</code>) to the <code>months</code> array in <code>data/manifest.json</code>.</li>
          <li>Commit &amp; push. GitHub Pages will serve it automatically — the dashboard fetches <code>data/manifest.json</code> on every visit.</li>
        </ol>
        <div class="btnrow" style="margin-top:14px">
          <button class="btn" id="downloadManifest">⬇ Export manifest.json (all loaded months)</button>
        </div>
      </div>
    </div>
  `;

  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('fileInput');
  dz.onclick = ()=> fi.click();
  fi.onchange = (e)=> handleFiles(e.target.files);
  ['dragover','dragenter'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e=>{ if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  document.getElementById('downloadManifest').onclick = ()=>{
    const manifest = { months: monthsDesc().map(m=>m.month).sort() };
    downloadJson(manifest, 'manifest.json');
  };
}

function downloadMonthJson(key){
  const m = STATE.months.find(x=>x.month===key);
  if(!m) return;
  const clean = JSON.parse(JSON.stringify(m));
  delete clean.__source;
  downloadJson(clean, `${key}.json`);
}

function downloadJson(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 1)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ---------------- METHODOLOGY ---------------- */
function renderMethod(){
  const el = document.getElementById('p-method');
  el.innerHTML = `
    <div class="card">
      <div class="ch"><h3>How scores are calculated</h3></div>
      <div class="cb" style="color:var(--muted);font-size:13.5px;line-height:1.85">
        <p><b>Per question, per police station:</b> the "+ve(%)" and "-ve(%)" figures come directly from each month's uploaded report.</p>
        <p style="margin-top:10px"><b>Combining months (Quarter / Half-Year / Year):</b> all police-station rows from the months in that window are pooled, and a response-weighted average (weighted by the "Total" respondent count) is taken per question. This avoids letting a low-response station's number carry the same weight as a high-response station.</p>
        <p style="margin-top:10px"><b>Overall Score (Month / Quarter / Year cards):</b> the simple average of the per-question positive percentages for that period, since each question is asked of a comparable respondent base.</p>
        <p style="margin-top:10px"><b>Police Station Ranking:</b> stations are ranked by their overall positive score for the selected period, computed the same way (response-weighted per question, then averaged across questions).</p>
        <p style="margin-top:10px;color:var(--faint)">With only one month of data loaded, the Month/Quarter/Year figures will be identical — that's expected. They diverge naturally as you upload more months.</p>
      </div>
    </div>
    <div class="card">
      <div class="ch"><h3>Expected Excel format</h3></div>
      <div class="cb" style="color:var(--muted);font-size:13.5px;line-height:1.85">
        <p>One sheet with a header row containing <code>Mandal</code>, <code>Location</code>, <code>Total</code>, and one column pair per feedback question, headed <code>&lt;question text&gt; +ve(%)</code> and <code>&lt;question text&gt; -ve(%)</code>. Column order and question count can change between uploads — the dashboard detects the pairs automatically from the header text.</p>
      </div>
    </div>
  `;
}

/* ---------------- misc ---------------- */
function destroyChart(k){ if(CHARTS[k]){ CHARTS[k].destroy(); delete CHARTS[k]; } }

/* ---------------- init ---------------- */
document.getElementById('btnRefresh').onclick = ()=> boot();
document.getElementById('btnGoUpload').onclick = ()=> switchTab('data');
const btnLogoutInit = document.getElementById('btnAdminLogout');
if(btnLogoutInit) btnLogoutInit.onclick = ()=> adminLogout();
boot();
