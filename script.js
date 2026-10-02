const PATHS = {
  AIQ: {label:"All India Quota", allotment:"data/allotment/aiq.csv", cutoff:"data/cutoff/aiq.csv", movement:"data/movement/aiq.csv"},
  BIHAR: {label:"Bihar PGMAC", allotment:"data/allotment/bihar.csv", cutoff:"data/cutoff/bihar.csv", movement:"data/movement/bihar.csv"},
  UP: {label:"Uttar Pradesh", allotment:"data/allotment/up.csv", cutoff:"data/cutoff/up.csv", movement:"data/movement/up.csv"},
  MP: {label:"Madhya Pradesh", allotment:"data/allotment/mp.csv", cutoff:"data/cutoff/mp.csv", movement:"data/movement/mp.csv"},
  RAJASTHAN: {label:"Rajasthan", allotment:"data/allotment/rajasthan.csv", cutoff:"data/cutoff/rajasthan.csv", movement:"data/movement/rajasthan.csv"},
  JHARKHAND: {label:"Jharkhand", allotment:"data/allotment/jharkhand.csv", cutoff:"data/cutoff/jharkhand.csv", movement:"data/movement/jharkhand.csv"}
};

const state = { counselling:"AIQ", round:"R1", allotments:[], cutoffs:[], movement:[], loaded:false };

const CATEGORY_OPTIONS = [
  ["ALL","All categories"], ["GENERAL","General / UR"], ["OBC","OBC"],
  ["SC","SC"], ["ST","ST"], ["EWS","EWS"], ["NRI","NRI"]
];

// IMPORTANT: Bihar PGMAC has EBC as a distinct reservation category.
// Do not map EBC to OBC or EWS. The source allotment row must retain
// its actual category for filtering.
function cleanCategory(value){
  const s = norm(value);
  if(!s) return "";
  if(s === "GENERAL" || s === "GEN" || s === "UR" || s.startsWith("UR ") || s.startsWith("UROP") || s.startsWith("URPH")) return "GENERAL";
  if(s === "EBC" || s.startsWith("EBC ")) return "EBC";
  if(s === "OBC" || s === "BC" || s.startsWith("BCOP") || s.startsWith("BCPH")) return "OBC";
  if(s === "SC" || s.startsWith("SCOP") || s.startsWith("SCPH")) return "SC";
  if(s === "ST" || s.startsWith("STOP")) return "ST";
  if(s === "EWS" || s.startsWith("EWOP") || s.startsWith("EWPH")) return "EWS";
  if(s === "NRI" || s.includes(" NRI ") || s.endsWith(" NRI")) return "NRI";
  return "";
}

function setCategoryOptions(){
  const sel=document.getElementById("rankCategory");
  if(!sel) return;
  const isBihar = state.counselling === "BIHAR";
  const options = isBihar
    ? [["ALL","All categories"],["GENERAL","General / UR"],["OBC","OBC / BC"],["EBC","EBC (Bihar)"],["SC","SC"],["ST","ST"],["EWS","EWS"],["NRI","NRI"]]
    : CATEGORY_OPTIONS;
  const previous = sel.value;
  sel.innerHTML = options.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join("");
  sel.value = options.some(([v])=>v===previous) ? previous : "ALL";
}

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
    // Allotment is the core source for My Rank. Cutoff/movement are optional so
    // one missing auxiliary CSV cannot break the whole GitHub Pages app.
    const a = await loadCSV(p.allotment);
    const [cRes,mRes] = await Promise.allSettled([loadCSV(p.cutoff),loadCSV(p.movement)]);
    const c = cRes.status === "fulfilled" ? cRes.value : [];
    const m = mRes.status === "fulfilled" ? mRes.value : [];
    state.allotments=a; state.cutoffs=c; state.movement=m; state.loaded=true;
    setRoundOptions(a);
    populateRankStateOptions();
    setCategoryOptions();
    document.getElementById("rankDataStatus").textContent=`${fmt(a.length)} allotments`;
    document.getElementById("exploreStatus").textContent=`${p.label} · ${roundLabel(state.round)}`;
    document.getElementById("rankEmpty").hidden=false;
    document.getElementById("rankResults").hidden=true;
    clearExplore();
  }catch(e){
    console.error(e);
    document.getElementById("rankDataStatus").textContent="Data load error";
    document.getElementById("exploreStatus").textContent=`Could not load ${p.allotment}`;
  }
}

const COLLEGE_STATES = [
  "Andaman & Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu & Kashmir","Jharkhand","Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Puducherry","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"
];

// AIQ allotment rows carry "All India" in the source-state field. For the
// candidate-facing State filter we derive the physical college state from
// explicit state names present in the extracted institute text. For state
// counselling files, the counselling state is used as the college-state
// fallback because those files are state-specific.
function deriveCollegeState(x){
  const sourceState=String(x.state||"").trim();
  if(state.counselling!=="AIQ" && sourceState && sourceState!=="All India") return sourceState;
  const t=norm(x.college||"");
  const aliases=[
    ["ANDAMAN AND NICOBAR ISLANDS","Andaman & Nicobar Islands"],["ANDHRA PRADESH","Andhra Pradesh"],["ARUNACHAL PRADESH","Arunachal Pradesh"],["ASSAM","Assam"],["BIHAR","Bihar"],["CHANDIGARH","Chandigarh"],["CHHATTISGARH","Chhattisgarh"],["DELHI","Delhi"],["NEW DELHI","Delhi"],["GOA","Goa"],["GUJARAT","Gujarat"],["HARYANA","Haryana"],["HIMACHAL PRADESH","Himachal Pradesh"],["JAMMU AND KASHMIR","Jammu & Kashmir"],["JAMMU KASHMIR","Jammu & Kashmir"],["JHARKHAND","Jharkhand"],["KARNATAKA","Karnataka"],["KERALA","Kerala"],["LADAKH","Ladakh"],["LAKSHADWEEP","Lakshadweep"],["MADHYA PRADESH","Madhya Pradesh"],["MAHARASHTRA","Maharashtra"],["MANIPUR","Manipur"],["MEGHALAYA","Meghalaya"],["MIZORAM","Mizoram"],["NAGALAND","Nagaland"],["ODISHA","Odisha"],["ORISSA","Odisha"],["PUDUCHERRY","Puducherry"],["PONDICHERRY","Puducherry"],["PUNJAB","Punjab"],["RAJASTHAN","Rajasthan"],["SIKKIM","Sikkim"],["TAMIL NADU","Tamil Nadu"],["TELANGANA","Telangana"],["TRIPURA","Tripura"],["UTTAR PRADESH","Uttar Pradesh"],["UTTARAKHAND","Uttarakhand"],["WEST BENGAL","West Bengal"]
  ];
  for(const [needle,label] of aliases){ if(t.includes(needle)) return label; }
  return "";
}

