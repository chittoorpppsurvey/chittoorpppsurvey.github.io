/* ============================================================
   ENGINE — pure data logic for the PPP Police Station
   Performance dashboard. No DOM here; app.js consumes this.
   ============================================================ */
const Engine = (function(){

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTH_ABBR   = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const MONTH_FULL   = ['january','february','march','april','may','june','july','august','september','october','november','december'];

  function norm(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim(); }

  function toNum(v){
    if(v==null || v==='') return null;
    const n = parseFloat(String(v).replace(/[,%]/g,'').trim());
    return isNaN(n) ? null : Math.round(n*100)/100;
  }

  function monthKeyFromFilename(name){
    const s = name.toLowerCase();
    const yMatch = s.match(/20\d{2}/);
    const year = yMatch ? yMatch[0] : null;
    for(let i=0;i<12;i++){
      if(new RegExp('\\b'+MONTH_FULL[i]+'\\b').test(s) || new RegExp(MONTH_FULL[i]+'(?=20\\d{2})').test(s)){
        return year ? `${year}-${String(i+1).padStart(2,'0')}` : null;
      }
    }
    for(let i=0;i<12;i++){
      if(new RegExp('\\b'+MONTH_ABBR[i]+'\\b|'+MONTH_ABBR[i]+'(?=[_\\-.]?20\\d{2})').test(s)){
        return year ? `${year}-${String(i+1).padStart(2,'0')}` : null;
      }
    }
    return null;
  }

  function monthLabel(key){
    if(!key) return '—';
    const [y,m] = key.split('-');
    return `${MONTH_NAMES[parseInt(m,10)-1]} ${y}`;
  }
  function monthLabelShort(key){
    if(!key) return '—';
    const [y,m] = key.split('-');
    return `${MONTH_NAMES[parseInt(m,10)-1].slice(0,3)} '${y.slice(2)}`;
  }

  /* -------- parse a raw workbook (array-of-arrays) into row records -------- */
  function parseAOAToRows(aoa){
    if(!aoa || !aoa.length) throw new Error('Empty sheet.');
    let headerRowIdx = -1;
    for(let i=0;i<Math.min(aoa.length,6);i++){
      const row = (aoa[i]||[]).map(norm).map(c=>c.toLowerCase());
      if(row.includes('location') && (row.includes('positive percentage') || row.some(c=>c.includes('positive')))){ headerRowIdx = i; break; }
    }
    if(headerRowIdx === -1) throw new Error('Could not find a header row with a "Location" and "Positive Percentage" column. Please check the file matches the PPP IVRS Location Report template.');
    const header = (aoa[headerRowIdx]||[]).map(norm);
    const lower = header.map(h=>h.toLowerCase());
    const find = (...names)=>{ for(const n of names){ const i = lower.indexOf(n); if(i>-1) return i; } return -1; };
    const idxLoc = find('location');
    const idxPos = find('positive percentage','positive %','positive');
    const idxNeg = find('negative percentage','negative %','negative');
    const idxTot = find('total');
    const idxDistName = find('district name');
    if(idxLoc===-1 || idxPos===-1) throw new Error('Required columns ("Location", "Positive Percentage") not found in header row.');
    const rows = [];
    for(let r=headerRowIdx+1;r<aoa.length;r++){
      const row = aoa[r]; if(!row) continue;
      const location = norm(row[idxLoc]);
      if(!location) continue;
      const positive = toNum(row[idxPos]);
      const negative = idxNeg>-1 ? toNum(row[idxNeg]) : (positive==null?null:Math.round((100-positive)*100)/100);
      const total = idxTot>-1 ? toNum(row[idxTot]) : null;
      const district = idxDistName>-1 ? norm(row[idxDistName]) : 'Chittoor';
      if(positive==null && total==null) continue;
      rows.push({ location, district: district||'Chittoor', positive, negative, total: total==null?0:total });
    }
    if(rows.length===0) throw new Error('No police-station rows could be read from this file.');
    return rows;
  }

  /* -------- PS name helpers -------- */
  function psShortName(loc){
    if(!loc) return '—';
    const parts = String(loc).split(',');
    return parts.length>1 ? parts.slice(1).join(',').trim() : loc;
  }

  /* -------- build the merged month store for one dataset -------- */
  // monthsMap: { key -> {key, rows, sourceFile, source} }, embedded overridden by local
  function mergedMonths(embedded, local){
    const out = {};
    for(const k in (embedded||{})) out[k] = Object.assign({source:'embedded'}, embedded[k]);
    for(const k in (local||{})) out[k] = Object.assign({source:'local'}, local[k]);
    return out;
  }

  function sortedKeys(monthsObj){
    return Object.keys(monthsObj).sort();
  }

  /* -------- period construction: groups of chronological months -------- */
  function buildPeriods(monthKeys){
    const months = monthKeys.map(k=>({type:'month', id:k, label: monthLabel(k), shortLabel: monthLabelShort(k), months:[k]}));
    const quarters = [];
    for(let i=0;i<monthKeys.length;i+=3){
      const grp = monthKeys.slice(i,i+3);
      const qn = Math.floor(i/3)+1;
      quarters.push({type:'quarter', id:'Q'+qn, label:`Quarter ${qn} (${monthLabelShort(grp[0])}–${monthLabelShort(grp[grp.length-1])})`, shortLabel:`Q${qn}`, months:grp});
    }
    const halves = [];
    for(let i=0;i<monthKeys.length;i+=6){
      const grp = monthKeys.slice(i,i+6);
      const hn = Math.floor(i/6)+1;
      halves.push({type:'half', id:'H'+hn, label:`Half ${hn} (${monthLabelShort(grp[0])}–${monthLabelShort(grp[grp.length-1])})`, shortLabel:`H${hn}`, months:grp});
    }
    const year = monthKeys.length ? [{type:'year', id:'YEAR', label:`Full Period (${monthLabelShort(monthKeys[0])}–${monthLabelShort(monthKeys[monthKeys.length-1])})`, shortLabel:'Year', months:monthKeys.slice()}] : [];
    return {month:months, quarter:quarters, half:halves, year:year};
  }

  function findPeriod(periods, type, id){
    return (periods[type]||[]).find(p=>p.id===id) || null;
  }

  function prevPeriod(periods, type, id){
    const list = periods[type]||[];
    const idx = list.findIndex(p=>p.id===id);
    return idx>0 ? list[idx-1] : null;
  }

  /* -------- aggregate a dataset's rows across a set of months into per-PS scores -------- */
  // returns Map location -> {location, district, positive, negative, total, monthsPresent}
  function aggregate(monthsObj, monthKeysInPeriod){
    const acc = {};
    for(const mk of monthKeysInPeriod){
      const m = monthsObj[mk];
      if(!m) continue;
      for(const row of m.rows){
        const key = row.location;
        if(!acc[key]) acc[key] = {location:row.location, district:row.district, wSum:0, wTotal:0, simpleSum:0, simpleN:0, total:0, monthsPresent:0};
        const a = acc[key];
        if(row.positive!=null){
          const w = (row.total && row.total>0) ? row.total : 1;
          a.wSum += row.positive*w; a.wTotal += w;
          a.simpleSum += row.positive; a.simpleN += 1;
          a.monthsPresent += 1;
        }
        a.total += (row.total||0);
      }
    }
    const out = {};
    for(const key in acc){
      const a = acc[key];
      const positive = a.wTotal>0 ? Math.round((a.wSum/a.wTotal)*100)/100 : (a.simpleN>0 ? Math.round((a.simpleSum/a.simpleN)*100)/100 : null);
      out[key] = { location:a.location, district:a.district, positive, negative: positive==null?null:Math.round((100-positive)*100)/100, total:a.total, monthsPresent:a.monthsPresent };
    }
    return out;
  }

  function districtWideAvg(psMap){
    const vals = Object.values(psMap).filter(p=>p.positive!=null);
    if(!vals.length) return null;
    // weight by respondent total, fallback simple mean
    const wTotal = vals.reduce((s,p)=>s+(p.total||0),0);
    if(wTotal>0) return Math.round((vals.reduce((s,p)=>s+p.positive*(p.total||0),0)/wTotal)*100)/100;
    return Math.round((vals.reduce((s,p)=>s+p.positive,0)/vals.length)*100)/100;
  }

  /* -------- combine CAW + GANJA per-PS maps into an "overall" map -------- */
  function combineOverall(cawMap, ganjaMap){
    const keys = new Set([...Object.keys(cawMap||{}), ...Object.keys(ganjaMap||{})]);
    const out = {};
    keys.forEach(k=>{
      const c = cawMap ? cawMap[k] : null;
      const g = ganjaMap ? ganjaMap[k] : null;
      const vals = [];
      if(c && c.positive!=null) vals.push(c.positive);
      if(g && g.positive!=null) vals.push(g.positive);
      const positive = vals.length ? Math.round((vals.reduce((s,v)=>s+v,0)/vals.length)*100)/100 : null;
      out[k] = {
        location:k,
        district:(c&&c.district)||(g&&g.district)||'Chittoor',
        positive,
        caw: c ? c.positive : null,
        ganja: g ? g.positive : null,
      };
    });
    return out;
  }

  function rankList(psMap, metricFn){
    metricFn = metricFn || (p=>p.positive);
    const list = Object.values(psMap).filter(p=>metricFn(p)!=null);
    list.sort((a,b)=>metricFn(b)-metricFn(a));
    list.forEach((p,i)=>p.rank=i+1);
    return list;
  }

  function pctChange(a,b){
    if(a==null||b==null) return null;
    if(a===0) return b===0?0:null;
    return Math.round(((b-a)/a)*10000)/100;
  }

  return {
    MONTH_NAMES, norm, toNum, monthKeyFromFilename, monthLabel, monthLabelShort,
    parseAOAToRows, psShortName, mergedMonths, sortedKeys, buildPeriods, findPeriod,
    prevPeriod, aggregate, districtWideAvg, combineOverall, rankList, pctChange
  };
})();
