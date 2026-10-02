// ---- SeatMentor analytics (Google Analytics 4) ---------------------------
// Set the Measurement ID once in index.html. Events are safely ignored until
// a real G-XXXXXXXXXX ID is configured.
function trackEvent(name, params={}){
  try{
    if(typeof window.gtag === "function") window.gtag("event", name, params);
  }catch(e){ console.debug("Analytics event skipped", name, e); }
}

function analyticsContext(){
  const val=id=>document.getElementById(id)?.value || "";
  return {
    counselling: val("counselling"),
    round: val("round"),
    college_state: val("rankState"),
    category: val("rankCategory"),
    institute_type: val("rankInstituteType"),
    course: val("rankCourse"),
    college: val("rankCollege")
  };
}

const PATHS = {
  AIQ: {label:"All India Quota", allotment:"data/allotment/aiq.csv", cutoff:"data/cutoff/aiq.csv", movement:"data/movement/aiq.csv"},
  BIHAR: {label:"Bihar PGMAC", allotment:"data/allotment/bihar.csv", cutoff:"data/cutoff/bihar.csv", movement:"data/movement/bihar.csv"},
  UP: {label:"Uttar Pradesh", allotment:"data/allotment/up.csv", cutoff:"data/cutoff/up.csv", movement:"data/movement/up.csv"},
  MP: {label:"Madhya Pradesh", allotment:"data/allotment/mp.csv", cutoff:"data/cutoff/mp.csv", movement:"data/movement/mp.csv"},
  RAJASTHAN: {label:"Rajasthan", allotment:"data/allotment/rajasthan.csv", cutoff:"data/cutoff/rajasthan.csv", movement:"data/movement/rajasthan.csv"},
  JHARKHAND: {label:"Jharkhand", allotment:"data/allotment/jharkhand.csv", cutoff:"data/cutoff/jharkhand.csv", movement:"data/movement/jharkhand.csv"}
};

const state = { counselling:"AIQ", round:"R1", allotments:[], cutoffs:[], movement:[], collegeMaster:[], loaded:false };

// Optional: after creating a Formspree form, paste its endpoint here.
// Example: https://formspree.io/f/abcdwxyz
// Until then, SeatMentor falls back to a pre-filled GitHub issue composer.
const FORM_ENDPOINT = "";
const GITHUB_ISSUE_URL = "https://github.com/Piyush-kumar-tiwary/seatmentor/issues/new";

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
    state.allotments=normalizeDataset(a); state.cutoffs=c.map(normalizeRecord); state.movement=m.map(normalizeRecord); state.loaded=true;
    setRoundOptions(a);
    populateRankStateOptions();
    populateRankCourseOptions();
    populateCollegeOptions();
    populateCourseDatalist();
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
  const t=norm(x._college||x.college||"");
  const aliases=[
    ["ANDAMAN AND NICOBAR ISLANDS","Andaman & Nicobar Islands"],["ANDHRA PRADESH","Andhra Pradesh"],["ARUNACHAL PRADESH","Arunachal Pradesh"],["ASSAM","Assam"],["BIHAR","Bihar"],["CHANDIGARH","Chandigarh"],["CHHATTISGARH","Chhattisgarh"],["DELHI","Delhi"],["NEW DELHI","Delhi"],["GOA","Goa"],["GUJARAT","Gujarat"],["HARYANA","Haryana"],["HIMACHAL PRADESH","Himachal Pradesh"],["JAMMU AND KASHMIR","Jammu & Kashmir"],["JAMMU KASHMIR","Jammu & Kashmir"],["JHARKHAND","Jharkhand"],["KARNATAKA","Karnataka"],["KERALA","Kerala"],["LADAKH","Ladakh"],["LAKSHADWEEP","Lakshadweep"],["MADHYA PRADESH","Madhya Pradesh"],["MAHARASHTRA","Maharashtra"],["MANIPUR","Manipur"],["MEGHALAYA","Meghalaya"],["MIZORAM","Mizoram"],["NAGALAND","Nagaland"],["ODISHA","Odisha"],["ORISSA","Odisha"],["PUDUCHERRY","Puducherry"],["PONDICHERRY","Puducherry"],["PUNJAB","Punjab"],["RAJASTHAN","Rajasthan"],["SIKKIM","Sikkim"],["TAMIL NADU","Tamil Nadu"],["TELANGANA","Telangana"],["TRIPURA","Tripura"],["UTTAR PRADESH","Uttar Pradesh"],["UTTARAKHAND","Uttarakhand"],["WEST BENGAL","West Bengal"]
  ];
  for(const [needle,label] of aliases){ if(t.includes(needle)) return label; }
  return "";
}

// ---- Clean master fields -------------------------------------------------
// The source PDFs are not uniform: some rows have college/course columns shifted,
// some course labels contain NBEMS/diploma prefixes, and some college cells contain
// addresses or email IDs. We create clean candidate-facing fields without changing
// the original source columns.

