const PATHS = {
  AIQ: {label:"All India Quota", allotment:"data/allotment/aiq.csv", cutoff:"data/cutoff/aiq.csv", movement:"data/movement/aiq.csv"},
  BIHAR: {label:"Bihar PGMAC", allotment:"data/allotment/bihar.csv", cutoff:"data/cutoff/bihar.csv", movement:"data/movement/bihar.csv"},
  UP: {label:"Uttar Pradesh", allotment:"data/allotment/up.csv", cutoff:"data/cutoff/up.csv", movement:"data/movement/up.csv"},
  MP: {label:"Madhya Pradesh", allotment:"data/allotment/mp.csv", cutoff:"data/cutoff/mp.csv", movement:"data/movement/mp.csv"},
  RAJASTHAN: {label:"Rajasthan", allotment:"data/allotment/rajasthan.csv", cutoff:"data/cutoff/rajasthan.csv", movement:"data/movement/rajasthan.csv"},
  JHARKHAND: {label:"Jharkhand", allotment:"data/allotment/jharkhand.csv", cutoff:"data/cutoff/jharkhand.csv", movement:"data/movement/jharkhand.csv"}
};

const state = { counselling:"AIQ", round:"R1", allotments:[], cutoffs:[], movement:[], loaded:false };

function parseCSV(text){
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"'){
      if(quoted && n==='"'){cell+='"'; i++} else quoted=!quoted;
    } else if(c===',' && !quoted){row.push(cell);cell=""}
    else if((c==='\n'||c==='\r') && !quoted){
      if(c==='\r'&&n==='\n')i++;
      row.push(cell);cell="";
      if(row.some(x=>x!=="")) rows.push(row);
      row=[];
    } else cell+=c;
  }
  if(cell!==""||row.length){row.push(cell);rows.push(row)}
  if(!rows.length)return [];
  const headers=rows[0].map(x=>x.trim());
  return rows.slice(1).map(r=>{
    const o={}; headers.forEach((h,i)=>o[h]=(r[i]??"").trim()); return o;
  });
}

async function loadCSV(url){
  const res=await fetch(url,{cache:"no-store"});
  if(!res.ok) throw new Error(`${res.status} ${url}`);
  return parseCSV(await res.text());
}

