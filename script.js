let matrixData = [];
let allotmentData = [];

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
  const headers=rows.shift().map(x=>x.trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??"").trim()])));
}
const n=v=>Number(String(v||"").replace(/,/g,""))||0;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function loadData(){
  try{
    const [m,a]=await Promise.all([
      fetch("data/aiq_seat_matrix_r1_2025.csv").then(r=>r.text()),
      fetch("data/pgmac_allotment_r1_2025.csv").then(r=>r.text())
    ]);
    matrixData=parseCSV(m); allotmentData=parseCSV(a);
    document.getElementById("status").textContent="Data loaded successfully";
    updateStats(); populateFilters(); renderMatrix(); renderAllotments(); renderInsights();
  }catch(e){
    console.error(e);
    document.getElementById("status").textContent="Data could not be loaded";
    document.getElementById("matrixBody").innerHTML='<tr><td colspan="9" class="empty">Check that the CSV files are uploaded under the data/ folder.</td></tr>';
  }
}

function updateStats(){
  const total=matrixData.reduce((s,r)=>s+n(r.total_seats),0);
  document.getElementById("totalSeats").textContent=total.toLocaleString("en-IN");
  document.getElementById("aiqInstitutes").textContent=new Set(matrixData.map(r=>r.institute)).size;
  document.getElementById("aiqPrograms").textContent=new Set(matrixData.map(r=>r.program)).size;
  document.getElementById("allotmentCount").textContent=allotmentData.length.toLocaleString("en-IN");
}
function populateFilters(){
  const q=[...new Set(matrixData.map(r=>r.quota).filter(Boolean))].sort();
  document.getElementById("matrixQuota").innerHTML='<option value="">All quotas</option>'+q.map(x=>`<option>${esc(x)}</option>`).join("");
  const c=[...new Set(allotmentData.map(r=>r.allotted_category).filter(Boolean))].sort();
  document.getElementById("allotCategory").innerHTML='<option value="">All allotted categories</option>'+c.map(x=>`<option>${esc(x)}</option>`).join("");
}
function renderMatrix(){
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
function renderAllotments(){
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
  const p={}; const inst={};
  matrixData.forEach(r=>{p[r.program]=(p[r.program]||0)+n(r.total_seats);inst[r.institute]=(inst[r.institute]||0)+n(r.total_seats);});
  const topP=Object.entries(p).sort((a,b)=>b[1]-a[1])[0];
  const topI=Object.entries(inst).sort((a,b)=>b[1]-a[1])[0];
  const minAir=allotmentData.filter(r=>n(r.neet_air)>0).sort((a,b)=>n(a.neet_air)-n(b.neet_air))[0];
  document.getElementById("topProgram").textContent=topP?`${topP[0]} — ${topP[1].toLocaleString("en-IN")} seats`:"—";
  document.getElementById("topInstitute").textContent=topI?`${topI[0]} — ${topI[1].toLocaleString("en-IN")} seats`:"—";
  document.getElementById("bestObserved").textContent=minAir?`AIR ${n(minAir.neet_air).toLocaleString("en-IN")}`:"—";
}
loadData();