// Exact/near-exact course labels commonly found in Bihar PGMAC extracts.
const EXACT_COURSE_MAP = [
  ["GENERAL MEDICINE", "MD - General Medicine"],
  ["GENERAL SURGERY", "MS - General Surgery"],
  ["ANAESTHESIOLOGY", "MD - Anaesthesiology"],
  ["PAEDIATRICS", "MD - Paediatrics"],
  ["PEDIATRICS", "MD - Paediatrics"],
  ["ORTHOPAEDICS", "MS - Orthopaedics"],
  ["ORTHOPEDICS", "MS - Orthopaedics"],
  ["RADIO DIAGNOSIS", "MD - Radio Diagnosis / Radiology"],
  ["RADIODIAGNOSIS", "MD - Radio Diagnosis / Radiology"],
  ["RADIOLOGY", "MD - Radio Diagnosis / Radiology"],
  ["OBS GYNAE", "MS - Obstetrics & Gynaecology"],
  ["OBS & GYNAE", "MS - Obstetrics & Gynaecology"],
  ["OPHTHALMOLOGY", "MS - Ophthalmology"],
  ["E N T", "MS - ENT"],
  ["E N T", "MS - ENT"],
  ["E N T", "MS - ENT"],
  ["E N T", "MS - ENT"],
  ["PATHOLOGY", "MD - Pathology"],
  ["MICROBIOLOGY", "MD - Microbiology"],
  ["PHARMACOLOGY", "MD - Pharmacology"],
  ["PHYSIOLOGY", "MD - Physiology"],
  ["PSYCHIATRY", "MD - Psychiatry"],
  ["COMMUNITY MEDICINE", "MD - Community Medicine"],
  ["F M T", "MD - Forensic Medicine"],
  ["FORENSIC MEDICINE", "MD - Forensic Medicine"],
  ["ANATOMY", "MD - Anatomy"],
  ["BIOCHEMISTRY", "MD - Biochemistry"],
  ["DERMATOLOGY", "MD - Dermatology"],
  ["RADIO ONCOLOGY", "MD - Radiotherapy"],
  ["PHYSICAL MEDICINE REHABILITATION", "MD - Physical Medicine & Rehabilitation"]
];

// Candidate-facing institute ownership/type classification. We only classify when
// the institute name has a strong, recognizable signal; otherwise it stays
// unclassified and remains visible under "All institutes".
const GOVERNMENT_INSTITUTE_PATTERNS = [
  /\bAIIMS\b|ALL INDIA INSTITUTE OF MEDICAL SCIENCES/,
  /GOVT|GOVERNMENT|AUTONOMOUS STATE MEDICAL COLLEGE/,
  /PGIMER|JIPMER|VMMC|SAFDARJUNG|RAM MANOHAR LOHIA/,
  /I\.G\.I\.M\.S|IGIMS/,
  /P\.M\.C\.?\s*PATNA|PATNA MEDICAL COLLEGE/,
  /N\.M\.C\.?\s*PATNA|NALANDA MEDICAL COLLEGE/,
  /D\.M\.C\.?\s*LAHERIASARAI|DARBHANGA MEDICAL COLLEGE/,
  /S\.K\.M\.C\.?\s*MUZAFFARPUR|SRI KRISHNA MEDICAL COLLEGE/,
  /J\.L\.N\.M\.C\.?\s*BHAGALPUR|JAWAHARLAL NEHRU MEDICAL COLLEGE.*BHAGALPUR/,
  /A\.N\.M\.M\.C\.?\s*GAYA|ANUGRAH NARAYAN MAGADH MEDICAL COLLEGE/,
  /G\.M\.C\.?\s*BETTIAH|GOVERNMENT MEDICAL COLLEGE.*BETTIAH/,
  /RAJENDRA INSTITUTE OF MEDICAL SCIENCES|RIMS\s*,?\s*RANCHI/,
  /MAHATMA GANDHI MEMORIAL MEDICAL COLLEGE.*JAMSHEDPUR/,
  /GANDHI MEDICAL COLLEGE/,
  /GAJRA RAJA MEDICAL COLLEGE/,
  /SHYAM SHAH MEDICAL COLLEGE/,
  /BUNDELKHAND MEDICAL COLLEGE/,
  /GOA MEDICAL COLLEGE/,
  /K\.A\.P\.VISWANATHAM GOVERNMENT MEDICAL COLLEGE/,
  /S\.V\. MEDICAL COLLEGE/,
  /AUTONOMOUS MEDICAL COLLEGE/
];

const PRIVATE_INSTITUTE_PATTERNS = [
  /K\.M\.C\.?\s*KATIHAR|KATIHAR MEDICAL COLLEGE/,
  /MADHUBANI MEDICAL COLLEGE/,
  /LORD BUDHA KOSHI/,
  /NARAYAN MEDICAL COLLEGE/,
  /NETAJI SUBHAS MEDICAL COLLEGE/,
  /B\.M\.I\.M\.S|B M I M S|BUDDHA INSTITUTE OF MEDICAL SCIENCES/,
  /SHRI NARAYAN MEDICAL INSTITUTE/,
  /CHIRAYU MEDICAL COLLEGE/,
  /PEOPLES COLLEGE OF MEDICAL SCIENCE/,
  /SRI AUROBINDO INSTITUTE OF MEDICAL SCIENCE/,
  /AMALTAS INSTITUTE OF MEDICAL SCIENCES/,
  /R D GARDI MEDICAL COLLEGE|RD GARDI MEDICAL COLLEGE/,
  /DR\.?\s*D\.?\s*Y\.?\s*PATIL MEDICAL COLLEGE|D Y PATIL MEDICAL COLLEGE/,
  /VINAYAKA MISSIONS MEDICAL COLLEGE/,
  /YENEPOYA MEDICAL COLLEGE/,
  /SBKS MEDICAL|SHRI SATHYA SAI MEDICAL COLLEGE/,
  /BHARATI VIDYAPEETH.*MEDICAL COLLEGE/,
  /CHEttinad.*MEDICAL|CHETTINAD HOSPITAL AND RESEARCH/,
  /M\.M\.\s*INSTITUTE OF MEDICAL SCIENCES/,
  /AMRITA SCHOOL OF MEDICINE|AMRITA INSTITUTE OF MEDICAL SCIENCES/,
  /SUMITRA HOSPITAL/
];

function deriveInstituteType(x){
  const n=norm(x._college||x.college||"");
  if(!n) return "";
  if(GOVERNMENT_INSTITUTE_PATTERNS.some(re=>re.test(n))) return "GOVERNMENT";
  if(PRIVATE_INSTITUTE_PATTERNS.some(re=>re.test(n))) return "PRIVATE";
  // Strong corporate/private indicators in extracted institute names.
  if(/\b(PRIVATE|PVT|TRUST|FOUNDATION|INSTITUTE OF MEDICAL SCIENCES AND RESEARCH|MEDICAL COLLEGE.*HOSPITAL)\b/.test(n) && !/GOVERNMENT|GOVT/.test(n)) return "PRIVATE";
  return "";
}

