let matrixData = [];
let allotmentData = [];
let activeCounselling = null;
let activeYear = null;
let activeRound = null;

const DATASETS = {
  AIQ: {
    label: "All India Quota (AIQ)",
    matrix: "data/aiq_seat_matrix_r1_2025.csv",
    allotments: null
  },
  BIHAR: {
    label: "Bihar PGMAC",
    matrix: null,
    allotments: "data/pgmac_allotment_r1_2025.csv"
  }
};

function parseCSV(text){
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch==='"'){
      if(quoted && next==='"'){cell+='"';i++;}
      else quoted=!quoted;
    }else if(ch===',' && !quoted){row.push(cell);cell="";}
    else if((ch==='\n'||ch==='\r') && !quoted){
      if(ch==='\r' && next==='\n') i++;
      row.push(cell);cell="";
      if(row.some(v=>v!=="")) rows.push(row);
      row=[];
    }else cell+=ch;
  }
  if(cell!=="" || row.length){row.push(cell);if(row.some(v=>v!==""))rows.push(row);}
  const headers=(rows.shift()||[]).map(x=>x.trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??"").trim()])));
}
const n=v=>Number(String(v||"").replace(/,/g,""))||0;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function fetchCSV(path){
  if(!path) return [];
  const response=await fetch(path);
  if(!response.ok) throw new Error(`Could not load ${path}`);
  return parseCSV(await response.text());
}

async function applySelection(){
  activeCounselling=document.getElementById("globalCounselling").value;
  activeYear=document.getElementById("globalYear").value;
  activeRound=document.getElementById("globalRound").value;
  const cfg=DATASETS[activeCounselling];

  matrixData=[];
  allotmentData=[];

  try{
    [matrixData,allotmentData]=await Promise.all([
      fetchCSV(cfg.matrix),
      fetchCSV(cfg.allotments)
    ]);

    document.getElementById("status").textContent=`${cfg.label} · ${activeYear} · Round ${activeRound} loaded`;
    document.getElementById("selectionNote").innerHTML=`<b>${esc(cfg.label)}</b> · ${esc(activeYear)} · <b>Round ${esc(activeRound)}</b> selected. Choose a detailed filter below to view records.`;

    document.getElementById("matrixExplorer").hidden = !cfg.matrix;
    document.getElementById("matrixPrompt").hidden = !!cfg.matrix;
    document.getElementById("allotmentExplorer").hidden = !cfg.allotments;
    document.getElementById("allotmentPrompt").hidden = !!cfg.allotments;

    updateStats();
    populateFilters();
    clearDetailFilters();
    renderMatrix(true);
    renderAllotments(true);
    renderInsights();
  }catch(e){
    console.error(e);
    document.getElementById("status").textContent="Data could not be loaded";
  }
}

function updateStats(){
  document.getElementById("totalSeats").textContent=matrixData.reduce((s,r)=>s+n(r.total_seats),0).toLocaleString("en-IN") || "—";
  document.getElementById("aiqInstitutes").textContent=matrixData.length ? new Set(matrixData.map(r=>r.institute)).size : "—";
  document.getElementById("aiqPrograms").textContent=matrixData.length ? new Set(matrixData.map(r=>r.program)).size : "—";
  document.getElementById("allotmentCount").textContent=allotmentData.length ? allotmentData.length.toLocaleString("en-IN") : "—";
}

function populateFilters(){
  const q=[...new Set(matrixData.map(r=>r.quota).filter(Boolean))].sort();
  document.getElementById("matrixQuota").innerHTML='<option value="">All quotas</option>'+q.map(x=>`<option>${esc(x)}</option>`).join("");
  const c=[...new Set(allotmentData.map(r=>r.allotted_category).filter(Boolean))].sort();
  document.getElementById("allotCategory").innerHTML='<option value="">All allotted categories</option>'+c.map(x=>`<option>${esc(x)}</option>`).join("");
}

function clearDetailFilters(){
  ["matrixInstitute","matrixProgram","allotInstitute","allotBranch","allotAir"].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value="";
  });
  const q=document.getElementById("matrixQuota"); if(q) q.value="";
  const c=document.getElementById("allotCategory"); if(c) c.value="";
}

function hasMatrixFilter(){
  return Boolean(
    document.getElementById("matrixInstitute").value.trim() ||
    document.getElementById("matrixProgram").value.trim() ||
    document.getElementById("matrixQuota").value
  );
}

function hasAllotFilter(){
  return Boolean(
    document.getElementById("allotInstitute").value.trim() ||
    document.getElementById("allotBranch").value.trim() ||
    document.getElementById("allotCategory").value ||
    document.getElementById("allotAir").value
  );
}