function populateRankStateOptions(){
  const sel=document.getElementById("rankState");
  sel.innerHTML=`<option value="ALL">All college states</option>` + COLLEGE_STATES.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if(!sel.value) sel.value="ALL";
}

function rankFilteredAllotments(){
  const selectedState=document.getElementById("rankState").value;
  const selectedCategory=document.getElementById("rankCategory").value;
  let rows=currentAllotments();
  if(selectedState && selectedState!=="ALL") rows=rows.filter(x=>deriveCollegeState(x)===selectedState);
  if(selectedCategory && selectedCategory!=="ALL") rows=rows.filter(x=>cleanCategory(x.category)===selectedCategory);
  return rows.filter(x=>Number(x.rank_value)>0 && x.college && x.course);
}

function currentAllotments(){
  return state.allotments.filter(x=>x.round===state.round);
}
function currentCutoffs(){
  return state.cutoffs.filter(x=>x.round===state.round);
}

function runRank(){
  if(!state.loaded){return;}
  const air=Number(document.getElementById("myRank").value);
  if(!air || air<1){document.getElementById("myRank").focus();return}
  const course=norm(document.getElementById("rankCourse").value);
  const college=norm(document.getElementById("rankCollege").value);
  const category=document.getElementById("rankCategory").value;
  let source=rankFilteredAllotments();
  if(course) source=source.filter(x=>norm(x.course).includes(course));
  if(college) source=source.filter(x=>norm(x.college).includes(college));

  // Derive observed closing AIR from the selected round's actual allotments.
  // This keeps category/state filters tied to the same round instead of mixing rounds.
  const groups=new Map();
  for(const x of source){
    const cat=cleanCategory(x.category) || "OTHER";
    const key=category==="ALL" ? `${x.college}|${x.course}|${cat}` : `${x.college}|${x.course}`;
    const rank=Number(x.rank_value);
    const prev=groups.get(key);
    if(!prev || rank>prev.closing_rank){ groups.set(key,{...x,closing_rank:rank,category_clean:cat,allotment_count:1}); }
    else prev.allotment_count++;
  }
  let rows=[...groups.values()].filter(x=>x.closing_rank>=air);
  rows.sort((a,b)=>a.closing_rank-b.closing_rank);
  rows=rows.slice(0,60);

  document.getElementById("rankEmpty").hidden=true;
  document.getElementById("rankResults").hidden=false;
  const stateLabel=document.getElementById("rankState").selectedOptions[0]?.textContent||"All college states";
  const categoryLabel=document.getElementById("rankCategory").selectedOptions[0]?.textContent||"All categories";
  document.getElementById("rankResultTitle").textContent=`AIR ${fmt(air)} · ${PATHS[state.counselling].label} · ${roundLabel(state.round)}`;
  document.getElementById("rankResultCount").textContent=`${fmt(rows.length)} historical matches · ${stateLabel} · ${categoryLabel}`;
  const grid=document.getElementById("rankGrid");
  if(!rows.length){
    grid.innerHTML=`<div class="rank-item"><h4>No matching historical range found</h4><p>Try removing the specialty, college, state or category filter, or choose another round.</p></div>`;
    return;
  }
  grid.innerHTML=rows.map(x=>{
    const close=Number(x.closing_rank), buffer=close-air;
    return `<article class="rank-item">
      <span class="tag">${buffer>=0?"HISTORICALLY REACHABLE":"NEAR RANGE"}</span>
      <h4>${esc(x.course||"Course not available")}</h4>
      <p>${esc(x.college||"Institute not available")}${deriveCollegeState(x)?` · ${esc(deriveCollegeState(x))}`:""}${x.category_clean&&x.category_clean!=="OTHER"?` · ${esc(x.category_clean)}`:""}</p>
      <div class="rank-metrics">
        <div class="metric"><small>Your AIR</small><strong>${fmt(air)}</strong></div>
        <div class="metric"><small>Observed closing AIR</small><strong>${fmt(close)}</strong></div>
        <div class="metric"><small>Historical buffer</small><strong class="buffer">${buffer>=0?"+":""}${fmt(buffer)}</strong></div>
        <div class="metric"><small>Observed allotments</small><strong>${fmt(x.allotment_count)}</strong></div>
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
  populateRankStateOptions();
  document.getElementById("exploreStatus").textContent=`${PATHS[state.counselling].label} · ${roundLabel(state.round)}`;
  clearExplore();
});
document.getElementById("rankState").addEventListener("change",()=>{});
document.getElementById("rankCategory").addEventListener("change",()=>{});
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