const COURSE_PATTERNS = [
  ["MD - General Medicine", /GENERAL\s+MEDICINE/],
  ["MS - General Surgery", /GENERAL\s+SURGERY/],
  ["MD - Anaesthesiology", /ANAESTHESIO|ANAESTHESIA/],
  ["MD - Paediatrics", /PAEDIATRIC|PEDIATRIC/],
  ["MS - Orthopaedics", /ORTHOPAED|ORTHOPED/],
  ["MD - Radio Diagnosis / Radiology", /RADIO\s*[- ]?DIAGNOSIS|RADIODIAGNOS|RADIOLOGY/],
  ["MS - Obstetrics & Gynaecology", /OBSTETRICS?\s*(AND|&)\s*GYNAE|OBST\.\s*&\s*GYNAE|GYNAECOLOGY/],
  ["MD - Dermatology", /DERMATOLOGY|DERM\.?\s*,?\s*VENE|SKIN\s*(AND|&)\s*V\.?D/],
  ["MS - Ophthalmology", /OPHTHALMOLOGY/],
  ["MS - ENT", /OTORHINOLARYNG|\bENT\b|E\.N\.T\./],
  ["MD - Pathology", /PATHOLOGY/],
  ["MD - Microbiology", /MICROBIOLOGY/],
  ["MD - Pharmacology", /PHARMACOLOGY/],
  ["MD - Physiology", /PHYSIOLOGY/],
  ["MD - Psychiatry", /PSYCHIATRY/],
  ["MD - Community Medicine", /COMMUNITY\s+MEDICINE|SOCIAL\s*&?\s*PREVENTIVE\s*MEDICINE|\bPSM\b/],
  ["MD - Forensic Medicine", /FORENSIC\s+MEDICINE|\bFMT\b/],
  ["MD - Anatomy", /\bANATOMY\b/],
  ["MD - Biochemistry", /BIO[- ]?CHEMISTRY|BIOCHEMISTRY/],
  ["MD - Emergency Medicine", /EMERGENCY\s+MEDICINE/],
  ["MD - Respiratory / Pulmonary Medicine", /RESPIRATORY\s+MEDICINE|PULMONARY\s+MEDICINE|TB\s*&?\s*CHEST/],
  ["MD - Nuclear Medicine", /NUCLEAR\s+MEDICINE/],
  ["MD - Psychiatry", /PSYCHIATRY/],
  ["MD - Transfusion Medicine", /TRANSFUSION\s+MEDICINE|IMMUNO.*HAEMATOLOGY.*BLOOD\s+TRANSFUSION|BLOOD\s+TRANSFUSION/],
  ["MD - Radiotherapy", /RADIOTHERAPY|RADIATION\s*ONCOLOGY/],
  ["MD - Physical Medicine & Rehabilitation", /PHYSICAL\s+MEDICINE|PHY\.?\s*MED|REHAB/],
  ["MD - Geriatrics", /GERIATRIC/],
  ["MD - Tropical Medicine", /TROPICAL\s+MEDICINE/],
  ["MD - Venereology", /VENEREOLOGY/],
  ["MS - Neurosurgery", /NEURO\s*SURGERY/],
  ["MS - Traumatology & Surgery", /TRAUMATOLOGY\s*(AND|&)\s*SURGERY/],
  ["DNB - General Medicine", /DNB.*GENERAL\s+MEDICINE/],
  ["DNB - General Surgery", /DNB.*GENERAL\s+SURGERY/],
  ["Diploma - Anaesthesia", /DIPLOMA.*ANAESTH/],
  ["Diploma - Paediatrics", /DIPLOMA.*PAEDIATR|DCH/],
  ["Diploma - Ophthalmology", /DIPLOMA.*OPHTHAL/],
  ["Diploma - ENT", /DIPLOMA.*OTO[- ]?RHINO|DIPLOMA.*ENT/],
  ["Diploma - Pathology", /DIPLOMA.*PATHOLOGY/],
  ["Diploma - Radio Diagnosis", /DIPLOMA.*RADIO/],
  ["Diploma - Obstetrics & Gynaecology", /DIPLOMA.*OBST.*GYNAE|DGO/],
  ["Diploma - Dermatology", /DIPLOMA.*DERMATOLOGY/],
  ["Diploma - Orthopaedics", /DIPLOMA.*ORTHOP/],
  ["Diploma - Psychiatry", /DIPLOMA.*PSYCHIATRY/],
  ["Diploma - Community Medicine", /DIPLOMA.*COMMUNITY|DIPLOMA.*PUBLIC\s+HEALTH|PSM/],
  ["Diploma - Forensic Medicine", /DIPLOMA.*FORENSIC/],
  ["Diploma - Microbiology", /DIPLOMA.*MICROBIOLOGY/],
  ["Diploma - Pharmacology", /DIPLOMA.*PHARMACOLOGY/]
];