function renderMatrix(initial=false){
  if(!matrixData.length) return;
  if(initial || !hasMatrixFilter()){
    document.getElementById("matrixBody").innerHTML='<tr><td colspan="9" class="empty">Select institute, specialty or quota to view the seat matrix.</td></tr>';
    return;
  }
  const i=document.getElementById("matrixInstitute").value.toLowerCase();
  const p=document.getElementById("matrixProgram").value.toLowerCase();
  const q=document.getElementById("matrixQuota").value;
  const rows=matrixData.filter(r=>
    (!i||r.institute.toLowerCase().includes(i)) &&
    (!p||r.program.toLowerCase().includes(p)) &&
    (!q||r.quota===q)
  ).slice(0,250);
  document.getElementById("matrixBody").innerHTML=rows.length?rows.map(r=>`
    <tr><td>${esc(r.institute)}</td><td>${esc(r.program)}</td><td>${esc(r.quota)}</td>
    <td>${n(r.open)}</td><td>${n(r.gen_ews)}</td><td>${n(r.obc)}</td><td>${n(r.sc)}</td><td>${n(r.st)}</td><td><b>${n(r.total_seats)}</b></td></tr>`).join("")
    :'<tr><td colspan="9" class="empty">No matching records.</td></tr>';
}

function renderAllotments(initial=false){
  if(!allotmentData.length) return;
  if(initial || !hasAllotFilter()){
    document.getElementById("allotmentBody").innerHTML='<tr><td colspan="7" class="empty">Enter a filter (institute, specialty, category or AIR) to view allotments.</td></tr>';
    return;
  }
  const i=document.getElementById("allotInstitute").value.toLowerCase();
  const b=document.getElementById("allotBranch").value.toLowerCase();
  const c=document.getElementById("allotCategory").value;
  const max=n(document.getElementById("allotAir").value);
  const rows=allotmentData.filter(r=>
    (!i||r.institute.toLowerCase().includes(i)) &&
    (!b||r.branch.toLowerCase().includes(b)) &&
    (!c||r.allotted_category===c) &&
    (!max||n(r.neet_air)<=max)
  ).sort((x,y)=>n(x.neet_air)-n(y.neet_air)).slice(0,250);
  document.getElementById("allotmentBody").innerHTML=rows.length?rows.map(r=>`
    <tr><td><b>${esc(r.neet_air)}</b></td><td>${esc(r.institute)}</td><td>${esc(r.branch)}</td>
    <td>${esc(r.neet_cat||r.category)}</td><td>${esc(r.allotted_category)}</td><td>${esc(r.seat_type)}</td><td>${esc(r.remarks)}</td></tr>`).join("")
    :'<tr><td colspan="7" class="empty">No matching records.</td></tr>';
}

function renderInsights(){
  const p={}, inst={};
  matrixData.forEach(r=>{p[r.program]=(p[r.program]||0)+n(r.total_seats);inst[r.institute]=(inst[r.institute]||0)+n(r.total_seats);});
  const topP=Object.entries(p).sort((a,b)=>b[1]-a[1])[0];
  const topI=Object.entries(inst).sort((a,b)=>b[1]-a[1])[0];
  const minAir=allotmentData.filter(r=>n(r.neet_air)>0).sort((a,b)=>n(a.neet_air)-n(b.neet_air))[0];
  document.getElementById("topProgram").textContent=topP?`${topP[0]} — ${topP[1].toLocaleString("en-IN")} seats`:"—";
  document.getElementById("topInstitute").textContent=topI?`${topI[0]} — ${topI[1].toLocaleString("en-IN")} seats`:"—";
  document.getElementById("bestObserved").textContent=minAir?`AIR ${n(minAir.neet_air).toLocaleString("en-IN")}`:"—";
}

document.getElementById("applySelection").addEventListener("click",applySelection);
document.getElementById("matrixSearch").addEventListener("click",()=>renderMatrix(false));
document.getElementById("allotSearch").addEventListener("click",()=>renderAllotments(false));
document.getElementById("matrixInstitute").addEventListener("keydown",e=>{if(e.key==="Enter")renderMatrix(false)});
document.getElementById("matrixProgram").addEventListener("keydown",e=>{if(e.key==="Enter")renderMatrix(false)});
document.getElementById("allotInstitute").addEventListener("keydown",e=>{if(e.key==="Enter")renderAllotments(false)});
document.getElementById("allotBranch").addEventListener("keydown",e=>{if(e.key==="Enter")renderAllotments(false)});
document.getElementById("allotAir").addEventListener("keydown",e=>{if(e.key==="Enter")renderAllotments(false)});

applySelection();
