/* ============================================================
   APP — renders the PPP Police Station Performance dashboard
   on top of Engine (data logic) + EMBEDDED_DATA (12/13-month
   CAW + Ganja datasets). No build step; vanilla DOM + Chart.js.
   ============================================================ */
(function(){
  'use strict';

  /* ---------------- data bootstrap ---------------- */
  var RAW = window.EMBEDDED_DATA || {caw:{}, ganja:{}};
  var monthsCAW   = Engine.mergedMonths(RAW.caw, {});
  var monthsGANJA = Engine.mergedMonths(RAW.ganja, {});
  var keysCAW   = Engine.sortedKeys(monthsCAW);
  var keysGANJA = Engine.sortedKeys(monthsGANJA);
  var allKeys = Array.from(new Set(keysCAW.concat(keysGANJA))).sort();
  var PERIODS = Engine.buildPeriods(allKeys);

  function monthsObjFor(ds){ return ds==='ganja' ? monthsGANJA : monthsCAW; }

  function psMapForPeriod(ds, monthsInPeriod){
    return Engine.aggregate(monthsObjFor(ds), monthsInPeriod);
  }

  /* ---------------- global category (CAW / Ganja) ---------------- */
  var CATEGORY = 'caw';

  function periodByType(type){ return PERIODS[type] || []; }
  function period(type,id){ return Engine.findPeriod(PERIODS, type, id); }
  function defaultPeriod(type){ var l=periodByType(type); return l.length? l[l.length-1] : null; }

  var totalStations = (function(){
    var set = {};
    allKeys.forEach(function(k){
      [monthsCAW[k], monthsGANJA[k]].forEach(function(m){
        if(m) m.rows.forEach(function(r){ if(r.location) set[r.location]=1; });
      });
    });
    return Object.keys(set).length;
  })();

  /* ---------------- formatting helpers ---------------- */
  function fmtPct(v){ return v==null ? '—' : v.toFixed(1)+'%'; }
  function fmtDiff(v){ if(v==null) return '—'; var s = v>0?'+':''; return s+v.toFixed(1)+' pts'; }
  function fmtPctChange(v){ if(v==null) return '—'; var s = v>0?'+':''; return s+v.toFixed(1)+'%'; }
  function psShort(loc){ return Engine.psShortName(loc); }
  function arrow(v){
    if(v==null || Math.abs(v) < 0.05) return '<span class="arrowflat">▬</span>';
    return v>0 ? '<span class="arrowup">▲</span>' : '<span class="arrowdown">▼</span>';
  }
  function trendChip(v, opts){
    opts = opts||{};
    var cls = 'flat', txt='No change', arr='▬';
    if(v!=null && Math.abs(v) >= 0.05){
      cls = v>0?'up':'down'; arr = v>0?'▲':'▼';
      txt = arr+' '+Math.abs(v).toFixed(1)+(opts.pct?'%':' pts')+' '+(opts.suffix||'');
    } else { txt = arr+' steady'; }
    return '<span class="trend-chip '+cls+'">'+txt+'</span>';
  }
  function dsLabel(ds){ return ds==='ganja'?'Ganja':'Crime Against Women'; }
  function dsShort(ds){ return ds==='ganja'?'Ganja':'CAW'; }
  function periodTypeLabel(t){ return {month:'Monthly',quarter:'Quarterly',half:'Half-Yearly',year:'Yearly'}[t]||t; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  /* ---------------- toast ---------------- */
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg){
    if(!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------------- chart registry ---------------- */
  var CHARTS = {};
  function destroyChart(key){ if(CHARTS[key]){ CHARTS[key].destroy(); delete CHARTS[key]; } }
  var DS_COLOR = { caw:'#c5372f', ganja:'#1a8a54' };
  var PALETTE = ['#24507f','#c9973f','#1a8a54','#c5372f','#6b4fa0','#0f8fa8','#a0522d','#8a5fc9'];

  if(window.Chart && window.ChartDataLabels){ Chart.register(ChartDataLabels); }
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#66748c';

  function baseBarOptions(opts){
    opts = opts||{};
    return {
      indexAxis: opts.horizontal ? 'y' : 'x',
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display: !!opts.legend, labels:{boxWidth:12, font:{size:11.5}}},
        datalabels:{
          color:'#0f1b2d', font:{weight:'700', size:10.5},
          anchor: opts.horizontal ? 'end' : 'end',
          align: opts.horizontal ? 'right' : 'top',
          formatter: opts.labelFmt || function(v){ return v==null?'':v.toFixed(1); }
        },
        tooltip:{callbacks:{label:function(ctx){ return (ctx.dataset.label?ctx.dataset.label+': ':'')+ctx.formattedValue; }}}
      },
      scales: opts.horizontal ? {
        x:{ min:0, max: opts.max||100, grid:{color:'#e1e6ee'} },
        y:{ grid:{display:false}, ticks:{ autoSkip:false, font:{size:11.5} } }
      } : {
        x:{ grid:{display:false} },
        y:{ min:0, max: opts.max||100, grid:{color:'#e1e6ee'} }
      }
    };
  }
  function baseLineOptions(opts){
    opts = opts||{};
    return {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:true, labels:{boxWidth:12, font:{size:11.5}}},
        datalabels: opts.showLabels ? {
          color:'#0f1b2d', font:{weight:'700', size:10}, align:'top', anchor:'end',
          formatter:function(v){ return v==null?'':v.toFixed(1); }
        } : {display:false},
        tooltip:{mode:'index', intersect:false}
      },
      interaction:{mode:'index', intersect:false},
      scales:{
        x:{ grid:{display:false} },
        y:{ min:0, max:100, grid:{color:'#e1e6ee'}, title:{display:true,text:'Positive Perception (%)',font:{size:11}} }
      }
    };
  }

  /* ==================================================================
     TAB SWITCHING
     ================================================================== */
  var VIEWS = ['overview','rankings','trends','compare-periods','compare-ps'];
  var activeTab = 'overview';
  document.querySelectorAll('.tabbtn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var tab = btn.getAttribute('data-tab');
      activeTab = tab;
      document.querySelectorAll('.tabbtn').forEach(function(b){ b.classList.toggle('active', b===btn); });
      VIEWS.forEach(function(v){
        var el = document.getElementById('view-'+v);
        if(el) el.hidden = (v!==tab);
      });
      renderView(tab);
    });
  });

  document.querySelectorAll('#catswitch .catbtn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var cat = btn.getAttribute('data-cat');
      if(cat===CATEGORY) return;
      CATEGORY = cat;
      document.querySelectorAll('#catswitch .catbtn').forEach(function(b){ b.classList.toggle('active', b===btn); });
      // reset per-view ds-dependent selections that don't make sense across categories
      trState.ps = [];
      psState.selected = [];
      renderView(activeTab);
    });
  });

  function renderView(tab){
    if(tab==='overview') renderOverview();
    else if(tab==='rankings') renderRankings();
    else if(tab==='trends') renderTrends();
    else if(tab==='compare-periods') renderComparePeriods();
    else if(tab==='compare-ps') renderComparePS();
  }

  /* ==================================================================
     OVERVIEW
     ================================================================== */
  var ovState = { periodType:'year', periodId: (defaultPeriod('year')||{}).id };

  function overviewFilterBar(){
    var types = ['month','quarter','half','year'];
    return (
      '<div class="filterbar">' +
        '<div class="field"><label>Period Type</label><div class="pillgroup" id="ov-typegroup">' +
          types.map(function(t){ return '<button data-t="'+t+'" class="'+(ovState.periodType===t?'active':'')+'">'+periodTypeLabel(t)+'</button>'; }).join('') +
        '</div></div>' +
        '<div class="field"><label>Selected Period</label><select id="ov-period">' +
          periodByType(ovState.periodType).map(function(p){ return '<option value="'+p.id+'" '+(p.id===ovState.periodId?'selected':'')+'>'+p.label+'</option>'; }).join('') +
        '</select></div>' +
      '</div>'
    );
  }

  function renderOverview(){
    var host = document.getElementById('view-overview');
    var p = period(ovState.periodType, ovState.periodId) || defaultPeriod(ovState.periodType);
    if(p) ovState.periodId = p.id;
    var prev = p ? Engine.prevPeriod(PERIODS, ovState.periodType, p.id) : null;

    var dsMap = p ? psMapForPeriod(CATEGORY, p.months) : {};
    var dsAvg = Engine.districtWideAvg(dsMap);

    var prevAvg = null;
    if(prev){ prevAvg = Engine.districtWideAvg(psMapForPeriod(CATEGORY, prev.months)); }
    var trendDelta = (dsAvg!=null && prevAvg!=null) ? Math.round((dsAvg-prevAvg)*100)/100 : null;

    var ranked = Engine.rankList(Object.assign({}, dsMap));
    var top = ranked[0], bottom = ranked[ranked.length-1];

    host.innerHTML =
      overviewFilterBar() +
      '<div class="kpigrid">' +
        kpi('Total Police Stations', totalStations, '', 'brass', 'Across Chittoor district') +
        kpi('Selected Period', p?p.label:'—', '', '', periodTypeLabel(ovState.periodType)+' view') +
        kpi(dsLabel(CATEGORY)+' Performance', fmtPct(dsAvg), '', CATEGORY==='ganja'?'good':'', 'District-wide positive perception') +
        kpi('Top Performing PS', top?psShort(top.location):'—', '', 'good', top?fmtPct(top.positive):'') +
        kpi('Lowest Performing PS', bottom?psShort(bottom.location):'—', '', 'bad', bottom?fmtPct(bottom.positive):'') +
        kpiTrend('Change vs Previous Period', trendDelta, prev?('vs '+prev.label):'No prior period') +
      '</div>' +
      '<div class="panel"><div class="panel-head"><div><div class="panel-title">'+esc(dsLabel(CATEGORY))+' Performance — Monthly Trend<span class="n">District-wide monthly positive perception, full dataset</span></div></div></div>' +
        '<div class="chartwrap"><canvas id="ov-trend"></canvas></div></div>' +
      '<div class="panel"><div class="panel-head"><div><div class="panel-title">Top 5 vs Bottom 5 Police Stations — '+esc(dsLabel(CATEGORY))+'<span class="n">'+esc(p?p.label:'')+'</span></div></div></div>' +
        '<div class="chartwrap tall"><canvas id="ov-topbottom"></canvas></div></div>' +
      '<div class="methodbox">This overview shows the <code>'+esc(dsLabel(CATEGORY))+'</code> Excel dataset only. Switch the category button at the top to view Ganja/CAW separately; use the <b>Rankings</b>, <b>Trends</b>, <b>Period Comparison</b> and <b>Station Comparison</b> tabs for deeper drill-down within this category.</div>';

    document.getElementById('ov-typegroup').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        ovState.periodType = b.getAttribute('data-t');
        ovState.periodId = (defaultPeriod(ovState.periodType)||{}).id;
        renderOverview();
      });
    });
    document.getElementById('ov-period').addEventListener('change', function(e){
      ovState.periodId = e.target.value; renderOverview();
    });

    renderTrendChart('ov-trend', CATEGORY);
    renderTopBottomChart('ov-topbottom', ranked);
  }

  function kpi(label, value, unit, tone, sub){
    return '<div class="kpi '+(tone||'')+'"><div class="kpi-label">'+esc(label)+'</div>' +
      '<div class="kpi-value">'+esc(value)+(unit?'<span class="unit">'+esc(unit)+'</span>':'')+'</div>' +
      (sub?'<div class="kpi-sub">'+esc(sub)+'</div>':'') + '</div>';
  }
  function kpiTrend(label, delta, sub){
    var tone = delta==null?'':(delta>0?'good':(delta<0?'bad':''));
    return '<div class="kpi '+tone+'"><div class="kpi-label">'+esc(label)+'</div>' +
      '<div class="kpi-value">'+ (delta==null?'—':(delta>0?'+':'')+delta.toFixed(1)+'<span class="unit">pts</span>') +'</div>' +
      trendChip(delta) +
      (sub?'<div class="kpi-sub">'+esc(sub)+'</div>':'') + '</div>';
  }

  function renderTrendChart(canvasId, ds){
    var el = document.getElementById(canvasId); if(!el) return;
    destroyChart(canvasId);
    var monthsObj = monthsObjFor(ds);
    var labels = allKeys.filter(function(k){ return monthsObj[k]; }).map(function(k){ return Engine.monthLabelShort(k); });
    var values = allKeys.filter(function(k){ return monthsObj[k]; }).map(function(k){
      var m = Engine.aggregate(monthsObj, [k]);
      return Engine.districtWideAvg(m);
    });
    CHARTS[canvasId] = new Chart(el.getContext('2d'), {
      type:'line',
      data:{ labels: labels, datasets:[{
        label: dsShort(ds)+' district avg', data: values, borderColor: DS_COLOR[ds], backgroundColor: DS_COLOR[ds]+'22',
        fill:true, tension:.3, pointRadius:4, pointBackgroundColor: DS_COLOR[ds], borderWidth:2.5
      }]},
      options: baseLineOptions({showLabels:true})
    });
  }

  function renderTopBottomChart(canvasId, ranked){
    var el = document.getElementById(canvasId); if(!el) return;
    destroyChart(canvasId);
    if(!ranked.length){ return; }
    var top5 = ranked.slice(0,5);
    var bottom5 = ranked.slice(-5).reverse();
    var combo = top5.concat(bottom5.filter(function(b){ return top5.indexOf(b)===-1; }));
    var labels = combo.map(function(p){ return psShort(p.location); });
    var values = combo.map(function(p){ return p.positive; });
    var colors = combo.map(function(p,i){ return i<top5.length ? '#1a8a54' : '#c5372f'; });
    CHARTS[canvasId] = new Chart(el.getContext('2d'), {
      type:'bar',
      data:{ labels: labels, datasets:[{ label:'Positive %', data: values, backgroundColor: colors, borderRadius:5 }]},
      options: baseBarOptions({horizontal:true, legend:false})
    });
  }

  /* ==================================================================
     RANKINGS
     ================================================================== */
  var rkState = { periodType:'year', periodId:(defaultPeriod('year')||{}).id };

  function renderRankings(){
    var host = document.getElementById('view-rankings');
    var p = period(rkState.periodType, rkState.periodId) || defaultPeriod(rkState.periodType);
    if(p) rkState.periodId = p.id;
    var prev = p ? Engine.prevPeriod(PERIODS, rkState.periodType, p.id) : null;
    var psMap = p ? psMapForPeriod(CATEGORY, p.months) : {};
    var prevMap = prev ? psMapForPeriod(CATEGORY, prev.months) : {};
    var ranked = Engine.rankList(Object.assign({}, psMap));
    var prevRanked = Engine.rankList(Object.assign({}, prevMap));
    var prevRankByLoc = {}; prevRanked.forEach(function(p2){ prevRankByLoc[p2.location]=p2.rank; });

    host.innerHTML =
      '<div class="filterbar">' +
        '<div class="field"><label>Period Type</label><div class="pillgroup" id="rk-typegroup">' +
          ['month','quarter','half','year'].map(function(t){ return '<button data-t="'+t+'" class="'+(rkState.periodType===t?'active':'')+'">'+periodTypeLabel(t)+'</button>'; }).join('') +
        '</div></div>' +
        '<div class="field"><label>Selected Period</label><select id="rk-period">' +
          periodByType(rkState.periodType).map(function(pp){ return '<option value="'+pp.id+'" '+(pp.id===rkState.periodId?'selected':'')+'>'+pp.label+'</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="grid2">' +
        '<div class="panel"><div class="panel-head"><div><div class="panel-title">'+esc(dsLabel(CATEGORY))+' Ranking<span class="n">'+esc(p?p.label:'')+' · '+ranked.length+' stations reporting</span></div></div></div>' +
          rankTable(ranked, prevRankByLoc) +
        '</div>' +
        '<div class="panel"><div class="panel-head"><div><div class="panel-title">Ranking Chart — '+esc(dsLabel(CATEGORY))+'<span class="n">Values shown for every station</span></div></div></div>' +
          '<div class="chartwrap tall"><canvas id="rk-chart"></canvas></div></div>' +
      '</div>';

    document.getElementById('rk-typegroup').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        rkState.periodType = b.getAttribute('data-t');
        rkState.periodId = (defaultPeriod(rkState.periodType)||{}).id;
        renderRankings();
      });
    });
    document.getElementById('rk-period').addEventListener('change', function(e){ rkState.periodId = e.target.value; renderRankings(); });

    var el = document.getElementById('rk-chart');
    destroyChart('rk-chart');
    var labels = ranked.map(function(p2){ return psShort(p2.location); });
    var values = ranked.map(function(p2){ return p2.positive; });
    var h = Math.max(320, ranked.length*22);
    el.parentElement.style.height = h+'px';
    CHARTS['rk-chart'] = new Chart(el.getContext('2d'), {
      type:'bar',
      data:{ labels: labels, datasets:[{ label:'Positive %', data: values, backgroundColor: DS_COLOR[CATEGORY], borderRadius:4 }]},
      options: baseBarOptions({horizontal:true, legend:false})
    });
  }

  function rankTable(ranked, prevRankByLoc){
    if(!ranked.length) return '<div class="emptynote">No data available for this period.</div>';
    var rows = ranked.map(function(p){
      var prevRank = prevRankByLoc[p.location];
      var chg = prevRank!=null ? prevRank - p.rank : null; // positive = moved up
      var chgHtml = chg==null ? '<span class="small">—</span>' : (chg===0 ? '<span class="arrowflat">▬ 0</span>' : (chg>0 ? '<span class="arrowup">▲ '+chg+'</span>' : '<span class="arrowdown">▼ '+Math.abs(chg)+'</span>'));
      return '<tr class="'+(p.rank===1?'rank1':'')+'">' +
        '<td><span class="rankbadge '+(p.rank===1?'top':'')+'">'+p.rank+'</span></td>' +
        '<td><div class="psname">'+esc(psShort(p.location))+'</div><div class="psdistrict">'+esc(p.district)+'</div></td>' +
        '<td class="right mono">'+fmtPct(p.positive)+'</td>' +
        '<td class="right mono small">'+(p.total!=null?Math.round(p.total):'—')+'</td>' +
        '<td class="right">'+chgHtml+'</td>' +
        '</tr>';
    }).join('');
    return '<div style="max-height:520px;overflow:auto;"><table><thead><tr>' +
      '<th>Rank</th><th>Police Station</th><th class="right">Positive %</th><th class="right">Respondents</th><th class="right">Δ Rank</th>' +
      '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  /* ==================================================================
     TRENDS
     ================================================================== */
  var trState = { mode:'district', ps:[] };

  function renderTrends(){
    var host = document.getElementById('view-trends');
    var monthsObj = monthsObjFor(CATEGORY);
    var allLocs = Array.from(new Set(allKeys.reduce(function(acc,k){
      var m = monthsObj[k]; if(m) m.rows.forEach(function(r){ acc.push(r.location); }); return acc;
    }, []))).sort();

    host.innerHTML =
      '<div class="filterbar">' +
        '<div class="field"><label>Trend Mode</label><div class="pillgroup" id="tr-mode">' +
          '<button data-m="district" class="'+(trState.mode==='district'?'active':'')+'">District-wide</button>' +
          '<button data-m="ps" class="'+(trState.mode==='ps'?'active':'')+'">By Police Station</button>' +
        '</div></div>' +
      '</div>' +
      (trState.mode==='ps' ? (
        '<div class="panel" style="padding:14px 18px;">' +
        '<div class="field" style="margin-bottom:6px;"><label>Choose up to 5 Police Stations</label></div>' +
        '<div class="psmultiselect" id="tr-psselect">' +
          allLocs.map(function(loc){ return '<button class="chip '+(trState.ps.indexOf(loc)>-1?'active':'')+' '+(CATEGORY==='ganja'?'ganja':'')+'" data-loc="'+esc(loc)+'">'+esc(psShort(loc))+'</button>'; }).join('') +
        '</div><div class="helptext">Tap a station to add/remove it from the trend line. Leave empty to see all stations averaged (district-wide).</div>' +
        '</div>'
      ) : '') +
      '<div class="panel"><div class="panel-head"><div><div class="panel-title">'+esc(dsLabel(CATEGORY))+' Performance — Monthly Trend<span class="n">Month → Quarter → Half-Year → Year hierarchy available via Rankings tab period selector</span></div></div></div>' +
        '<div class="chartwrap tall"><canvas id="tr-chart"></canvas></div></div>' +
      '<div class="panel"><div class="panel-head"><div><div class="panel-title">Quarterly Summary<span class="n">Automatic quarter grouping of the monthly data</span></div></div></div>' +
        '<div class="chartwrap"><canvas id="tr-quarter"></canvas></div></div>';

    document.getElementById('tr-mode').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){ trState.mode = b.getAttribute('data-m'); renderTrends(); });
    });
    var psSelect = document.getElementById('tr-psselect');
    if(psSelect){
      psSelect.querySelectorAll('button').forEach(function(b){
        b.addEventListener('click', function(){
          var loc = b.getAttribute('data-loc');
          var idx = trState.ps.indexOf(loc);
          if(idx>-1) trState.ps.splice(idx,1);
          else { if(trState.ps.length>=5){ toast('You can compare up to 5 police stations at once.'); return; } trState.ps.push(loc); }
          renderTrends();
        });
      });
    }

    renderTrendsChart();
    renderQuarterChart();
  }

  function renderTrendsChart(){
    var el = document.getElementById('tr-chart'); if(!el) return;
    destroyChart('tr-chart');
    var monthsObj = monthsObjFor(CATEGORY);
    var presentKeys = allKeys.filter(function(k){ return monthsObj[k]; });
    var labels = presentKeys.map(function(k){ return Engine.monthLabelShort(k); });
    var datasets = [];
    if(trState.mode==='district' || trState.ps.length===0){
      var vals = presentKeys.map(function(k){ return Engine.districtWideAvg(Engine.aggregate(monthsObj,[k])); });
      datasets.push({ label: dsShort(CATEGORY)+' district avg', data: vals, borderColor: DS_COLOR[CATEGORY], backgroundColor: DS_COLOR[CATEGORY]+'22', fill:true, tension:.3, pointRadius:3, borderWidth:2.5 });
    } else {
      trState.ps.forEach(function(loc, i){
        var vals = presentKeys.map(function(k){
          var m = Engine.aggregate(monthsObj, [k]);
          return m[loc] ? m[loc].positive : null;
        });
        datasets.push({ label: psShort(loc), data: vals, borderColor: PALETTE[i%PALETTE.length], backgroundColor: PALETTE[i%PALETTE.length]+'18', fill:false, tension:.3, pointRadius:3, borderWidth:2.5 });
      });
    }
    CHARTS['tr-chart'] = new Chart(el.getContext('2d'), {
      type:'line', data:{ labels: labels, datasets: datasets },
      options: baseLineOptions({ showLabels: datasets.length===1 })
    });
  }

  function renderQuarterChart(){
    var el = document.getElementById('tr-quarter'); if(!el) return;
    destroyChart('tr-quarter');
    var monthsObj = monthsObjFor(CATEGORY);
    var quarters = periodByType('quarter');
    var labels = quarters.map(function(q){ return q.shortLabel; });
    var values = quarters.map(function(q){ return Engine.districtWideAvg(Engine.aggregate(monthsObj, q.months)); });
    CHARTS['tr-quarter'] = new Chart(el.getContext('2d'), {
      type:'bar',
      data:{ labels: labels, datasets:[{ label:'District avg', data: values, backgroundColor: DS_COLOR[CATEGORY], borderRadius:6 }]},
      options: baseBarOptions({ legend:false })
    });
  }

  /* ==================================================================
     PERIOD COMPARISON
     ================================================================== */
  var cpState = { typeA:'quarter', idA:null, typeB:'quarter', idB:null };
  (function initCP(){
    var qs = periodByType('quarter');
    if(qs.length>=2){ cpState.idA = qs[qs.length-2].id; cpState.idB = qs[qs.length-1].id; }
    else if(qs.length===1){ cpState.idA = qs[0].id; cpState.idB = qs[0].id; }
  })();

  function periodSelectorField(label, idSelectType, idSelectPeriod, curType, curId){
    var types = ['month','quarter','half','year'];
    return '<div class="field"><label>'+esc(label)+' — Type</label><select id="'+idSelectType+'">' +
      types.map(function(t){ return '<option value="'+t+'" '+(t===curType?'selected':'')+'>'+periodTypeLabel(t)+'</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>'+esc(label)+' — Period</label><select id="'+idSelectPeriod+'">' +
      periodByType(curType).map(function(p){ return '<option value="'+p.id+'" '+(p.id===curId?'selected':'')+'>'+p.label+'</option>'; }).join('') +
      '</select></div>';
  }

  function renderComparePeriods(){
    var host = document.getElementById('view-compare-periods');
    var pA = period(cpState.typeA, cpState.idA) || defaultPeriod(cpState.typeA);
    var pB = period(cpState.typeB, cpState.idB) || defaultPeriod(cpState.typeB);
    if(pA) cpState.idA = pA.id; if(pB) cpState.idB = pB.id;

    var mapA = pA ? psMapForPeriod(CATEGORY, pA.months) : {};
    var mapB = pB ? psMapForPeriod(CATEGORY, pB.months) : {};
    var avgA = Engine.districtWideAvg(mapA), avgB = Engine.districtWideAvg(mapB);
    var diff = (avgA!=null && avgB!=null) ? Math.round((avgB-avgA)*100)/100 : null;
    var pctCh = Engine.pctChange(avgA, avgB);

    var rankedA = Engine.rankList(Object.assign({}, mapA));
    var rankedB = Engine.rankList(Object.assign({}, mapB));
    var rankAByLoc = {}; rankedA.forEach(function(p){ rankAByLoc[p.location]=p.rank; });
    var rankBByLoc = {}; rankedB.forEach(function(p){ rankBByLoc[p.location]=p.rank; });

    var allLocs = Array.from(new Set(Object.keys(mapA).concat(Object.keys(mapB)))).sort(function(a,b){
      var va = mapB[b] ? mapB[b].positive : -1, vb = mapA[b] ? 0:0; return 0;
    });
    var rows = Array.from(new Set(Object.keys(mapA).concat(Object.keys(mapB)))).map(function(loc){
      var a = mapA[loc]?mapA[loc].positive:null, b = mapB[loc]?mapB[loc].positive:null;
      var d = (a!=null&&b!=null)?Math.round((b-a)*100)/100:null;
      var pc = Engine.pctChange(a,b);
      return { loc:loc, a:a, b:b, d:d, pc:pc, rankA:rankAByLoc[loc], rankB:rankBByLoc[loc] };
    }).sort(function(x,y){ var dx=x.d==null?-999:x.d, dy=y.d==null?-999:y.d; return dy-dx; });

    host.innerHTML =
      '<div class="filterbar">' +
        periodSelectorField('Period A','cp-typeA','cp-idA',cpState.typeA,cpState.idA) +
        periodSelectorField('Period B','cp-typeB','cp-idB',cpState.typeB,cpState.idB) +
      '</div>' +
      '<div class="panel"><div class="panel-head"><div><div class="panel-title">'+esc(dsLabel(CATEGORY))+' Performance — '+esc(pA?pA.label:'—')+' vs '+esc(pB?pB.label:'—')+'<span class="n">District-wide comparison</span></div></div></div>' +
        '<div class="compare-cols">' +
          diffcard('Period A', pA?pA.label:'—', fmtPct(avgA)) +
          '<div class="compare-vs">VS</div>' +
          diffcard('Period B', pB?pB.label:'—', fmtPct(avgB)) +
        '</div>' +
        '<div class="grid3" style="margin-top:16px;">' +
          diffcardSimple('Absolute Difference', fmtDiff(diff), diff>0?'good':diff<0?'bad':'') +
          diffcardSimple('Percentage Change', fmtPctChange(pctCh), pctCh>0?'good':pctCh<0?'bad':'') +
          diffcardSimple('Trend', diff==null?'—':(diff>0?'Improvement':diff<0?'Decline':'No Change'), diff>0?'good':diff<0?'bad':'') +
        '</div></div>' +
      '<div class="grid2">' +
        '<div class="panel"><div class="panel-head"><div><div class="panel-title">Police Station-wise Comparison<span class="n">Sorted by biggest improvement</span></div></div></div>' +
          comparisonTable(rows) +
        '</div>' +
        '<div class="panel"><div class="panel-head"><div><div class="panel-title">Top Movers — '+esc(pA?pA.shortLabel:'')+' → '+esc(pB?pB.shortLabel:'')+'<span class="n">Largest point change, either direction</span></div></div></div>' +
          '<div class="chartwrap tall"><canvas id="cp-movers"></canvas></div></div>' +
      '</div>';

    document.getElementById('cp-typeA').addEventListener('change', function(e){ cpState.typeA = e.target.value; cpState.idA = (defaultPeriod(cpState.typeA)||{}).id; renderComparePeriods(); });
    document.getElementById('cp-idA').addEventListener('change', function(e){ cpState.idA = e.target.value; renderComparePeriods(); });
    document.getElementById('cp-typeB').addEventListener('change', function(e){ cpState.typeB = e.target.value; cpState.idB = (defaultPeriod(cpState.typeB)||{}).id; renderComparePeriods(); });
    document.getElementById('cp-idB').addEventListener('change', function(e){ cpState.idB = e.target.value; renderComparePeriods(); });

    // movers chart: top 8 by |diff|
    var movers = rows.filter(function(r){ return r.d!=null; }).sort(function(x,y){ return Math.abs(y.d)-Math.abs(x.d); }).slice(0,8);
    destroyChart('cp-movers');
    var elm = document.getElementById('cp-movers');
    if(movers.length){
      CHARTS['cp-movers'] = new Chart(elm.getContext('2d'), {
        type:'bar',
        data:{ labels: movers.map(function(m){ return psShort(m.loc); }), datasets:[{
          label:'Δ pts', data: movers.map(function(m){ return m.d; }),
          backgroundColor: movers.map(function(m){ return m.d>=0?'#1a8a54':'#c5372f'; }), borderRadius:5
        }]},
        options: {
          indexAxis:'y', responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{display:false}, datalabels:{ color:'#0f1b2d', font:{weight:'700',size:10.5}, anchor:'end', align:function(ctx){ return ctx.dataset.data[ctx.dataIndex]>=0?'right':'left'; }, formatter:function(v){ return (v>0?'+':'')+v.toFixed(1); } } },
          scales:{ x:{ grid:{color:'#e1e6ee'} }, y:{ grid:{display:false} } }
        }
      });
    }
  }

  function diffcard(label, period, val){
    return '<div class="diffcard"><div class="lbl">'+esc(label)+'</div><div class="val">'+esc(val)+'</div><div class="small">'+esc(period)+'</div></div>';
  }
  function diffcardSimple(label, val, tone){
    return '<div class="diffcard '+ (tone==='good'?'':'') +'"><div class="lbl">'+esc(label)+'</div><div class="val" style="color:'+(tone==='good'?'var(--good-600)':tone==='bad'?'var(--bad-600)':'var(--ink-900)')+'">'+esc(val)+'</div></div>';
  }

  function comparisonTable(rows){
    if(!rows.length) return '<div class="emptynote">No overlapping data for these periods.</div>';
    var trs = rows.map(function(r){
      var rc = (r.rankA!=null && r.rankB!=null) ? r.rankA-r.rankB : null;
      return '<tr>' +
        '<td><div class="psname">'+esc(psShort(r.loc))+'</div></td>' +
        '<td class="right mono">'+fmtPct(r.a)+'</td>' +
        '<td class="right mono">'+fmtPct(r.b)+'</td>' +
        '<td class="right mono">'+(r.d==null?'—':(r.d>0?'<span class="arrowup">▲</span>':r.d<0?'<span class="arrowdown">▼</span>':'<span class="arrowflat">▬</span>')+' '+fmtDiff(r.d))+'</td>' +
        '<td class="right small">'+(rc==null?'—':(rc>0?'▲'+rc:rc<0?'▼'+Math.abs(rc):'▬0'))+'</td>' +
        '</tr>';
    }).join('');
    return '<div style="max-height:480px;overflow:auto;"><table><thead><tr><th>Police Station</th><th class="right">Period A</th><th class="right">Period B</th><th class="right">Difference</th><th class="right">Rank Δ</th></tr></thead><tbody>'+trs+'</tbody></table></div>';
  }

  /* ==================================================================
     POLICE STATION COMPARISON
     ================================================================== */
  var psState = { periodType:'year', periodId:(defaultPeriod('year')||{}).id, selected:[] };

  function renderComparePS(){
    var host = document.getElementById('view-compare-ps');
    var p = period(psState.periodType, psState.periodId) || defaultPeriod(psState.periodType);
    if(p) psState.periodId = p.id;
    var psMap = p ? psMapForPeriod(CATEGORY, p.months) : {};
    var allLocs = Object.keys(psMap).sort();
    if(psState.selected.length===0 && allLocs.length>=3){
      var ranked = Engine.rankList(Object.assign({}, psMap));
      psState.selected = [ranked[0], ranked[Math.floor(ranked.length/2)], ranked[ranked.length-1]].filter(Boolean).map(function(p2){ return p2.location; });
    }

    host.innerHTML =
      '<div class="filterbar">' +
        '<div class="field"><label>Period Type</label><div class="pillgroup" id="ps-typegroup">' +
          ['month','quarter','half','year'].map(function(t){ return '<button data-t="'+t+'" class="'+(psState.periodType===t?'active':'')+'">'+periodTypeLabel(t)+'</button>'; }).join('') +
        '</div></div>' +
        '<div class="field"><label>Selected Period</label><select id="ps-period">' +
          periodByType(psState.periodType).map(function(pp){ return '<option value="'+pp.id+'" '+(pp.id===psState.periodId?'selected':'')+'>'+pp.label+'</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="panel" style="padding:14px 18px;">' +
        '<div class="field" style="margin-bottom:6px;"><label>Choose 2 or more Police Stations</label></div>' +
        '<div class="psmultiselect" id="ps-select">' +
          allLocs.map(function(loc){ return '<button class="chip '+(psState.selected.indexOf(loc)>-1?'active':'')+' '+(CATEGORY==='ganja'?'ganja':'')+'" data-loc="'+esc(loc)+'">'+esc(psShort(loc))+'</button>'; }).join('') +
        '</div></div>' +
      '<div class="grid2">' +
        '<div class="panel"><div class="panel-head"><div><div class="panel-title">Station Comparison Table<span class="n">'+esc(p?p.label:'')+' · '+esc(dsLabel(CATEGORY))+'</span></div></div></div>' +
          psCompareTable(psMap, psState.selected) +
        '</div>' +
        '<div class="panel"><div class="panel-head"><div><div class="panel-title">Comparison Chart<span class="n">'+esc(dsLabel(CATEGORY))+' — '+esc(p?p.label:'')+'</span></div></div></div>' +
          '<div class="chartwrap"><canvas id="ps-chart"></canvas></div></div>' +
      '</div>' +
      '<div class="panel"><div class="panel-head"><div><div class="panel-title">Selected Stations — Monthly Trend<span class="n">How each selected station has moved across the full dataset</span></div></div></div>' +
        '<div class="chartwrap tall"><canvas id="ps-trend"></canvas></div></div>';

    document.getElementById('ps-typegroup').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        psState.periodType = b.getAttribute('data-t'); psState.periodId = (defaultPeriod(psState.periodType)||{}).id; renderComparePS();
      });
    });
    document.getElementById('ps-period').addEventListener('change', function(e){ psState.periodId = e.target.value; renderComparePS(); });
    document.getElementById('ps-select').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        var loc = b.getAttribute('data-loc');
        var idx = psState.selected.indexOf(loc);
        if(idx>-1) psState.selected.splice(idx,1);
        else { if(psState.selected.length>=8){ toast('You can compare up to 8 police stations at once.'); return; } psState.selected.push(loc); }
        renderComparePS();
      });
    });

    // bar chart
    destroyChart('ps-chart');
    var elc = document.getElementById('ps-chart');
    var sel = psState.selected.filter(function(l){ return psMap[l]; });
    if(sel.length){
      CHARTS['ps-chart'] = new Chart(elc.getContext('2d'), {
        type:'bar',
        data:{ labels: sel.map(function(l){ return psShort(l); }), datasets:[{ label:'Positive %', data: sel.map(function(l){ return psMap[l].positive; }), backgroundColor: sel.map(function(_,i){ return PALETTE[i%PALETTE.length]; }), borderRadius:6 }]},
        options: baseBarOptions({ legend:false })
      });
    }

    // trend chart
    destroyChart('ps-trend');
    var elt = document.getElementById('ps-trend');
    if(sel.length){
      var monthsObj = monthsObjFor(CATEGORY);
      var presentKeys = allKeys.filter(function(k){ return monthsObj[k]; });
      var labels = presentKeys.map(function(k){ return Engine.monthLabelShort(k); });
      var datasets = sel.map(function(loc, i){
        var vals = presentKeys.map(function(k){
          var m = Engine.aggregate(monthsObj, [k]);
          return m[loc] ? m[loc].positive : null;
        });
        return { label: psShort(loc), data: vals, borderColor: PALETTE[i%PALETTE.length], backgroundColor: PALETTE[i%PALETTE.length]+'18', fill:false, tension:.3, pointRadius:3, borderWidth:2.5 };
      });
      CHARTS['ps-trend'] = new Chart(elt.getContext('2d'), {
        type:'line', data:{ labels: labels, datasets: datasets }, options: baseLineOptions({showLabels:false})
      });
    }
  }

  function psCompareTable(psMap, selected){
    var sel = selected.filter(function(l){ return psMap[l]; });
    if(sel.length<1) return '<div class="emptynote">Select at least two police stations above to compare.</div>';
    var ranked = Engine.rankList(Object.assign({}, psMap));
    var rankByLoc = {}; ranked.forEach(function(p){ rankByLoc[p.location]=p.rank; });
    var rows = sel.map(function(loc){
      var v = psMap[loc];
      return '<tr><td><div class="psname">'+esc(psShort(loc))+'</div><div class="psdistrict">'+esc(v.district)+'</div></td>' +
        '<td class="right mono">'+fmtPct(v.positive)+'</td>' +
        '<td class="right mono small">'+(v.total!=null?Math.round(v.total):'—')+'</td>' +
        '<td class="right"><span class="rankbadge '+(rankByLoc[loc]===1?'top':'')+'">'+rankByLoc[loc]+'</span></td></tr>';
    }).join('');
    return '<table><thead><tr><th>Police Station</th><th class="right">Positive %</th><th class="right">Respondents</th><th class="right">Rank</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }

  /* ---------------- boot ---------------- */
  renderOverview();
})();