function canonicalCourse(...values){
  const raws=values.map(v=>String(v||"").trim()).filter(Boolean);
  if(!raws.length) return "";
  // First check exact/near-exact labels before broader regex rules.
  for(const raw of raws){
    const n=norm(raw);
    for(const [needle,label] of EXACT_COURSE_MAP){
      if(n===needle || n.includes(needle)) return label;
    }
  }
  // Prefer a value that actually looks like a course over a seat/remarks string.
  const scored=raws.map(raw=>{
    const n=norm(raw);
    let score=0;
    if(/AGAINST|JUMP OVER|CATEGORY SEAT|ALLOTTED|NOT ALLOTTED|VACANCY|FRESH ALLOTMENT/.test(n)) score-=100;
    if(/MD|MS|DNB|DIPLOMA|ANAESTH|MEDICINE|SURGERY|PAEDIATR|PATHOLOGY|MICROBIOLOGY|RADIO|ORTHOP|OPHTHAL|GYNAE|DERMAT/.test(n)) score+=10;
    if(raw.length>140) score-=20;
    return {raw,n,score};
  }).sort((a,b)=>b.score-a.score);
  for(const c of scored){
    for(const [label,re] of COURSE_PATTERNS){
      if(re.test(c.n)){
        // If a combined course explicitly contains a named degree, keep the most
        // useful broad PG label rather than the noisy PDF variant.
        return label;
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// College / institute cleaning + autocomplete
// The source PDFs contain repeated addresses, page fragments, OCR damage and
// concatenated neighbouring cells. We keep the underlying source untouched,
// but expose a clean candidate-facing college name and a search alias set.
// ---------------------------------------------------------------------------
const COLLEGE_ALIASES = [
  [/INDIRA\s+GANDHI\s+INSTITUTE\s+(?:OF|O)?\s*MEDICAL\s+SCIEN.*/i, "Indira Gandhi Institute of Medical Sciences"],
  [/MAHATMA\s+GANDHI\s+CANCER\s+HOSPITAL.*/i, "Mahatma Gandhi Cancer Hospital and Research Institute"],
  [/(?:DR\.?\s*)?D\.?\s*Y\.?\s*PATIL\s+MEDICAL\s+COLLEGE.*/i, "Dr. D. Y. Patil Medical College"],
  [/SHRI\.?\s*B\.?\s*M\.?\s*PATIL\s+MEDICAL\s+COLLEGE.*/i, "Shri B. M. Patil Medical College Hospital and Research Centre"],
  [/SHRI\s+VASANTRAO\s+NAIK.*MEDICAL\s+COLLEGE.*YAVATMAL/i, "Shri Vasantrao Naik Govt. Medical College, Yavatmal"],
  [/PANDIT\s+DINDAYAL\s+UPADHYAY\s+MEDICAL\s+COLLEGE.*RAJKOT/i, "Pandit Dindayal Upadhyay Medical College, Rajkot"],
  [/MAULANA\s+AZAD\s+MEDICAL\s+COLLEGE/i, "Maulana Azad Medical College"],
  [/^(?:NIL\s+)?RATAN\s+SIRCAR\s+MEDICAL\s+COLLEGE/i, "Nil Ratan Sircar Medical College"],
  [/RAVINDRA\s+NATH\s+TAGORE\s+MEDICAL\s+COLLEGE/i, "Ravindra Nath Tagore Medical College"],
  [/JASLOK\s+HOSPITAL/i, "Jaslok Hospital and Research Centre"],
  [/AIG\s+HOSPITAL/i, "AIG Hospitals"],
  [/K\.?\s*S\.?\s*HEGDE\s+MEDICAL\s+ACADEMY/i, "K. S. Hegde Medical Academy"],
  [/PGIMER/i, "PGIMER"],
  [/JIPMER/i, "JIPMER"],
  [/AIIMS\s+(?:NEW\s+DELHI|DELHI)/i, "AIIMS New Delhi"],
  [/GURU\s+GOBIND\s+SINGH\s+MEDICAL\s+COLLEGE.*FARIDKOT/i, "Guru Gobind Singh Medical College, Faridkot"],
  [/GANDHI\s+MEDICAL\s+COLLEGE.*BHOPAL/i, "Gandhi Medical College, Bhopal"],
  [/PATNA\s+MEDICAL\s+COLLEGE/i, "Patna Medical College"],
  [/DARBHANGA\s+MEDICAL\s+COLLEGE/i, "Darbhanga Medical College"],
  [/ANUGRAH\s+NARAYAN\s+MAGADH\s+MEDICAL\s+COLLEGE/i, "Anugrah Narayan Magadh Medical College, Gaya"],
  [/S\.K\.M\.C\.\s*MUZAFFARPUR/i, "S.K.M.C. Muzaffarpur"],
  [/D\.M\.C\.\s*LAHERIASARAI/i, "D.M.C. Laheriasarai"],
  [/P\.M\.C\.\s*PATNA/i, "P.M.C. Patna"],
  [/N\.M\.C(?:\s*&\.?H|\s*\.?H)?\.?\s*SASARAM/i, "N.M.C. & H., Sasaram"],
  [/N\.M\.C\.\s*PATNA/i, "N.M.C. Patna"],
  [/I\.G\.I\.M\.S\.\s*PATNA/i, "I.G.I.M.S. Patna"],
  [/G\.M\.C\.?\s*,?\s*BETTIAH/i, "G.M.C., Bettiah"]
];

function stripCollegeJunkStart(s){
  let out=s;
  for(let i=0;i<4;i++){
    out=out.replace(/^[\s,._-]+/g,"");
    out=out.replace(/^(?:PAGE|AGE)\s*NO\.?\s*[:#.-]?\s*\d+\s*/i,"");
    out=out.replace(/^\d+(?:\s*[-.:_]+\s*)+/i,"");
    out=out.replace(/^(?:QUOTA|MERIT|FINANCED|FRESH\s+ALLOTMENT|SEAT)\s+/i,"");
    out=out.replace(/^(?:anced|nced|ced|inanced|ia|ana|ndia|dia|ndit|vindra|lhi|ity)\s+/i,"");
  }
  out=out.replace(/^-+(?:\s*-+)+/g,"").trim();
  return out;
}

function applyCollegeAlias(s){
  const n=norm(s);
  for(const [re,name] of COLLEGE_ALIASES){
    if(re.test(n)) return name;
  }
  return "";
}

function cleanCollegeName(value){
  let s=String(value||"").replace(/\uFEFF/g,"").trim();
  if(!s) return "";
  s=s.replace(/[\u2013\u2014]/g,"-").replace(/\s+/g," ");

  // Remove page tails first. These are frequent in AIQ extraction.
  s=s.replace(/\s*(?:PAGE|AGE)\s*NO\.?\s*[:#.-]?\s*\d+.*$/i,"");
  s=stripCollegeJunkStart(s);

  // Correct common OCR splits before selecting the display name.
  s=s.replace(/\bCollge\b/ig,"College")
      .replace(/\bMedic\b/ig,"Medical")
      .replace(/\bScienc(?:e)?s?\b/ig,"Sciences")
      .replace(/\bInsti?tute\b/ig,"Institute")
      .replace(/\bO\s+Medical\b/ig,"of Medical")
      .replace(/\s{2,}/g," ").trim();

  // Exact/near-exact known aliases win over generic extraction.
  const alias=applyCollegeAlias(s);
  if(alias) return alias;

  // The first comma-separated segment is usually the institute name; the rest
  // is typically address / city / contact information or a repeated institute.
  let first=(s.split(/\s*,\s*/)[0]||s).trim();
  first=stripCollegeJunkStart(first);
  const firstAlias=applyCollegeAlias(first);
  if(firstAlias) return firstAlias;

  // Remove obvious extraction words if they survived in the first segment.
  first=first.replace(/\b(?:PAGE|AGE)\s+NO\b.*$/i,"")
             .replace(/\b(?:AGAINST|JUMP|OVER|SEAT|CATEGORY|ALLOTTED)\b.*$/i,"")
             .replace(/\s{2,}/g," ").trim();

  if(!first || first.length<3) return "";
  if(/^[._\-\s\d]+$/.test(first)) return "";
  if(/^(?:GENERAL MEDICINE|GENERAL SURGERY|PAEDIATRICS|ANAESTHESIOLOGY|PATHOLOGY|MICROBIOLOGY|RADIOLOGY|OPHTHALMOLOGY|ORTHOPAEDICS|DERMATOLOGY|EWS|OBC|SC|ST|UR|BC|EBC)$/i.test(first)) return "";
  if(!/[A-Za-z]{3,}/.test(first)) return "";
  return first.replace(/^[-\s,._]+|[-\s,._]+$/g,"").trim();
}

function collegeSearchTerms(raw, display, stateName){
  const terms=[display, stateName];
  const s=String(raw||"");
  const chunks=s.split(/\s*,\s*/).map(x=>x.trim()).filter(Boolean).slice(0,5);
  for(const c of chunks) if(c.length>=3 && !/^(?:PAGE|AGE)\s+NO\b/i.test(c)) terms.push(c);
  return norm(terms.join(" "));
}

function canonicalCollegeName(...values){
  const raws=values.map(v=>String(v||"").trim()).filter(Boolean);
  for(const raw of raws){
    const c=cleanCollegeName(raw);
    if(c) return c;
  }
  return "";
}

function buildCollegeMaster(){
  const map=new Map();
  for(const x of state.allotments){
    const name=x._college;
    if(!name) continue;
    const key=norm(name);
    if(!key) continue;
    let item=map.get(key);
    if(!item){
      item={name,search:new Set()};
      map.set(key,item);
    }
    item.search.add(norm(name));
    item.search.add(x._collegeSearch||"");
  }
  state.collegeMaster=[...map.values()]
    .map(x=>({...x,searchText:[...x.search].filter(Boolean).join(" ")}))
    .sort((a,b)=>a.name.localeCompare(b.name,"en",{sensitivity:"base"}));
}

function setupCollegeAutocomplete(inputId, menuId){
  const input=document.getElementById(inputId), menu=document.getElementById(menuId);
  if(!input||!menu) return;
  const host=input.parentElement;
  let activeIndex=-1;

  function close(){ menu.hidden=true; activeIndex=-1; }
  function render(){
    const q=norm(input.value);
    const items=state.collegeMaster
      .filter(x=>!q || norm(x.searchText).includes(q))
      .slice(0,12);
    if(!items.length){
      menu.innerHTML=`<div class="autocomplete-empty">No matching college found</div>`;
      menu.hidden=false;
      return;
    }
    menu.innerHTML=items.map((x,i)=>`<button type="button" class="autocomplete-option" data-name="${esc(x.name)}" data-index="${i}">${esc(x.name)}</button>`).join("");
    menu.hidden=false;
    activeIndex=-1;
  }
  function choose(name){
    input.value=name;
    input.dataset.selectedCollege=name;
    close();
    input.dispatchEvent(new Event("change",{bubbles:true}));
  }
  input.addEventListener("focus",render);
  input.addEventListener("input",()=>{delete input.dataset.selectedCollege; render();});
  input.addEventListener("keydown",e=>{
    if(menu.hidden) return;
    const options=[...menu.querySelectorAll(".autocomplete-option")];
    if(e.key==="ArrowDown"){e.preventDefault();activeIndex=Math.min(activeIndex+1,options.length-1);options.forEach((o,i)=>o.classList.toggle("active",i===activeIndex));}
    else if(e.key==="ArrowUp"){e.preventDefault();activeIndex=Math.max(activeIndex-1,0);options.forEach((o,i)=>o.classList.toggle("active",i===activeIndex));}
    else if(e.key==="Enter" && activeIndex>=0){e.preventDefault();choose(options[activeIndex].dataset.name);}
    else if(e.key==="Escape") close();
  });
  menu.addEventListener("mousedown",e=>{
    const btn=e.target.closest(".autocomplete-option");
    if(btn){e.preventDefault();choose(btn.dataset.name);}
  });
  document.addEventListener("click",e=>{ if(!host.contains(e.target)) close(); });
}

function collegeMatches(x, query){
  if(!query) return true;
  return norm(x._collegeSearch||x._college||"").includes(query);
}

function looksLikeSeatMarker(value){
  const n=norm(value);
  return /^(?:\d+\.)?(?:RCG|EBC|BC|UR|EWS|SC|ST)\s*\(?(?:DIPLOMA|DEGREE)?\)?(?:[- ]\s*\d+)?$/.test(n)
    || /^(?:\d+\.)?(?:RCG|EBC|BC|UR|EWS|SC|ST)\b.*(?:DIPLOMA|DEGREE)/.test(n);
}

function looksLikeRemark(value){
  const n=norm(value);
  return !n || /AGAINST|JUMP OVER|COMPENSATION SEAT|FRESH ALLOTMENT|CATEGORY SEAT|ALLOTTED|NOT ALLOTTED|VACANCY/.test(n);
}

function cleanRowCategory(x){
  const direct=cleanCategory(x.category);
  if(direct) return direct;
  // In several Bihar round extracts the PDF columns are shifted. The reservation
  // category is then carried by a seat marker in the college column while the
  // category column contains the course name. Preserve only explicit categories.
  const n=norm(x.college);
  if(/(?:^|\s)(EBC)(?:\s|\(|-|$)/.test(n)) return "EBC";
  if(/(?:^|\s)(EWS)(?:\s|\(|-|$)/.test(n)) return "EWS";
  if(/(?:^|\s)(BC)(?:\s|\(|-|$)/.test(n)) return "OBC";
  if(/(?:^|\s)(SC)(?:\s|\(|-|$)/.test(n)) return "SC";
  if(/(?:^|\s)(ST)(?:\s|\(|-|$)/.test(n)) return "ST";
  if(/(?:^|\s)(UR)(?:\s|\(|-|$)/.test(n)) return "GENERAL";
  return "";
}

function normalizeRecord(x){
  const rawCollege=String(x.college||"");
  const rawCourse=String(x.course||"");
  const rawCategory=String(x.category||"");

  const course=canonicalCourse(rawCourse,rawCategory,rawCollege);
  const collegeA=canonicalCollegeName(rawCollege);
  const collegeB=canonicalCollegeName(rawCourse);

  let college=collegeA;
  if(looksLikeSeatMarker(rawCollege) && collegeB && !looksLikeRemark(rawCourse) && !canonicalCourse(rawCourse)) college=collegeB;
  if(!college && collegeB && !looksLikeRemark(rawCourse)) college=collegeB;
  if(canonicalCourse(rawCollege) && looksLikeRemark(rawCourse)) college="";

  const collegeSearch=collegeSearchTerms(rawCollege,college,x.state||"");
  return {...x,_college:college,_course:course,_category:cleanRowCategory(x),_collegeSearch:collegeSearch};
}

function normalizeDataset(rows){ return rows.map(normalizeRecord); }

function isCollegeLike(v){ return !!canonicalCollegeName(v); }

function populateCollegeOptions(){
  buildCollegeMaster();
}

function populateCourseDatalist(){
  const list=document.getElementById("courseOptions");
  if(!list) return;
  const vals=[...new Set(state.allotments.map(x=>x._course).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"en",{sensitivity:"base"}));
  list.innerHTML=vals.map(v=>`<option value="${esc(v)}"></option>`).join("");
}

function populateRankCourseOptions(){
  const sel=document.getElementById("rankCourse");
  if(!sel) return;
  const previous=sel.value;
  // Build the candidate-facing course master from the entire selected counselling
  // dataset, not only the currently selected round. Some Bihar Round-1 rows have
  // shifted PDF columns; using the full counselling file prevents the dropdown
  // from becoming empty simply because a particular round has noisier extraction.
  const courses=[...new Set(state.allotments.map(x=>x._course).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"en",{sensitivity:"base"}));
  sel.innerHTML=`<option value="">All courses</option>` + courses.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  sel.value=courses.includes(previous)?previous:"";
}

function populateRankStateOptions(){
  const sel=document.getElementById("rankState");
  sel.innerHTML=`<option value="ALL">All college states</option>` + COLLEGE_STATES.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if(!sel.value) sel.value="ALL";
}

function rankFilteredAllotments(){
  const selectedState=document.getElementById("rankState").value;
  const selectedCategory=document.getElementById("rankCategory").value;
  const selectedInstituteType=document.getElementById("rankInstituteType")?.value || "ALL";
  let rows=currentAllotments();
  if(selectedState && selectedState!=="ALL") rows=rows.filter(x=>deriveCollegeState(x)===selectedState);
  if(selectedCategory && selectedCategory!=="ALL") rows=rows.filter(x=>(x._category||cleanCategory(x.category))===selectedCategory);
  if(selectedInstituteType && selectedInstituteType!=="ALL") rows=rows.filter(x=>deriveInstituteType(x)===selectedInstituteType);
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
  trackEvent("rank_search", {...analyticsContext(), air: air});
  const course=norm(document.getElementById("rankCourse").value);
  const college=norm(document.getElementById("rankCollege").value);
  const category=document.getElementById("rankCategory").value;
  let source=rankFilteredAllotments();
  if(course) source=source.filter(x=>x._course===document.getElementById("rankCourse").value);
  if(college) source=source.filter(x=>collegeMatches(x,college));

  // Derive observed closing AIR from the selected round's actual allotments.
  // This keeps category/state filters tied to the same round instead of mixing rounds.
  const groups=new Map();
  for(const x of source){
    const cat=x._category || cleanCategory(x.category) || "OTHER";
    const key=category==="ALL" ? `${x._college}|${x._course}|${cat}` : `${x._college}|${x._course}`;
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
  const instituteTypeLabel=document.getElementById("rankInstituteType")?.selectedOptions[0]?.textContent||"All institutes";
  document.getElementById("rankResultTitle").textContent=`AIR ${fmt(air)} · ${PATHS[state.counselling].label} · ${roundLabel(state.round)}`;
  document.getElementById("rankResultCount").textContent=`${fmt(rows.length)} historical matches · ${stateLabel} · ${categoryLabel} · ${instituteTypeLabel}`;
  const grid=document.getElementById("rankGrid");
  if(!rows.length){
    grid.innerHTML=`<div class="rank-item"><h4>No matching historical range found</h4><p>Try removing the specialty, college, state or category filter, or choose another round.</p></div>`;
    return;
  }
  grid.innerHTML=rows.map(x=>{
    const close=Number(x.closing_rank), buffer=close-air;
    return `<article class="rank-item">
      <span class="tag">${buffer>=0?"HISTORICALLY REACHABLE":"NEAR RANGE"}</span>
      <h4>${esc(x._course||"Course not available")}</h4>
      <p>${esc(x._college||"Institute not available")}${deriveCollegeState(x)?` · ${esc(deriveCollegeState(x))}`:""}${x.category_clean&&x.category_clean!=="OTHER"?` · ${esc(x.category_clean)}`:""}</p>
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
  trackEvent("explore_search", {
    counselling: state.counselling, round: state.round,
    college: document.getElementById("searchCollege").value.trim(),
    course: document.getElementById("searchCourse").value.trim(),
    max_air: Number(document.getElementById("searchMaxAir").value)||0
  });
  const college=norm(document.getElementById("searchCollege").value);
  const course=norm(document.getElementById("searchCourse").value);
  const maxAir=Number(document.getElementById("searchMaxAir").value)||Infinity;
  let rows=currentAllotments().filter(x=>Number(x.rank_value)<=maxAir);
  if(college) rows=rows.filter(x=>collegeMatches(x,college));
  if(course) rows=rows.filter(x=>norm(x._course||"").includes(course));
  rows.sort((a,b)=>Number(a.rank_value)-Number(b.rank_value));
  rows=rows.slice(0,250);
  document.getElementById("exploreMeta").textContent=`${fmt(rows.length)} records shown · max 250`;
  document.getElementById("exploreBody").innerHTML=rows.length?rows.map(x=>`<tr>
    <td>${fmt(x.rank_value)}</td><td>${esc(x._college||"—")}</td><td>${esc(x._course||"—")}</td>
    <td>${esc(x.category)}</td><td>${esc(x.quota)}</td><td>${esc(x.seat_type)}</td>
  </tr>`).join(""):`<tr><td colspan="6">No records found for the selected filters.</td></tr>`;
}
function clearExplore(){
  document.getElementById("exploreMeta").textContent="Search to view records";
  document.getElementById("exploreBody").innerHTML=`<tr><td colspan="6">Enter a college, specialty or AIR limit and search.</td></tr>`;
}

function runMovement(){
  trackEvent("movement_search", {
    counselling: state.counselling,
    round: state.round,
    college: document.getElementById("moveCollege").value.trim(),
    course: document.getElementById("moveCourse").value.trim()
  });

  const selectedCollege=norm(document.getElementById("moveCollege").value);
  const selectedCourse=norm(document.getElementById("moveCourse").value);

  // Rebuild movement from the cleaned allotment rows instead of the old movement
  // CSV. The extracted AIQ movement table contains many page-fragment/concatenated
  // institute names (for example ".154" and "Page No. 1545 ..."), so using it as
  // the autocomplete source makes the UI unreliable. Allotment rows have the
  // round-level AIR needed to calculate opening, closing and observed count.
  const eligible=state.allotments.filter(x=>{
    if(!x._college || !x._course) return false;
    const status=norm(x.status||"");
    if(/NOT ALLOTTED|NO ALLOTMENT|FRESH ALLOTTED IN/.test(status)) return false;
    if(selectedCollege && !collegeMatches(x,selectedCollege)) return false;
    if(selectedCourse && !norm(x._course).includes(selectedCourse)) return false;
    return Number(x.rank_value)>0;
  });

  const groups=new Map();
  for(const x of eligible){
    const key=`${x.round}|${x._college}|${x._course}`;
    const rank=Number(x.rank_value);
    const g=groups.get(key)||{round:x.round,college:x._college,course:x._course,count:0,opening:Infinity,closing:-Infinity};
    g.count+=1; g.opening=Math.min(g.opening,rank); g.closing=Math.max(g.closing,rank);
    groups.set(key,g);
  }

  const byCollegeCourse=new Map();
  for(const g of groups.values()){
    const key=`${g.college}|${g.course}`;
    const row=byCollegeCourse.get(key)||{_college:g.college,_course:g.course};
    row[`allotment_count_${g.round}`]=g.count;
    row[`opening_rank_${g.round}`]=g.opening;
    row[`closing_rank_${g.round}`]=g.closing;
    byCollegeCourse.set(key,row);
  }

  const rows=[...byCollegeCourse.values()].filter(x=>
    (!selectedCollege||collegeMatches(x,selectedCollege)) &&
    (!selectedCourse||norm(x._course).includes(selectedCourse))
  );

  if(!rows.length){
    document.getElementById("movementResults").hidden=true;
    document.getElementById("movementEmpty").hidden=false;
    document.getElementById("movementEmpty").textContent="No matching historical movement found. Try a broader college or course name.";
    return;
  }

  const x=rows.sort((a,b)=>{
    const ac=norm(a._college), bc=norm(b._college);
    return ac.localeCompare(bc,"en",{sensitivity:"base"});
  })[0];

  document.getElementById("movementEmpty").hidden=true;
  document.getElementById("movementResults").hidden=false;
  document.getElementById("movementTitle").textContent=`${x._college||"Institute not available"} · ${x._course||"Course not available"}`;
  const rounds=[["R1","Round 1"],["R2","Round 2"],["R3","Round 3"],["STRAY","Stray"]];
  document.getElementById("movementRow").innerHTML=rounds.map(([r,label])=>{
    const o=x[`opening_rank_${r}`], c=x[`closing_rank_${r}`];
    return `<div class="move-box"><small>${label}</small><strong>${Number.isFinite(o)&&Number.isFinite(c)?`${fmt(o)} – ${fmt(c)}`:"—"}</strong><span>${x[`allotment_count_${r}`]?fmt(x[`allotment_count_${r}`])+" allotments":"No observed data"}</span></div>`;
  }).join("");
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

document.getElementById("counselling").addEventListener("change",async e=>{
  state.counselling=e.target.value; state.round="R1";
  trackEvent("counselling_change", {counselling: state.counselling});
  await loadDataset();
});
document.getElementById("round").addEventListener("change",e=>{
  state.round=e.target.value;
  trackEvent("round_change", {counselling: state.counselling, round: state.round});
  populateRankStateOptions();
  populateRankCourseOptions();
  populateCollegeOptions();
  populateCourseDatalist();
  document.getElementById("exploreStatus").textContent=`${PATHS[state.counselling].label} · ${roundLabel(state.round)}`;
  clearExplore();
});
document.getElementById("rankState").addEventListener("change",()=>{});
document.getElementById("rankCategory").addEventListener("change",()=>{});
document.getElementById("rankInstituteType").addEventListener("change",()=>{});
document.getElementById("rankSearch").addEventListener("click",runRank);
document.getElementById("exploreSearch").addEventListener("click",runExplore);
document.getElementById("moveSearch").addEventListener("click",runMovement);
document.querySelectorAll(".chips button").forEach(b=>b.addEventListener("click",()=>{
  document.getElementById("searchCourse").value=b.dataset.course; runExplore();
}));
document.getElementById("myRank").addEventListener("keydown",e=>{if(e.key==="Enter")runRank()});
document.getElementById("rankCourse").addEventListener("keydown",e=>{if(e.key==="Enter")runRank()});
document.getElementById("rankCollege").addEventListener("keydown",e=>{if(e.key==="Enter")runRank()});

setupCollegeAutocomplete("rankCollege","rankCollegeMenu");
setupCollegeAutocomplete("searchCollege","searchCollegeMenu");
setupCollegeAutocomplete("moveCollege","moveCollegeMenu");

function feedbackContext(){
  const counselling = document.getElementById("counselling")?.selectedOptions?.[0]?.textContent || "—";
  const round = document.getElementById("round")?.selectedOptions?.[0]?.textContent || "—";
  const stateLabel = document.getElementById("rankState")?.selectedOptions?.[0]?.textContent || "All college states";
  const category = document.getElementById("rankCategory")?.selectedOptions?.[0]?.textContent || "All categories";
  const instituteType = document.getElementById("rankInstituteType")?.selectedOptions?.[0]?.textContent || "All institutes";
  const course = document.getElementById("rankCourse")?.selectedOptions?.[0]?.textContent || "All courses";
  const college = document.getElementById("rankCollege")?.value?.trim() || "All colleges";
  const air = document.getElementById("myRank")?.value?.trim() || "—";
  return `AIR ${air} · ${counselling} · ${round} · ${stateLabel} · ${category} · ${instituteType} · ${course} · ${college}`;
}

function openFeedback(){
  trackEvent("feedback_open", analyticsContext());
  const modal=document.getElementById("feedbackModal");
  document.getElementById("feedbackContext").textContent=feedbackContext();
  document.getElementById("feedbackStatus").textContent="";
  modal.hidden=false;
  setTimeout(()=>document.getElementById("feedbackObserved")?.focus(),50);
}
function closeFeedback(){ document.getElementById("feedbackModal").hidden=true; }
function feedbackMessage(){
  const type=document.getElementById("feedbackType").value;
  const observed=document.getElementById("feedbackObserved").value.trim();
  const expected=document.getElementById("feedbackExpected").value.trim();
  const email=document.getElementById("feedbackEmail").value.trim();
  return `SeatMentor data issue report\n\nIssue type: ${type}\nContext: ${feedbackContext()}\n\nWhat the user saw:\n${observed || "Not provided"}\n\nExpected / correction:\n${expected || "Not provided"}\n\nUser email: ${email || "Not provided"}`;
}
async function submitFeedback(){
  const observed=document.getElementById("feedbackObserved").value.trim();
  const status=document.getElementById("feedbackStatus");
  const button=document.getElementById("feedbackSubmit");
  if(!observed){ status.textContent="Please describe the issue first."; return; }
  button.disabled=true; status.textContent="Sending report…";
  try{
    const payload={
      subject:`SeatMentor · ${document.getElementById("feedbackType").value}`,
      issue_type:document.getElementById("feedbackType").value,
      context:feedbackContext(),
      observed,
      expected:document.getElementById("feedbackExpected").value.trim(),
      email:document.getElementById("feedbackEmail").value.trim()
    };
    trackEvent("feedback_submit", {
      issue_type: payload.issue_type,
      counselling: document.getElementById("counselling")?.value || "",
      round: document.getElementById("round")?.value || ""
    });
    if(FORM_ENDPOINT){
      const res=await fetch(FORM_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      status.textContent="Thanks — your report has been sent.";
      setTimeout(closeFeedback,900);
    }else{
      const params=new URLSearchParams({title:`SeatMentor data issue · ${payload.issue_type}`,body:feedbackMessage()});
      window.open(`${GITHUB_ISSUE_URL}?${params.toString()}`,"_blank","noopener");
      status.textContent="A pre-filled GitHub report page has been opened. Submit it there.";
    }
  }catch(err){
    console.error(err);
    status.textContent="Could not send automatically. Please try again.";
  }finally{
    button.disabled=false;
  }
}

document.getElementById("feedbackOpen").addEventListener("click",openFeedback);
document.getElementById("feedbackClose").addEventListener("click",closeFeedback);
document.getElementById("feedbackCancel").addEventListener("click",closeFeedback);
document.querySelectorAll("[data-close-feedback]").forEach(el=>el.addEventListener("click",closeFeedback));
document.getElementById("feedbackSubmit").addEventListener("click",submitFeedback);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!document.getElementById("feedbackModal").hidden)closeFeedback()});

loadDataset();