function fmt(n){ return Number(n||0).toLocaleString("en-IN"); }
function norm(s){ return String(s||"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim(); }
function roundLabel(r){ return r==="STRAY"?"Stray Round":`Round ${String(r).replace("R","")}`; }
function selectedRounds(rows){
  return [...new Set(rows.map(x=>x.round).filter(Boolean))].sort((a,b)=>{
    const order={R1:1,R2:2,R3:3,STRAY:4}; return (order[a]||9)-(order[b]||9);
  });
}

function setRoundOptions(rows){
  const sel=document.getElementById("round");
  const rounds=selectedRounds(rows);
  sel.innerHTML=rounds.map(r=>`<option value="${r}">${roundLabel(r)}</option>`).join("");
  if(rounds.includes(state.round)) sel.value=state.round; else {state.round=rounds[0]||"R1";sel.value=state.round;}
}

async function loadDataset(){
  const p=PATHS[state.counselling];
  state.loaded=false;
  document.getElementById("rankDataStatus").textContent="Loading…";
  document.getElementById("exploreStatus").textContent="Loading…";
  try{
    const [a,c,m]=await Promise.all([loadCSV(p.allotment),loadCSV(p.cutoff),loadCSV(p.movement)]);
    state.allotments=a; state.cutoffs=c; state.movement=m; state.loaded=true;
    setRoundOptions(a);
    populateRankFilters();
    document.getElementById("rankDataStatus").textContent=`${fmt(a.length)} allotments`;
    document.getElementById("exploreStatus").textContent=`${p.label} · ${roundLabel(state.round)}`;
    document.getElementById("rankEmpty").hidden=false;
    document.getElementById("rankResults").hidden=true;
    clearExplore();
  }catch(e){
    console.error(e);
    document.getElementById("rankDataStatus").textContent="Data load error";
    document.getElementById("exploreStatus").textContent="Check data path";
  }
}

function currentAllotments(){
  return state.allotments.filter(x=>x.round===state.round);
}
function currentCutoffs(){
  return state.cutoffs.filter(x=>x.round===state.round);
}

function cleanCategory(v){
  const s=norm(v);
  if(!s || s==="-" || /^-+$/.test(s)) return "";
  if(/EWS/.test(s)) return "EWS";
  if(/(^|\s)(OBC|BC|BCOP|BCPH)(\s|$)/.test(s)) return "OBC";
  if(/(^|\s)(SC|SCOP|SCPH)(\s|$)/.test(s)) return "SC";
  if(/(^|\s)(ST|STOP)(\s|$)/.test(s)) return "ST";
  if(/(^|\s)(UR|UROP|URPH|GENERAL|GEN)(\s|$)/.test(s)) return "GENERAL";
  if(/NRI/.test(s)) return "NRI";
  return s;
}

function populateRankFilters(){
  const rows=currentAllotments();
  const stateSel=document.getElementById("rankState");
  const catSel=document.getElementById("rankCategory");
  const states=[...new Set(rows.map(x=>String(x.state||"").trim()).filter(Boolean))].sort();
  const cats=[...new Set(rows.map(x=>cleanCategory(x.category)).filter(Boolean))].sort();
  stateSel.innerHTML='<option value="">All states</option>'+states.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  catSel.innerHTML='<option value="">All categories</option>'+cats.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  // AIQ source currently carries "All India" rather than the college's state;
  // keep the filter honest rather than inventing a college-state mapping.
  if(state.counselling==="AIQ" && states.length===1 && states[0]==="All India"){
    stateSel.title="AIQ source currently records counselling as All India; college-state mapping will be added in the next data-quality pass.";
  }
}

function runRank(){
  const air=Number(document.getElementById("myRank").value);
  if(!air || air<1){document.getElementById("myRank").focus();return}
  const course=norm(document.getElementById("rankCourse").value);
  const college=norm(document.getElementById("rankCollege").value);
  const wantedState=document.getElementById("rankState").value;
  const wantedCategory=document.getElementById("rankCategory").value;

  // Build the selected-round closing range directly from the round's final
  // allotments so category/state filters apply to the same round only.
  let base=currentAllotments().filter(x=>Number(x.rank_value)>0);
  if(wantedState) base=base.filter(x=>String(x.state||"").trim()===wantedState);
  if(wantedCategory) base=base.filter(x=>cleanCategory(x.category)===wantedCategory);
  if(course) base=base.filter(x=>norm(x.course).includes(course));
  if(college) base=base.filter(x=>norm(x.college).includes(college));

  const groups=new Map();
  for(const x of base){
    const key=`${x.college}|${x.course}|${wantedCategory||cleanCategory(x.category)}`;
    const rank=Number(x.rank_value);
    if(!groups.has(key)) groups.set(key,{college:x.college,course:x.course,closing_rank:rank,allotment_count:1});
    else {
      const g=groups.get(key);
      g.closing_rank=Math.max(g.closing_rank,rank);
      g.allotment_count++;
    }
  }
  let rows=[...groups.values()].filter(x=>x.closing_rank>=air);
  rows.sort((a,b)=>a.closing_rank-b.closing_rank);
  rows=rows.slice(0,60);

  document.getElementById("rankEmpty").hidden=true;
  document.getElementById("rankResults").hidden=false;
  const filters=[wantedState,wantedCategory].filter(Boolean);
  document.getElementById("rankResultTitle").textContent=`AIR ${fmt(air)} · ${PATHS[state.counselling].label} · ${roundLabel(state.round)}${filters.length?" · "+filters.join(" · "):""}`;
  document.getElementById("rankResultCount").textContent=`${fmt(rows.length)} historical matches`;
  const grid=document.getElementById("rankGrid");
  if(!rows.length){
    grid.innerHTML=`<div class="rank-item"><h4>No matching historical range found</h4><p>Try removing a filter, choosing another category, or selecting another round.</p></div>`;
    return;
  }
  grid.innerHTML=rows.map(x=>{
    const close=Number(x.closing_rank), buffer=close-air;
    return `<article class="rank-item">
      <span class="tag">HISTORICALLY REACHABLE</span>
      <h4>${esc(x.course||"Course not available")}</h4>
      <p>${esc(x.college||"Institute not available")}</p>
      <div class="rank-metrics">
        <div class="metric"><small>Your AIR</small><strong>${fmt(air)}</strong></div>
        <div class="metric"><small>Observed closing AIR</small><strong>${fmt(close)}</strong></div>
        <div class="metric"><small>Historical buffer</small><strong class="buffer">+${fmt(buffer)}</strong></div>
        <div class="metric"><small>Allotments</small><strong>${fmt(x.allotment_count)}</strong></div>
      </div>
    </article>`;
  }).join("");
}

function runExplore(){
  const college=norm(document.getElementById("searchCollege").value);
  const course=norm(document.getElementById("searchCourse").value);
  const maxAir=Number(document.getElementById("searchMaxAir").value)||Infinity;
  let rows=currentAllotments().filter(x=>Number(x.rank_value)<=maxAir);
  if(college) rows=rows.filter(x=>norm(x.college).includes(college));
  if(course) rows=rows.filter(x=>norm(x.course).includes(course));
  rows.sort((a,b)=>Number(a.rank_value)-Number(b.rank_value));
  rows=rows.slice(0,250);
  document.getElementById("exploreMeta").textContent=`${fmt(rows.length)} records shown · max 250`;
  document.getElementById("exploreBody").innerHTML=rows.length?rows.map(x=>`<tr>
    <td>${fmt(x.rank_value)}</td><td>${esc(x.college)}</td><td>${esc(x.course)}</td>
    <td>${esc(x.category)}</td><td>${esc(x.quota)}</td><td>${esc(x.seat_type)}</td>
  </tr>`).join(""):`<tr><td colspan="6">No records found for the selected filters.</td></tr>`;
}
function clearExplore(){
  document.getElementById("exploreMeta").textContent="Search to view records";
  document.getElementById("exploreBody").innerHTML=`<tr><td colspan="6">Enter a college, specialty or AIR limit and search.</td></tr>`;
}

function runMovement(){
  const college=norm(document.getElementById("moveCollege").value);
  const course=norm(document.getElementById("moveCourse").value);
  let rows=state.movement.filter(x=>(!college||norm(x.college).includes(college))&&(!course||norm(x.course).includes(course)));
  if(!rows.length){
    document.getElementById("movementResults").hidden=true;
    document.getElementById("movementEmpty").textContent="No matching historical movement found. Try a broader college or course name.";
    return;
  }
  const x=rows[0];
  document.getElementById("movementEmpty").hidden=true;
  document.getElementById("movementResults").hidden=false;
  document.getElementById("movementTitle").textContent=`${x.college} · ${x.course}`;
  const rounds=[["R1","Round 1"],["R2","Round 2"],["R3","Round 3"],["STRAY","Stray"]];
  document.getElementById("movementRow").innerHTML=rounds.map(([r,label])=>{
    const o=x[`opening_rank_${r}`], c=x[`closing_rank_${r}`];
    return `<div class="move-box"><small>${label}</small><strong>${o&&c?`${fmt(o)} – ${fmt(c)}`:"—"}</strong><span>${x[`allotment_count_${r}`]?fmt(x[`allotment_count_${r}`])+" allotments":"No observed data"}</span></div>`;
  }).join("");
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

document.getElementById("counselling").addEventListener("change",async e=>{
  state.counselling=e.target.value; state.round="R1"; await loadDataset();
});
document.getElementById("round").addEventListener("change",e=>{
  state.round=e.target.value;
  populateRankFilters();
  document.getElementById("exploreStatus").textContent=`${PATHS[state.counselling].label} · ${roundLabel(state.round)}`;
  clearExplore();
});
document.getElementById("rankSearch").addEventListener("click",runRank);
document.getElementById("exploreSearch").addEventListener("click",runExplore);
document.getElementById("moveSearch").addEventListener("click",runMovement);
document.querySelectorAll(".chips button").forEach(b=>b.addEventListener("click",()=>{
  document.getElementById("searchCourse").value=b.dataset.course; runExplore();
}));
document.getElementById("myRank").addEventListener("keydown",e=>{if(e.key==="Enter")runRank()});
document.getElementById("rankCourse").addEventListener("keydown",e=>{if(e.key==="Enter")runRank()});
document.getElementById("rankCollege").addEventListener("keydown",e=>{if(e.key==="Enter")runRank()});

loadDataset();
