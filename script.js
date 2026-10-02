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
    const cRes = await Promise.allSettled([loadCSV(p.cutoff)]);
    const c = cRes[0].status === "fulfilled" ? cRes[0].value : [];
    state.allotments=normalizeDataset(a); state.cutoffs=c.map(normalizeRecord); state.movement=[]; state.loaded=true;
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
// Final candidate-facing college master. Autocomplete is built ONLY from these
// vetted institute names; raw PDF cells are never displayed as college options.
const CANONICAL_COLLEGE_MASTER = {
  "AIQ": [
    {
      "name": "Seth Gordhandas Sunderdas Medical College, MUMBAI",
      "aliases": [
        "Seth Gordhandas Sunderdas Medical College, MUMBAI"
      ]
    },
    {
      "name": "Acharya Harihar Post Graduate Institute of Cancer, Cuttack",
      "aliases": [
        "Acharya Harihar Post Graduate Institute of Cancer, Cuttack"
      ]
    },
    {
      "name": "ACSR GOVERNMENT MEDICAL COLLEGE,NELLORE",
      "aliases": [
        "ACSR GOVERNMENT MEDICAL COLLEGE,NELLORE"
      ]
    },
    {
      "name": "Agartala Government Medical College",
      "aliases": [
        "Agartala Government Medical College"
      ]
    },
    {
      "name": "All India Institute of Hygiene and Public Health",
      "aliases": [
        "All India Institute of Hygiene and Public Health"
      ]
    },
    {
      "name": "All India Institute of Physical Medicine and Rehabilitation",
      "aliases": [
        "All India Institute of Physical Medicine and Rehabilitation"
      ]
    },
    {
      "name": "Andhra Medical College",
      "aliases": [
        "Andhra Medical College"
      ]
    },
    {
      "name": "ANUGRAH NARAYAN MAGADH MEDICAL COLLEGE",
      "aliases": [
        "ANUGRAH NARAYAN MAGADH MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Assam Medical College",
      "aliases": [
        "Assam Medical College"
      ]
    },
    {
      "name": "Atal Bihari Vajpayee Government Medical College, Vidisha",
      "aliases": [
        "Atal Bihari Vajpayee Government Medical College, Vidisha"
      ]
    },
    {
      "name": "Autonomous State Medical College, Firozabad",
      "aliases": [
        "Autonomous State Medical College, Firozabad"
      ]
    },
    {
      "name": "AUTONOMOUS STATE MEDICAL COLLEGE, AYODHYA, Uttar Pradesh",
      "aliases": [
        "AUTONOMOUS STATE MEDICAL COLLEGE, AYODHYA, Uttar Pradesh"
      ]
    },
    {
      "name": "Autonomous State Medical College, Shahjahanpur",
      "aliases": [
        "Autonomous State Medical College, Shahjahanpur"
      ]
    },
    {
      "name": "B. J. MEDICAL COLLEGE, Ahmedabad",
      "aliases": [
        "B. J. MEDICAL COLLEGE, Ahmedabad"
      ]
    },
    {
      "name": "B.J.Government Medical College, Pune",
      "aliases": [
        "B.J.Government Medical College, Pune"
      ]
    },
    {
      "name": "Baba Raghav Das Medical College",
      "aliases": [
        "Baba Raghav Das Medical College"
      ]
    },
    {
      "name": "Bangalore Medical College and Research Institute",
      "aliases": [
        "Bangalore Medical College and Research Institute"
      ]
    },
    {
      "name": "Bankura Sammilani Medical College",
      "aliases": [
        "Bankura Sammilani Medical College"
      ]
    },
    {
      "name": "BHOPAL MEMORIAL HOSPITAL AND RESEARCH CENTRE, BHOPAL",
      "aliases": [
        "BHOPAL MEMORIAL HOSPITAL AND RESEARCH CENTRE, BHOPAL"
      ]
    },
    {
      "name": "BIDAR INSTITUTE OF MEDICAL SCIENCES, BIDAR",
      "aliases": [
        "BIDAR INSTITUTE OF MEDICAL SCIENCES, BIDAR"
      ]
    },
    {
      "name": "BPS Govt. Medical College for Women, Khanpur Kalan Sonepat",
      "aliases": [
        "BPS Govt. Medical College for Women, Khanpur Kalan Sonepat"
      ]
    },
    {
      "name": "Burdwan Medical College, West Bengal",
      "aliases": [
        "Burdwan Medical College, West Bengal"
      ]
    },
    {
      "name": "CALCUTTA NATIONAL MEDICAL COLLEGE",
      "aliases": [
        "CALCUTTA NATIONAL MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Calcutta School Of Tropical Medicine",
      "aliases": [
        "Calcutta School Of Tropical Medicine"
      ]
    },
    {
      "name": "Central Institute of Psychiatry, Ranchi",
      "aliases": [
        "Central Institute of Psychiatry, Ranchi"
      ]
    },
    {
      "name": "Chacha Nehru Bal Chikitsalaya",
      "aliases": [
        "Chacha Nehru Bal Chikitsalaya"
      ]
    },
    {
      "name": "Chamarajanagar Institute of Medical Sciences, Karnataka",
      "aliases": [
        "Chamarajanagar Institute of Medical Sciences, Karnataka"
      ]
    },
    {
      "name": "CHENGALPATTU MEDICAL COLLEGE, CHENGALPATTU",
      "aliases": [
        "CHENGALPATTU MEDICAL COLLEGE, CHENGALPATTU"
      ]
    },
    {
      "name": "CHHATTISGARH INSTITUTE OF MEDICAL SCIENCES",
      "aliases": [
        "CHHATTISGARH INSTITUTE OF MEDICAL SCIENCES"
      ]
    },
    {
      "name": "Chittaranjan National Cancer Institute, 37-",
      "aliases": [
        "Chittaranjan National Cancer Institute, 37-"
      ]
    },
    {
      "name": "Chittaranjan Seva Sadan Hospital",
      "aliases": [
        "Chittaranjan Seva Sadan Hospital"
      ]
    },
    {
      "name": "COIMBATORE MEDICAL COLLEGE",
      "aliases": [
        "COIMBATORE MEDICAL COLLEGE"
      ]
    },
    {
      "name": "College of Medicine & Sagore Dutta Hospital",
      "aliases": [
        "College of Medicine & Sagore Dutta Hospital"
      ]
    },
    {
      "name": "College of Medicine and JNM Hospital, WBUHS",
      "aliases": [
        "College of Medicine and JNM Hospital, WBUHS"
      ]
    },
    {
      "name": "DARBHANGA MEDICAL COLLEGE",
      "aliases": [
        "DARBHANGA MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Dharwad Institute of Mental Health and Neurosciences (DIMHANS)",
      "aliases": [
        "Dharwad Institute of Mental Health and Neurosciences (DIMHANS)"
      ]
    },
    {
      "name": "Dr Ram Manohar Lohia Institute of Medical Sciences, Lucknow",
      "aliases": [
        "Dr Ram Manohar Lohia Institute of Medical Sciences, Lucknow"
      ]
    },
    {
      "name": "Dr. B. C. Roy Post Graduate Institute of Paediatric Sciences",
      "aliases": [
        "Dr. B. C. Roy Post Graduate Institute of Paediatric Sciences"
      ]
    },
    {
      "name": "Dr. Rajendra Prasad Government Medical College, Tanda",
      "aliases": [
        "Dr. Rajendra Prasad Government Medical College, Tanda"
      ]
    },
    {
      "name": "Dr. Sampurnanand Medical College (SNMC), JODHPUR",
      "aliases": [
        "Dr. Sampurnanand Medical College (SNMC), JODHPUR"
      ]
    },
    {
      "name": "DR. SHANKARRAO CHAVAN GOVERNMENT MEDICAL COLLEGE, NANDED",
      "aliases": [
        "DR. SHANKARRAO CHAVAN GOVERNMENT MEDICAL COLLEGE, NANDED"
      ]
    },
    {
      "name": "Dr. Yashwant Singh Parmar Government Medical College Nahan",
      "aliases": [
        "Dr. Yashwant Singh Parmar Government Medical College Nahan"
      ]
    },
    {
      "name": "Dr.B.Borooah Cancer Institute",
      "aliases": [
        "Dr.B.Borooah Cancer Institute"
      ]
    },
    {
      "name": "Dr.V.M.Govt.Medical College,Solapur, Maharasthtra",
      "aliases": [
        "Dr.V.M.Govt.Medical College,Solapur, Maharasthtra"
      ]
    },
    {
      "name": "EMPLOYEES STATE INSURANCE CORPORATION MEDICAL COLLEGE AND PGIMSR",
      "aliases": [
        "EMPLOYEES STATE INSURANCE CORPORATION MEDICAL COLLEGE AND PGIMSR"
      ]
    },
    {
      "name": "Employees' State Insurance Corporation Medical College & Hospital, Gulbarga",
      "aliases": [
        "Employees' State Insurance Corporation Medical College & Hospital, Gulbarga"
      ]
    },
    {
      "name": "ESI-POST GRADUATE INSTITUTE OF MEDICAL SCIENCES AND RESEARCH, BASAIDARAPUR, NEW DELHI",
      "aliases": [
        "ESI-POST GRADUATE INSTITUTE OF MEDICAL SCIENCES AND RESEARCH, BASAIDARAPUR, NEW DELHI"
      ]
    },
    {
      "name": "ESIC Medical College & Hospital, Faridabad",
      "aliases": [
        "ESIC Medical College & Hospital, Faridabad"
      ]
    },
    {
      "name": "ESIC Medical College and PGIMSR",
      "aliases": [
        "ESIC Medical College and PGIMSR"
      ]
    },
    {
      "name": "ESIC Medical College, Hyderbad",
      "aliases": [
        "ESIC Medical College, Hyderbad"
      ]
    },
    {
      "name": "ESIC MEDICAL COLLEGE, JOKA",
      "aliases": [
        "ESIC MEDICAL COLLEGE, JOKA"
      ]
    },
    {
      "name": "Fakhruddin Ali Ahmed Medical College",
      "aliases": [
        "Fakhruddin Ali Ahmed Medical College"
      ]
    },
    {
      "name": "GADAG INSTITUTE OF MEDICAL SCIENCES GADAG",
      "aliases": [
        "GADAG INSTITUTE OF MEDICAL SCIENCES GADAG"
      ]
    },
    {
      "name": "GAJRA RAJA MEDICAL COLLEGE GWALIOR",
      "aliases": [
        "GAJRA RAJA MEDICAL COLLEGE GWALIOR"
      ]
    },
    {
      "name": "GANDHI MEDICAL COLLEGE",
      "aliases": [
        "GANDHI MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Gandhi Medical College, Bhopal",
      "aliases": [
        "Gandhi Medical College, Bhopal"
      ]
    },
    {
      "name": "Ganesh Shankar Vidyarthi Memorial Medical College",
      "aliases": [
        "Ganesh Shankar Vidyarthi Memorial Medical College"
      ]
    },
    {
      "name": "Gauhati Medical College, Guwahati",
      "aliases": [
        "Gauhati Medical College, Guwahati"
      ]
    },
    {
      "name": "GMC Bharat Ratna Late Shri Atal Bihari Vajpayee Memorial Medical College, Chhattisgarh",
      "aliases": [
        "GMC Bharat Ratna Late Shri Atal Bihari Vajpayee Memorial Medical College, Chhattisgarh"
      ]
    },
    {
      "name": "GOA MEDICAL COLLEGE",
      "aliases": [
        "GOA MEDICAL COLLEGE"
      ]
    },
    {
      "name": "GOVERNMENT DHARMAPURI MEDICAL COLLEGE, DHARMAPURI, TAMIL NADU",
      "aliases": [
        "GOVERNMENT DHARMAPURI MEDICAL COLLEGE, DHARMAPURI, TAMIL NADU"
      ]
    },
    {
      "name": "Government Erode Medical College- Formerly IRT- Perundurai Medical College",
      "aliases": [
        "Government Erode Medical College- Formerly IRT- Perundurai Medical College"
      ]
    },
    {
      "name": "Government Institute of Medical Sciences, Greater Noida, Uttar Pradesh",
      "aliases": [
        "Government Institute of Medical Sciences, Greater Noida, Uttar Pradesh"
      ]
    },
    {
      "name": "Government Kilpauk Medical College",
      "aliases": [
        "Government Kilpauk Medical College"
      ]
    },
    {
      "name": "Government Medical College & Hospital, Budaun, Uttar Pradesh",
      "aliases": [
        "Government Medical College & Hospital, Budaun, Uttar Pradesh"
      ]
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE - KANNUR",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE - KANNUR"
      ]
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE AND ESIC HOSPITAL, COIMBATORE",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE AND ESIC HOSPITAL, COIMBATORE"
      ]
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE CHANDRAPUR, MAHARASHTRA",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE CHANDRAPUR, MAHARASHTRA"
      ]
    },
    {
      "name": "Government Medical College Hospital, Manjeri",
      "aliases": [
        "Government Medical College Hospital, Manjeri"
      ]
    },
    {
      "name": "Government Medical College Hospital, Omandurar",
      "aliases": [
        "Government Medical College Hospital, Omandurar"
      ]
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE KADAPA (FORMERLY RAJIV GANDHI INSTITUTE OF MEDICAL SCIENCES, KADAPA)",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE KADAPA (FORMERLY RAJIV GANDHI INSTITUTE OF MEDICAL SCIENCES, KADAPA)"
      ]
    },
    {
      "name": "Government Medical College Kannauj , Uttar Pradesh",
      "aliases": [
        "Government Medical College Kannauj , Uttar Pradesh"
      ]
    },
    {
      "name": "Government Medical College Kota",
      "aliases": [
        "Government Medical College Kota"
      ]
    },
    {
      "name": "Government Medical College Kozhikode",
      "aliases": [
        "Government Medical College Kozhikode"
      ]
    },
    {
      "name": "Government medical college patiala.",
      "aliases": [
        "Government medical college patiala."
      ]
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE SHAHDOL",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE SHAHDOL"
      ]
    },
    {
      "name": "Government Medical College Srinagar",
      "aliases": [
        "Government Medical College Srinagar"
      ]
    },
    {
      "name": "Government Medical College Suryapet Telangana",
      "aliases": [
        "Government Medical College Suryapet Telangana"
      ]
    },
    {
      "name": "Government Medical College, Aurangabad",
      "aliases": [
        "Government Medical College, Aurangabad"
      ]
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, AZAMGARH",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, AZAMGARH"
      ]
    },
    {
      "name": "Government Medical College, Baramati",
      "aliases": [
        "Government Medical College, Baramati"
      ]
    },
    {
      "name": "Government Medical College, Cuddalore District",
      "aliases": [
        "Government Medical College, Cuddalore District"
      ]
    },
    {
      "name": "Government Medical College, Datia",
      "aliases": [
        "Government Medical College, Datia"
      ]
    },
    {
      "name": "Government Medical College, Dungarpur",
      "aliases": [
        "Government Medical College, Dungarpur"
      ]
    },
    {
      "name": "Government Medical College, Gondia",
      "aliases": [
        "Government Medical College, Gondia"
      ]
    },
    {
      "name": "Government Medical College, Jalgaon",
      "aliases": [
        "Government Medical College, Jalgaon"
      ]
    },
    {
      "name": "Government Medical College, Kollam",
      "aliases": [
        "Government Medical College, Kollam"
      ]
    },
    {
      "name": "Government Medical College, Latur",
      "aliases": [
        "Government Medical College, Latur"
      ]
    },
    {
      "name": "Government Medical College, Miraj",
      "aliases": [
        "Government Medical College, Miraj"
      ]
    },
    {
      "name": "Government Medical College, Nagpur",
      "aliases": [
        "Government Medical College, Nagpur"
      ]
    },
    {
      "name": "Government Medical College, Nalgonda",
      "aliases": [
        "Government Medical College, Nalgonda"
      ]
    },
    {
      "name": "Government Medical College, Nizamabad, Telangana State",
      "aliases": [
        "Government Medical College, Nizamabad, Telangana State"
      ]
    },
    {
      "name": "Government Medical College, Pali Rajasthan.",
      "aliases": [
        "Government Medical College, Pali Rajasthan."
      ]
    },
    {
      "name": "Government Medical College, Ratlam",
      "aliases": [
        "Government Medical College, Ratlam"
      ]
    },
    {
      "name": "Government Medical College, Siddipet",
      "aliases": [
        "Government Medical College, Siddipet"
      ]
    },
    {
      "name": "Government Medical College, Surat",
      "aliases": [
        "Government Medical College, Surat"
      ]
    },
    {
      "name": "Government Medical College,Churu",
      "aliases": [
        "Government Medical College,Churu"
      ]
    },
    {
      "name": "Government Medical College,Theni",
      "aliases": [
        "Government Medical College,Theni"
      ]
    },
    {
      "name": "Government Mohan Kumaramangalam Medical College, Salem",
      "aliases": [
        "Government Mohan Kumaramangalam Medical College, Salem"
      ]
    },
    {
      "name": "Government Sivagangai Medical College and Hospital, Tamil Nadu",
      "aliases": [
        "Government Sivagangai Medical College and Hospital, Tamil Nadu"
      ]
    },
    {
      "name": "Government T D Medical College, Vandanm , Alappuzha",
      "aliases": [
        "Government T D Medical College, Vandanm , Alappuzha"
      ]
    },
    {
      "name": "Government Thiruvannamalai Medical College, Thiruvannamalai, Tamil Nadu",
      "aliases": [
        "Government Thiruvannamalai Medical College, Thiruvannamalai, Tamil Nadu"
      ]
    },
    {
      "name": "GOVERNMENT THOOTHUKUDI MEDICAL COLLEGE, THOOTHUKUDI",
      "aliases": [
        "GOVERNMENT THOOTHUKUDI MEDICAL COLLEGE, THOOTHUKUDI"
      ]
    },
    {
      "name": "GOVERNMENT VELLORE MEDICAL COLLEGE",
      "aliases": [
        "GOVERNMENT VELLORE MEDICAL COLLEGE"
      ]
    },
    {
      "name": "GOVERNMENT VILLUPURAM MEDICAL COLLEGE, VILLUPURAM",
      "aliases": [
        "GOVERNMENT VILLUPURAM MEDICAL COLLEGE, VILLUPURAM"
      ]
    },
    {
      "name": "GOVT MEDICAL COLLEGE KOTTAYAM",
      "aliases": [
        "GOVT MEDICAL COLLEGE KOTTAYAM"
      ]
    },
    {
      "name": "Govt Medical college Shivpuri",
      "aliases": [
        "Govt Medical college Shivpuri"
      ]
    },
    {
      "name": "GOVT MEDICAL COLLEGE, ANANTAPURAMU",
      "aliases": [
        "GOVT MEDICAL COLLEGE, ANANTAPURAMU"
      ]
    },
    {
      "name": "GOVT MEDICAL COLLEGE, ERNAKULAM",
      "aliases": [
        "GOVT MEDICAL COLLEGE, ERNAKULAM"
      ]
    },
    {
      "name": "GOVT MEDICAL COLLEGE,THRISSUR",
      "aliases": [
        "GOVT MEDICAL COLLEGE,THRISSUR"
      ]
    },
    {
      "name": "Govt. Bundelkhand Medical College Sagar M.P.",
      "aliases": [
        "Govt. Bundelkhand Medical College Sagar M.P."
      ]
    },
    {
      "name": "Govt. Doon Medical College, Dehradun",
      "aliases": [
        "Govt. Doon Medical College, Dehradun"
      ]
    },
    {
      "name": "Govt. Medical College Akola",
      "aliases": [
        "Govt. Medical College Akola"
      ]
    },
    {
      "name": "GOVT. MEDICAL COLLEGE AND HOSPITAL, CHANDIGARH",
      "aliases": [
        "GOVT. MEDICAL COLLEGE AND HOSPITAL, CHANDIGARH"
      ]
    },
    {
      "name": "GOVT. MEDICAL COLLEGE, AMRITSAR",
      "aliases": [
        "GOVT. MEDICAL COLLEGE, AMRITSAR"
      ]
    },
    {
      "name": "Govt. Medical College, Baroda",
      "aliases": [
        "Govt. Medical College, Baroda"
      ]
    },
    {
      "name": "Govt. Medical College, Bhavnagar",
      "aliases": [
        "Govt. Medical College, Bhavnagar"
      ]
    },
    {
      "name": "Govt. Medical College, Jammu",
      "aliases": [
        "Govt. Medical College, Jammu"
      ]
    },
    {
      "name": "GOVT. MEDICAL COLLEGE, THIRUVANANTHAPURAM",
      "aliases": [
        "GOVT. MEDICAL COLLEGE, THIRUVANANTHAPURAM"
      ]
    },
    {
      "name": "Grant Medical College, Maharashtra",
      "aliases": [
        "Grant Medical College, Maharashtra"
      ]
    },
    {
      "name": "Gulbarga Institute Of Medical Sciences, Kalaburagi",
      "aliases": [
        "Gulbarga Institute Of Medical Sciences, Kalaburagi"
      ]
    },
    {
      "name": "GUNTUR MEDICAL COLLEGE",
      "aliases": [
        "GUNTUR MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Guru Gobind Singh Medical College",
      "aliases": [
        "Guru Gobind Singh Medical College"
      ]
    },
    {
      "name": "Gvernment Medical College,Haldwani",
      "aliases": [
        "Gvernment Medical College,Haldwani"
      ]
    },
    {
      "name": "Gwalior Mansik Arogyashala, Madhya Pradesh",
      "aliases": [
        "Gwalior Mansik Arogyashala, Madhya Pradesh"
      ]
    },
    {
      "name": "HASSAN INSTITUTE OF MEDICAL SCIENCES, HASSAN",
      "aliases": [
        "HASSAN INSTITUTE OF MEDICAL SCIENCES, HASSAN"
      ]
    },
    {
      "name": "HINDU RAO HOSPITAL DELHI",
      "aliases": [
        "HINDU RAO HOSPITAL DELHI"
      ]
    },
    {
      "name": "Hinduhridayasamrat Balasaheb Thackeray Medical College and Dr. R. N. Cooper Municipal General Hospital, Maharashtra",
      "aliases": [
        "Hinduhridayasamrat Balasaheb Thackeray Medical College and Dr. R. N. Cooper Municipal General Hospital, Maharashtra"
      ]
    },
    {
      "name": "HOMI BHABHA CANCER HOSPITAL, SANGRUR",
      "aliases": [
        "HOMI BHABHA CANCER HOSPITAL, SANGRUR"
      ]
    },
    {
      "name": "Homi Bhabha Cancer Hospital, Varanasi",
      "aliases": [
        "Homi Bhabha Cancer Hospital, Varanasi"
      ]
    },
    {
      "name": "INDIRA GANDHI GOVT.MEDICAL COLLEGE NAGPUR",
      "aliases": [
        "INDIRA GANDHI GOVT.MEDICAL COLLEGE NAGPUR"
      ]
    },
    {
      "name": "INDIRA GANDHI INSTITUTE OF CHILD HEALTH, BANGALORE",
      "aliases": [
        "INDIRA GANDHI INSTITUTE OF CHILD HEALTH, BANGALORE"
      ]
    },
    {
      "name": "Indira Gandhi Institute of Medical Sciences, Patna",
      "aliases": [
        "Indira Gandhi Institute of Medical Sciences, Patna"
      ]
    },
    {
      "name": "INDIRA GANDHI MEDICAL COLLEGE AND RESEARCH INSTITUTE, PUDUCHERRY",
      "aliases": [
        "INDIRA GANDHI MEDICAL COLLEGE AND RESEARCH INSTITUTE, PUDUCHERRY"
      ]
    },
    {
      "name": "Indira Gandhi Medical College Shimla",
      "aliases": [
        "Indira Gandhi Medical College Shimla"
      ]
    },
    {
      "name": "Institute of Child Health, Kolkata",
      "aliases": [
        "Institute of Child Health, Kolkata"
      ]
    },
    {
      "name": "Institute of integrated Medical Sciences (Govt.Medical College), Palakkad",
      "aliases": [
        "Institute of integrated Medical Sciences (Govt.Medical College), Palakkad"
      ]
    },
    {
      "name": "INSTITUTE OF MEDICAL SCIENCES, BANARAS HINDU UNIVERSITY",
      "aliases": [
        "INSTITUTE OF MEDICAL SCIENCES, BANARAS HINDU UNIVERSITY"
      ]
    },
    {
      "name": "INSTITUTE OF MENTAL HEALTH AND HOSPITAL, AGRA",
      "aliases": [
        "INSTITUTE OF MENTAL HEALTH AND HOSPITAL, AGRA"
      ]
    },
    {
      "name": "Institute of Nuclear Medicine & Allied Sciences",
      "aliases": [
        "Institute of Nuclear Medicine & Allied Sciences"
      ]
    },
    {
      "name": "IPGME&R and SSKM Hospital Kolkata",
      "aliases": [
        "IPGME&R and SSKM Hospital Kolkata"
      ]
    },
    {
      "name": "JAWAHAR LAL NEHRU MEDICAL COLLEGE, AJMER",
      "aliases": [
        "JAWAHAR LAL NEHRU MEDICAL COLLEGE, AJMER"
      ]
    },
    {
      "name": "JAWAHARLAL NEHRU MEDICAL COLLEGE, ALIGARH MUSLIM UNIVERSITY STATE UTTAR",
      "aliases": [
        "JAWAHARLAL NEHRU MEDICAL COLLEGE, ALIGARH MUSLIM UNIVERSITY STATE UTTAR"
      ]
    },
    {
      "name": "JAWAHARLAL NEHRU MEDICAL COLLEGE, BHAGALPUR",
      "aliases": [
        "JAWAHARLAL NEHRU MEDICAL COLLEGE, BHAGALPUR"
      ]
    },
    {
      "name": "JHALAWAR MEDICAL COLLEGE",
      "aliases": [
        "JHALAWAR MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Jorhat Medical College & Hospital",
      "aliases": [
        "Jorhat Medical College & Hospital"
      ]
    },
    {
      "name": "K.A.P.Viswanatham Government Medical College, Tiruchirapalli",
      "aliases": [
        "K.A.P.Viswanatham Government Medical College, Tiruchirapalli"
      ]
    },
    {
      "name": "Kakatiya Medical College",
      "aliases": [
        "Kakatiya Medical College"
      ]
    },
    {
      "name": "Kalpana Chawla Govt Medical College, Karnal, Haryana",
      "aliases": [
        "Kalpana Chawla Govt Medical College, Karnal, Haryana"
      ]
    },
    {
      "name": "KANYAKUMARI GOVERNMENT MEDICAL COLLEGE",
      "aliases": [
        "KANYAKUMARI GOVERNMENT MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Karnataka Medical College and Research Institute, Hubballi",
      "aliases": [
        "Karnataka Medical College and Research Institute, Hubballi"
      ]
    },
    {
      "name": "Karwar Institute of Medical Sciences, Karnataka",
      "aliases": [
        "Karwar Institute of Medical Sciences, Karnataka"
      ]
    },
    {
      "name": "Kidwai Memorial Institute of Oncolgy",
      "aliases": [
        "Kidwai Memorial Institute of Oncolgy"
      ]
    },
    {
      "name": "KING GEORGES MEDICAL UNIVERSITY",
      "aliases": [
        "KING GEORGES MEDICAL UNIVERSITY"
      ]
    },
    {
      "name": "Kodagu Institute of Medical Sciences, Karnataka",
      "aliases": [
        "Kodagu Institute of Medical Sciences, Karnataka"
      ]
    },
    {
      "name": "Koppal Institute of Medical Sciences Koppal, Karnataka",
      "aliases": [
        "Koppal Institute of Medical Sciences Koppal, Karnataka"
      ]
    },
    {
      "name": "KURNOOL MEDICAL COLLEGE",
      "aliases": [
        "KURNOOL MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Lady Hardinge Medical College",
      "aliases": [
        "Lady Hardinge Medical College"
      ]
    },
    {
      "name": "Lala Lajpat Rai Memorial Medical College, MEERUT",
      "aliases": [
        "Lala Lajpat Rai Memorial Medical College, MEERUT"
      ]
    },
    {
      "name": "Late Baliram Kashyap Memorial Govt Medical Dimrapal",
      "aliases": [
        "Late Baliram Kashyap Memorial Govt Medical Dimrapal"
      ]
    },
    {
      "name": "LATE SHRI LAKHI RAM AGRAWAL MEMORIAL GOVT.MEDICAL COLLEGE",
      "aliases": [
        "LATE SHRI LAKHI RAM AGRAWAL MEMORIAL GOVT.MEDICAL COLLEGE"
      ]
    },
    {
      "name": "LOKMANYA TILAK MEDICAL COLLEGE MUMBAI",
      "aliases": [
        "LOKMANYA TILAK MEDICAL COLLEGE MUMBAI"
      ]
    },
    {
      "name": "Lokopriya Gopinath Bordoloi Regional Institute of Mental Health",
      "aliases": [
        "Lokopriya Gopinath Bordoloi Regional Institute of Mental Health"
      ]
    },
    {
      "name": "M. P. SHAH GOVERNMENT MEDICAL COLLEGE",
      "aliases": [
        "M. P. SHAH GOVERNMENT MEDICAL COLLEGE"
      ]
    },
    {
      "name": "MADRAS MEDICAL COLLEGE",
      "aliases": [
        "MADRAS MEDICAL COLLEGE"
      ]
    },
    {
      "name": "MADURAI MEDICAL COLLEGE",
      "aliases": [
        "MADURAI MEDICAL COLLEGE"
      ]
    },
    {
      "name": "MahaMaya Rajkiya Allopathic Medical College",
      "aliases": [
        "MahaMaya Rajkiya Allopathic Medical College"
      ]
    },
    {
      "name": "Maharaja Krushna Chandra Gajapati Medical College , Brahmapur",
      "aliases": [
        "Maharaja Krushna Chandra Gajapati Medical College , Brahmapur"
      ]
    },
    {
      "name": "Maharaja Suhel Dev Autonomous State Medical College & Mahrishi Balark Hospitals, Bahraich, Uttar Pradesh",
      "aliases": [
        "Maharaja Suhel Dev Autonomous State Medical College & Mahrishi Balark Hospitals, Bahraich, Uttar Pradesh"
      ]
    },
    {
      "name": "MAHARANI LAXMI BAI MEDICAL COLLEGE JHANSI",
      "aliases": [
        "MAHARANI LAXMI BAI MEDICAL COLLEGE JHANSI"
      ]
    },
    {
      "name": "Maharashtra Post Graduate Institute of Medical Education and Research, Nashik",
      "aliases": [
        "Maharashtra Post Graduate Institute of Medical Education and Research, Nashik"
      ]
    },
    {
      "name": "Maharshi Devraha Baba Autonomous State Medical College, Deoria, Uttar Pradesh",
      "aliases": [
        "Maharshi Devraha Baba Autonomous State Medical College, Deoria, Uttar Pradesh"
      ]
    },
    {
      "name": "MAHARSHI VASISHTHA AUTONOMOUS STATE MEDICAL COLLEGE BASTI",
      "aliases": [
        "MAHARSHI VASISHTHA AUTONOMOUS STATE MEDICAL COLLEGE BASTI"
      ]
    },
    {
      "name": "Mahatma Gandhi Institute of Medical Sciences, Wardha",
      "aliases": [
        "Mahatma Gandhi Institute of Medical Sciences, Wardha"
      ]
    },
    {
      "name": "Mahatma Gandhi Memorial Medical College, Indore",
      "aliases": [
        "Mahatma Gandhi Memorial Medical College, Indore"
      ]
    },
    {
      "name": "Mahatma Gandhi Memorial Medical College, Jamshedpur",
      "aliases": [
        "Mahatma Gandhi Memorial Medical College, Jamshedpur"
      ]
    },
    {
      "name": "MALDA MEDICAL COLLEGE",
      "aliases": [
        "MALDA MEDICAL COLLEGE"
      ]
    },
    {
      "name": "MANDYA INSTITUTE OF MEDICAL SCIENCES",
      "aliases": [
        "MANDYA INSTITUTE OF MEDICAL SCIENCES"
      ]
    },
    {
      "name": "Maulana Azad Medical College",
      "aliases": [
        "Maulana Azad Medical College"
      ]
    },
    {
      "name": "MEDICAL COLLEGE, KOLKATA",
      "aliases": [
        "MEDICAL COLLEGE, KOLKATA"
      ]
    },
    {
      "name": "Midnapore Medical College and Hospital",
      "aliases": [
        "Midnapore Medical College and Hospital"
      ]
    },
    {
      "name": "Moti Lal Nehru Medical College",
      "aliases": [
        "Moti Lal Nehru Medical College"
      ]
    },
    {
      "name": "Murshidabad Medical College and Hospital",
      "aliases": [
        "Murshidabad Medical College and Hospital"
      ]
    },
    {
      "name": "MYSORE MEDICAL COLLEGE AND RESEARCH INSTITUTE",
      "aliases": [
        "MYSORE MEDICAL COLLEGE AND RESEARCH INSTITUTE"
      ]
    },
    {
      "name": "NALANDA MEDICAL COLLEGE,PATNA",
      "aliases": [
        "NALANDA MEDICAL COLLEGE,PATNA"
      ]
    },
    {
      "name": "NAMO Medical Education and Research Institute, Dadra & Nagar Haveli & Daman & Diu",
      "aliases": [
        "NAMO Medical Education and Research Institute, Dadra & Nagar Haveli & Daman & Diu"
      ]
    },
    {
      "name": "NETAJI SUBHAS NATIONAL INSTITUTE OF SPORTS, PATIALA",
      "aliases": [
        "NETAJI SUBHAS NATIONAL INSTITUTE OF SPORTS, PATIALA"
      ]
    },
    {
      "name": "NETAJI SUBHASH CHANDRA BOSE MEDICAL COLLEGE, JABALPUR",
      "aliases": [
        "NETAJI SUBHASH CHANDRA BOSE MEDICAL COLLEGE, JABALPUR"
      ]
    },
    {
      "name": "NIL RATAN SIRCAR MEDICAL COLLEGE",
      "aliases": [
        "NIL RATAN SIRCAR MEDICAL COLLEGE"
      ]
    },
    {
      "name": "NIZAMS INSTITUTE OF MEDICAL SCIENCES",
      "aliases": [
        "NIZAMS INSTITUTE OF MEDICAL SCIENCES"
      ]
    },
    {
      "name": "North Eastern Indira Gandhi Regional Institute of Health & Medical Sciences, Shillong",
      "aliases": [
        "North Eastern Indira Gandhi Regional Institute of Health & Medical Sciences, Shillong"
      ]
    },
    {
      "name": "NSC Government Medical College, Khandwa (MP)",
      "aliases": [
        "NSC Government Medical College, Khandwa (MP)"
      ]
    },
    {
      "name": "Osmania Medical Collge",
      "aliases": [
        "Osmania Medical Collge"
      ]
    },
    {
      "name": "Pandit Bhagwat Dayal Sharma Post Graduate Institute of Medical Sciences, Rohtak",
      "aliases": [
        "Pandit Bhagwat Dayal Sharma Post Graduate Institute of Medical Sciences, Rohtak"
      ]
    },
    {
      "name": "Pandit Dindayal Upadhyay Medical College, RAJKOT",
      "aliases": [
        "Pandit Dindayal Upadhyay Medical College, RAJKOT"
      ]
    },
    {
      "name": "PATNA MEDICAL COLLEGE, PATNA",
      "aliases": [
        "PATNA MEDICAL COLLEGE, PATNA"
      ]
    },
    {
      "name": "PGIMER, DR. RML Hospital, Cannaught Place, New Delhi",
      "aliases": [
        "PGIMER, DR. RML Hospital, Cannaught Place, New Delhi"
      ]
    },
    {
      "name": "Pimpri Chichwad Municipal Corporation Postgraduate Institute Y.C.M.Hospital Pimpri,Pune 18",
      "aliases": [
        "Pimpri Chichwad Municipal Corporation Postgraduate Institute Y.C.M.Hospital Pimpri,Pune 18"
      ]
    },
    {
      "name": "Post Graduate Institute of Child Health, Noida.",
      "aliases": [
        "Post Graduate Institute of Child Health, Noida."
      ]
    },
    {
      "name": "Post Graduate Institute of Medical Education & Research and Capital Hospital ( PGIMER & CH), Odisha",
      "aliases": [
        "Post Graduate Institute of Medical Education & Research and Capital Hospital ( PGIMER & CH), Odisha"
      ]
    },
    {
      "name": "Post Graduate Institute of Medical Sciences (PGIMS),Navi Mumbai",
      "aliases": [
        "Post Graduate Institute of Medical Sciences (PGIMS),Navi Mumbai"
      ]
    },
    {
      "name": "Pt. Jawahar Lal Nehru Memorial Medical College, RAIPUR",
      "aliases": [
        "Pt. Jawahar Lal Nehru Memorial Medical College, RAIPUR"
      ]
    },
    {
      "name": "R G KAR MEDICAL COLLEGE, West Bengal",
      "aliases": [
        "R G KAR MEDICAL COLLEGE, West Bengal"
      ]
    },
    {
      "name": "Radiation Medicine Centre (RMC), Bhabha Atomic Research Centre (BARC)",
      "aliases": [
        "Radiation Medicine Centre (RMC), Bhabha Atomic Research Centre (BARC)"
      ]
    },
    {
      "name": "RAICHUR INSTITUTE OF MEDICAL SCIENCES",
      "aliases": [
        "RAICHUR INSTITUTE OF MEDICAL SCIENCES"
      ]
    },
    {
      "name": "Rajarshee Chhatrapati Shahu Maharaj Government Medical College, Kolhapur",
      "aliases": [
        "Rajarshee Chhatrapati Shahu Maharaj Government Medical College, Kolhapur"
      ]
    },
    {
      "name": "Rajendra Institute of Medical Sciences, Ranchi",
      "aliases": [
        "Rajendra Institute of Medical Sciences, Ranchi"
      ]
    },
    {
      "name": "Rajiv Gandhi Institute of Medical Sciences Srikakulam",
      "aliases": [
        "Rajiv Gandhi Institute of Medical Sciences Srikakulam"
      ]
    },
    {
      "name": "RAJIV GANDHI INSTITUTE OF MEDICAL SCIENCES",
      "aliases": [
        "RAJIV GANDHI INSTITUTE OF MEDICAL SCIENCES"
      ]
    },
    {
      "name": "RAJIV GANDHI MEDICAL COLLEGE KALWA THANE",
      "aliases": [
        "RAJIV GANDHI MEDICAL COLLEGE KALWA THANE"
      ]
    },
    {
      "name": "Rajkiya Medical College, Jalaun",
      "aliases": [
        "Rajkiya Medical College, Jalaun"
      ]
    },
    {
      "name": "Rajmata Shrimati Devendra Kumari Singhdeo Government Medical College, Ambikapur",
      "aliases": [
        "Rajmata Shrimati Devendra Kumari Singhdeo Government Medical College, Ambikapur"
      ]
    },
    {
      "name": "Rangaraya Medical College",
      "aliases": [
        "Rangaraya Medical College"
      ]
    },
    {
      "name": "Rani Durgavati Medical College, Banda",
      "aliases": [
        "Rani Durgavati Medical College, Banda"
      ]
    },
    {
      "name": "Ravindra Nath Tagore Medical College, Udaipur",
      "aliases": [
        "Ravindra Nath Tagore Medical College, Udaipur"
      ]
    },
    {
      "name": "REGIONAL CANCER CENTRE",
      "aliases": [
        "REGIONAL CANCER CENTRE"
      ]
    },
    {
      "name": "Regional Institute of Medical Sciences, Imphal",
      "aliases": [
        "Regional Institute of Medical Sciences, Imphal"
      ]
    },
    {
      "name": "Regional Institute of Ophthalmology",
      "aliases": [
        "Regional Institute of Ophthalmology"
      ]
    },
    {
      "name": "Rims Medical College, Ongole",
      "aliases": [
        "Rims Medical College, Ongole"
      ]
    },
    {
      "name": "RUHS COLLEGE OF MEDICAL SCIENCES",
      "aliases": [
        "RUHS COLLEGE OF MEDICAL SCIENCES"
      ]
    },
    {
      "name": "S.V. Medical College, Tirupathi",
      "aliases": [
        "S.V. Medical College, Tirupathi"
      ]
    },
    {
      "name": "Sanjay Gandhi Institute of Trauma and Orthopaedics",
      "aliases": [
        "Sanjay Gandhi Institute of Trauma and Orthopaedics"
      ]
    },
    {
      "name": "Sanjay Gandhi Postgarduate Institute of Medical Sciences",
      "aliases": [
        "Sanjay Gandhi Postgarduate Institute of Medical Sciences"
      ]
    },
    {
      "name": "Sardar Patel Medical College, Bikaner",
      "aliases": [
        "Sardar Patel Medical College, Bikaner"
      ]
    },
    {
      "name": "Sarojini Naidu Medical College, AGRA",
      "aliases": [
        "Sarojini Naidu Medical College, AGRA"
      ]
    },
    {
      "name": "Sawai Man Singh Medical College, JAIPUR",
      "aliases": [
        "Sawai Man Singh Medical College, JAIPUR"
      ]
    },
    {
      "name": "SDS Tuberculosis Research Centre and Rajiv Gandhi Institute of Chest Diseases",
      "aliases": [
        "SDS Tuberculosis Research Centre and Rajiv Gandhi Institute of Chest Diseases"
      ]
    },
    {
      "name": "Shaheed Hasan Khan Mewati Government Medical College",
      "aliases": [
        "Shaheed Hasan Khan Mewati Government Medical College"
      ]
    },
    {
      "name": "Shaheed Nirmal Mahto Medical College & Hospital",
      "aliases": [
        "Shaheed Nirmal Mahto Medical College & Hospital"
      ]
    },
    {
      "name": "Shaikh-Ul-Hind Maulana Mahmood Hasan Medical College, Saharanpur",
      "aliases": [
        "Shaikh-Ul-Hind Maulana Mahmood Hasan Medical College, Saharanpur"
      ]
    },
    {
      "name": "Sher-i-Kashmir Institute of Medical Sciences, Srinagar,J&K",
      "aliases": [
        "Sher-i-Kashmir Institute of Medical Sciences, Srinagar,J&K"
      ]
    },
    {
      "name": "SHIMOGA INSTITUTE OF MEDICAL SCIENCES",
      "aliases": [
        "SHIMOGA INSTITUTE OF MEDICAL SCIENCES"
      ]
    },
    {
      "name": "Shri Atal Bihari Vajpayee Medical College & Research Institute, Bengaluru",
      "aliases": [
        "Shri Atal Bihari Vajpayee Medical College & Research Institute, Bengaluru"
      ]
    },
    {
      "name": "Shri Lal Bahadur Shastri Government Medical College and Hospital",
      "aliases": [
        "Shri Lal Bahadur Shastri Government Medical College and Hospital"
      ]
    },
    {
      "name": "Shri Vasantrao Naik Govt Medical College Yavatmal",
      "aliases": [
        "Shri Vasantrao Naik Govt Medical College Yavatmal"
      ]
    },
    {
      "name": "Shrikrishna Medical College & Hospital, Muzaffarpur",
      "aliases": [
        "Shrikrishna Medical College & Hospital, Muzaffarpur"
      ]
    },
    {
      "name": "Siddhartha Medical College, Vijayawada",
      "aliases": [
        "Siddhartha Medical College, Vijayawada"
      ]
    },
    {
      "name": "Silchar Medical College, Silchar",
      "aliases": [
        "Silchar Medical College, Silchar"
      ]
    },
    {
      "name": "SJP Medical College, Bharatpur",
      "aliases": [
        "SJP Medical College, Bharatpur"
      ]
    },
    {
      "name": "Smt. G. R. Doshi and Smt. K. M. Mehta Institute of Kidney Diseases & Research Centre Dr. H. L. Trivedi Institute of Transplantation Sciences (IKDRC-ITS)",
      "aliases": [
        "Smt. G. R. Doshi and Smt. K. M. Mehta Institute of Kidney Diseases & Research Centre Dr. H. L. Trivedi Institute of Transplantation Sciences (IKDRC-ITS)"
      ]
    },
    {
      "name": "Sri Bhausaheb Hire Government Medical College",
      "aliases": [
        "Sri Bhausaheb Hire Government Medical College"
      ]
    },
    {
      "name": "Sri Venkateswara Institute of Medical Sciences (SVIMS), A State University estd. by Govt. of A.P.",
      "aliases": [
        "Sri Venkateswara Institute of Medical Sciences (SVIMS), A State University estd. by Govt. of A.P."
      ]
    },
    {
      "name": "Srirama Chandra Bhanja Medical College, CUTTACK",
      "aliases": [
        "Srirama Chandra Bhanja Medical College, CUTTACK"
      ]
    },
    {
      "name": "STANLEY MEDICAL COLLEGE",
      "aliases": [
        "STANLEY MEDICAL COLLEGE"
      ]
    },
    {
      "name": "SWAMI RAMANAND TEERTH RURAL GOVERNMENT MEDICAL COLLEGE AMBAJOGAI",
      "aliases": [
        "SWAMI RAMANAND TEERTH RURAL GOVERNMENT MEDICAL COLLEGE AMBAJOGAI"
      ]
    },
    {
      "name": "TATA MEMORIAL CENTRE, MUMBAI",
      "aliases": [
        "TATA MEMORIAL CENTRE, MUMBAI"
      ]
    },
    {
      "name": "Tezpur Medical College",
      "aliases": [
        "Tezpur Medical College"
      ]
    },
    {
      "name": "THANJAVUR MEDICAL COLLEGE, THANJAVUR",
      "aliases": [
        "THANJAVUR MEDICAL COLLEGE, THANJAVUR"
      ]
    },
    {
      "name": "Thiruvarur Govt.Medical College",
      "aliases": [
        "Thiruvarur Govt.Medical College"
      ]
    },
    {
      "name": "Tirunelveli Medical College",
      "aliases": [
        "Tirunelveli Medical College"
      ]
    },
    {
      "name": "TOPIWALA NATIONAL MEDICAL COLLEGE",
      "aliases": [
        "TOPIWALA NATIONAL MEDICAL COLLEGE"
      ]
    },
    {
      "name": "Umanath Singh Autonomous State Medical College, Jaunpur, U.P",
      "aliases": [
        "Umanath Singh Autonomous State Medical College, Jaunpur, U.P"
      ]
    },
    {
      "name": "University College of Medical Sciences",
      "aliases": [
        "University College of Medical Sciences"
      ]
    },
    {
      "name": "Uttar Pradesh University of Medical Sciences, Saifai, Etawah",
      "aliases": [
        "Uttar Pradesh University of Medical Sciences, Saifai, Etawah"
      ]
    },
    {
      "name": "Vallabhbhai Patel Chest Institute, Delhi",
      "aliases": [
        "Vallabhbhai Patel Chest Institute, Delhi"
      ]
    },
    {
      "name": "VARDHMAN INSTITUTE OF MEDICAL SCIENCES, NALANDA",
      "aliases": [
        "VARDHMAN INSTITUTE OF MEDICAL SCIENCES, NALANDA"
      ]
    },
    {
      "name": "Vardhman Mahavir Medical College, , New Delhi",
      "aliases": [
        "Vardhman Mahavir Medical College, , New Delhi"
      ]
    },
    {
      "name": "Veer Chandra Singh Garhwali Govt. Institute of Medical Science & Research",
      "aliases": [
        "Veer Chandra Singh Garhwali Govt. Institute of Medical Science & Research"
      ]
    },
    {
      "name": "VIJANAGARA INSTITUTE OF MEDICAL SCIENCES BALLARI",
      "aliases": [
        "VIJANAGARA INSTITUTE OF MEDICAL SCIENCES BALLARI"
      ]
    },
    {
      "name": "VSS INSTITUTE OF MEDICAL SCIENCES AND RESEARCH,BURLA",
      "aliases": [
        "VSS INSTITUTE OF MEDICAL SCIENCES AND RESEARCH,BURLA"
      ]
    }
  ],
  "UP": [
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, AYODHYA",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, AYODHYA"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, BAHRAICH",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, BAHRAICH"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, BASTI",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, BASTI"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, DEORIA",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, DEORIA"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, FATEHPUR",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, FATEHPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, FIROZABAD",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, FIROZABAD"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, HARDOI",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, HARDOI"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, JAUNPUR",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, JAUNPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, MIRZAPUR",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, MIRZAPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, SHAHJAHANPUR",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, SHAHJAHANPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "AUTONOMOUS MEDICAL COLLEGE, SIDDHARTHNAGAR",
      "aliases": [
        "AUTONOMOUS MEDICAL COLLEGE, SIDDHARTHNAGAR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "BABA RAGHAV DAS MEDICAL COLLEGE, GORAKHPUR",
      "aliases": [
        "BABA RAGHAV DAS MEDICAL COLLEGE, GORAKHPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "DR. RAM MANOHAR LOHIA INSTITUTE OF MEDICAL SCIENCES, LUCKNOW",
      "aliases": [
        "DR. RAM MANOHAR LOHIA INSTITUTE OF MEDICAL SCIENCES, LUCKNOW"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GANESH SHANKAR VIDYARTHI MEMORIAL MEDICAL COLLEGE, KANPUR",
      "aliases": [
        "GANESH SHANKAR VIDYARTHI MEMORIAL MEDICAL COLLEGE, KANPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT INSTITUTE OF MEDICAL SCIENCES, GREATER NOIDA",
      "aliases": [
        "GOVERNMENT INSTITUTE OF MEDICAL SCIENCES, GREATER NOIDA"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, AMBEDKAR NAGAR",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, AMBEDKAR NAGAR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, AZAMGARH",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, AZAMGARH"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, BADAUN",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, BADAUN"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, BANDA",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, BANDA"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, JALAUN",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, JALAUN"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, KANNAUJ",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, KANNAUJ"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "GOVERNMENT MEDICAL COLLEGE, SAHARANPUR",
      "aliases": [
        "GOVERNMENT MEDICAL COLLEGE, SAHARANPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "INSTITUTE OF MENTAL HEALTH & HOSPITAL, AGRA",
      "aliases": [
        "INSTITUTE OF MENTAL HEALTH & HOSPITAL, AGRA"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "King George's Medical University, Lucknow",
      "aliases": [
        "King George's Medical University, Lucknow"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "LALA LAJPAT RAI MEMORIAL MEDICAL COLLEGE, MEERUT",
      "aliases": [
        "LALA LAJPAT RAI MEMORIAL MEDICAL COLLEGE, MEERUT"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "MAHARANI LAXMI BAI MEDICAL COLLEGE, JHANSI",
      "aliases": [
        "MAHARANI LAXMI BAI MEDICAL COLLEGE, JHANSI"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "MOTI LAL NEHRU MEDICAL COLLEGE, PRAYAGRAJ",
      "aliases": [
        "MOTI LAL NEHRU MEDICAL COLLEGE, PRAYAGRAJ"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "POST GRADUATE INSTITUTE OF CHILD HEALTH, NOIDA",
      "aliases": [
        "POST GRADUATE INSTITUTE OF CHILD HEALTH, NOIDA"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "REGIONAL INSTITUTE OF OPHTHALMOLOGY, SITAPUR",
      "aliases": [
        "REGIONAL INSTITUTE OF OPHTHALMOLOGY, SITAPUR"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "Sanjay Gandhi Postgraduate Institute of Medical Sciences, Lucknow",
      "aliases": [
        "Sanjay Gandhi Postgraduate Institute of Medical Sciences, Lucknow"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "Sarojini Naidu Medical College, Agra",
      "aliases": [
        "Sarojini Naidu Medical College, Agra"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "UTTAR PRADESH UNIVERSITY OF MEDICAL SCIENCES, SAIFAI, ETAWAH",
      "aliases": [
        "UTTAR PRADESH UNIVERSITY OF MEDICAL SCIENCES, SAIFAI, ETAWAH"
      ],
      "type": "GOVERNMENT"
    },
    {
      "name": "CAREER INSTITUTE OF MEDICAL SCIENCES, LKO",
      "aliases": [
        "CAREER INSTITUTE OF MEDICAL SCIENCES, LKO"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "ERA MEDICAL COLLEGE LUCKNOW",
      "aliases": [
        "ERA MEDICAL COLLEGE LUCKNOW"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "ERA MEDICAL COLLEGE LUCKNOW (MUSLIM MINORITY)",
      "aliases": [
        "ERA MEDICAL COLLEGE LUCKNOW (MUSLIM MINORITY)"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "F.H. MEDICAL COLLEGE & HOSPITAL, AGRA",
      "aliases": [
        "F.H. MEDICAL COLLEGE & HOSPITAL, AGRA"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "F.H. MEDICAL COLLEGE & HOSPITAL, AGRA (MUSLIM MINORITY)",
      "aliases": [
        "F.H. MEDICAL COLLEGE & HOSPITAL, AGRA (MUSLIM MINORITY)"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "G.S. MEDICAL COLLEGE, HAPUR",
      "aliases": [
        "G.S. MEDICAL COLLEGE, HAPUR"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "HERITAGE MEDICAL COLLEGE, VARANASI",
      "aliases": [
        "HERITAGE MEDICAL COLLEGE, VARANASI"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "HIND MEDICAL COLLEGE BARABANKI",
      "aliases": [
        "HIND MEDICAL COLLEGE BARABANKI"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "HIND MEDICAL COLLEGE, SITAPUR",
      "aliases": [
        "HIND MEDICAL COLLEGE, SITAPUR"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "INTEGRAL INSTITUTE OF MEDICAL SCIENCES, LUCKNOW",
      "aliases": [
        "INTEGRAL INSTITUTE OF MEDICAL SCIENCES, LUCKNOW"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "INTEGRAL INSTITUTE OF MEDICAL SCIENCES, LUCKNOW (MUSLIM MINORITY)",
      "aliases": [
        "INTEGRAL INSTITUTE OF MEDICAL SCIENCES, LUCKNOW (MUSLIM MINORITY)"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "K.D. MEDICAL COLLEGE, MATHURA",
      "aliases": [
        "K.D. MEDICAL COLLEGE, MATHURA"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "K.M. MEDICAL COLLEGE, MATHURA",
      "aliases": [
        "K.M. MEDICAL COLLEGE, MATHURA"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "MAYO INSTITUTE OF MEDICAL SCIENCE, BARABANKI",
      "aliases": [
        "MAYO INSTITUTE OF MEDICAL SCIENCE, BARABANKI"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "MUZAFFAR NAGAR MEDICAL COLLEGE MUZAFFAR NAGAR",
      "aliases": [
        "MUZAFFAR NAGAR MEDICAL COLLEGE MUZAFFAR NAGAR"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "Naraina Medical College & Research Centre, Kanpur",
      "aliases": [
        "Naraina Medical College & Research Centre, Kanpur"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "NATIONAL CAPITAL MEDICAL COLLEGE, MEERUT",
      "aliases": [
        "NATIONAL CAPITAL MEDICAL COLLEGE, MEERUT"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "NOIDA INTERNATIONAL INSTITUTE OF MEDICAL SCIENCES, GREATER NOIDA",
      "aliases": [
        "NOIDA INTERNATIONAL INSTITUTE OF MEDICAL SCIENCES, GREATER NOIDA"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "PRASAD MEDICAL COLLEGE, LUCKNOW",
      "aliases": [
        "PRASAD MEDICAL COLLEGE, LUCKNOW"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "RAJSHREE MEDICAL RESEARCH INSTITUTE BAREILLY",
      "aliases": [
        "RAJSHREE MEDICAL RESEARCH INSTITUTE BAREILLY"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "RAMA MEDICAL COLLEGE HOSPITAL & RESEARCH CENTRE, HAPUR",
      "aliases": [
        "RAMA MEDICAL COLLEGE HOSPITAL & RESEARCH CENTRE, HAPUR"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "RAMA MEDICAL COLLEGE KANPUR",
      "aliases": [
        "RAMA MEDICAL COLLEGE KANPUR"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "Rohilkhand Medical College, Bareilly",
      "aliases": [
        "Rohilkhand Medical College, Bareilly"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "SARASWATI INSTITUTE OF MEDICAL SCIENCES HAPUR",
      "aliases": [
        "SARASWATI INSTITUTE OF MEDICAL SCIENCES HAPUR"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "SCHOOL OF MEDICAL SCIENCES & RESEARCH, SHARDA UNIVERSITY G. NOIDA",
      "aliases": [
        "SCHOOL OF MEDICAL SCIENCES & RESEARCH, SHARDA UNIVERSITY G. NOIDA"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "Shri Ram Murti Institute of Medical Sciences, Bareilly",
      "aliases": [
        "Shri Ram Murti Institute of Medical Sciences, Bareilly"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "SUBHARATI MEDICAL COLLEGE, MEERUT",
      "aliases": [
        "SUBHARATI MEDICAL COLLEGE, MEERUT"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "T.S. Misra Medical College & Hospital, Lucknow",
      "aliases": [
        "T.S. Misra Medical College & Hospital, Lucknow"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "TEERTHANKER MAHAVEER UNIVERSITY, MORADABAD",
      "aliases": [
        "TEERTHANKER MAHAVEER UNIVERSITY, MORADABAD"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "United Medical College, Prayagraj",
      "aliases": [
        "United Medical College, Prayagraj"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "Varunarjun Medical College, Shahjahanpur",
      "aliases": [
        "Varunarjun Medical College, Shahjahanpur"
      ],
      "type": "PRIVATE"
    },
    {
      "name": "Venkateshwara Medical College, Amroha",
      "aliases": [
        "Venkateshwara Medical College, Amroha"
      ],
      "type": "PRIVATE"
    }
  ],
  "RAJASTHAN": [
    {
      "name": "SMS Medical College, Jaipur",
      "aliases": [
        "SMS Medical College, Jaipur"
      ]
    },
    {
      "name": "Dr. S. N. Medical College, Jodhpur",
      "aliases": [
        "Dr. S. N. Medical College, Jodhpur"
      ]
    },
    {
      "name": "R.N.T. Medical College, Udaipur",
      "aliases": [
        "R.N.T. Medical College, Udaipur"
      ]
    },
    {
      "name": "J.L.N. Medical College, Ajmer",
      "aliases": [
        "J.L.N. Medical College, Ajmer"
      ]
    },
    {
      "name": "Government Medical College, Kota",
      "aliases": [
        "Government Medical College, Kota"
      ]
    },
    {
      "name": "S.P. Medical College, Bikaner",
      "aliases": [
        "S.P. Medical College, Bikaner"
      ]
    },
    {
      "name": "RUHS College of Medical Sciences",
      "aliases": [
        "RUHS College of Medical Sciences"
      ]
    },
    {
      "name": "Jhalawar Medical College, Jhalawar",
      "aliases": [
        "Jhalawar Medical College, Jhalawar"
      ]
    },
    {
      "name": "Shri Jagannath Pahadiya Medical College, Bharatpur",
      "aliases": [
        "Shri Jagannath Pahadiya Medical College, Bharatpur"
      ]
    },
    {
      "name": "ESIC Medical College and Hospital, Alwar",
      "aliases": [
        "ESIC Medical College and Hospital, Alwar"
      ]
    },
    {
      "name": "Mahatma Gandhi Medical College and Hospital, Jaipur",
      "aliases": [
        "Mahatma Gandhi Medical College and Hospital, Jaipur"
      ]
    },
    {
      "name": "American International Institute of Medical Sciences",
      "aliases": [
        "American International Institute of Medical Sciences"
      ]
    },
    {
      "name": "Ananta Institute of Medical Sciences and Research Centre, Rajsamand",
      "aliases": [
        "Ananta Institute of Medical Sciences and Research Centre, Rajsamand"
      ]
    },
    {
      "name": "Dr. S.S. Tantia Medical College, Hospital and Research Centre, Sri Ganganagar",
      "aliases": [
        "Dr. S.S. Tantia Medical College, Hospital and Research Centre, Sri Ganganagar"
      ]
    },
    {
      "name": "National Institute of Medical Sciences & Research (NIMS), Jaipur",
      "aliases": [
        "National Institute of Medical Sciences & Research (NIMS), Jaipur"
      ]
    },
    {
      "name": "Geetanjali Medical College & Hospital, Udaipur",
      "aliases": [
        "Geetanjali Medical College & Hospital, Udaipur"
      ]
    },
    {
      "name": "Pacific Medical College & Hospital, Udaipur",
      "aliases": [
        "Pacific Medical College & Hospital, Udaipur"
      ]
    },
    {
      "name": "Pacific Institute of Medical Sciences, Udaipur",
      "aliases": [
        "Pacific Institute of Medical Sciences, Udaipur"
      ]
    },
    {
      "name": "MGH Hospital, Bhilwara",
      "aliases": [
        "MGH Hospital, Bhilwara"
      ]
    },
    {
      "name": "GMC Bhilwara",
      "aliases": [
        "GMC Bhilwara"
      ]
    },
    {
      "name": "GMC Churu",
      "aliases": [
        "GMC Churu"
      ]
    },
    {
      "name": "GMC Dungarpur",
      "aliases": [
        "GMC Dungarpur"
      ]
    },
    {
      "name": "GMC Pali",
      "aliases": [
        "GMC Pali"
      ]
    },
    {
      "name": "S K Hospital, Sikar",
      "aliases": [
        "S K Hospital, Sikar"
      ]
    },
    {
      "name": "RBM Hospital, Bharatpur",
      "aliases": [
        "RBM Hospital, Bharatpur"
      ]
    },
    {
      "name": "Government Hospital, Alwar",
      "aliases": [
        "Government Hospital, Alwar"
      ]
    },
    {
      "name": "Govt. RDBP Jaipuria Hospital, Jaipur",
      "aliases": [
        "Govt. RDBP Jaipuria Hospital, Jaipur"
      ]
    },
    {
      "name": "Government BDK Hospital, Jhunjhunu",
      "aliases": [
        "Government BDK Hospital, Jhunjhunu"
      ]
    },
    {
      "name": "Govt. Amritkaur Hospital, Beawar",
      "aliases": [
        "Govt. Amritkaur Hospital, Beawar"
      ]
    },
    {
      "name": "Government District Hospital, Dholpur",
      "aliases": [
        "Government District Hospital, Dholpur"
      ]
    },
    {
      "name": "District Hospital, Banswara",
      "aliases": [
        "District Hospital, Banswara"
      ]
    },
    {
      "name": "District Hospital, Baran",
      "aliases": [
        "District Hospital, Baran"
      ]
    },
    {
      "name": "District Hospital, Bundi",
      "aliases": [
        "District Hospital, Bundi"
      ]
    },
    {
      "name": "District Hospital, Chittorgarh",
      "aliases": [
        "District Hospital, Chittorgarh"
      ]
    },
    {
      "name": "District Hospital, Hanumangarh",
      "aliases": [
        "District Hospital, Hanumangarh"
      ]
    },
    {
      "name": "District Hospital, Nagaur",
      "aliases": [
        "District Hospital, Nagaur"
      ]
    },
    {
      "name": "District Hospital, Pratapgarh",
      "aliases": [
        "District Hospital, Pratapgarh"
      ]
    },
    {
      "name": "District Hospital, Sirohi",
      "aliases": [
        "District Hospital, Sirohi"
      ]
    },
    {
      "name": "District Hospital, Sri Ganganagar",
      "aliases": [
        "District Hospital, Sri Ganganagar"
      ]
    },
    {
      "name": "District Hospital, Tonk",
      "aliases": [
        "District Hospital, Tonk"
      ]
    },
    {
      "name": "Government Hospital, Sawai Madhopur",
      "aliases": [
        "Government Hospital, Sawai Madhopur"
      ]
    },
    {
      "name": "Government Hospital, Karauli",
      "aliases": [
        "Government Hospital, Karauli"
      ]
    },
    {
      "name": "Govt District Hospital, Kekri, Ajmer",
      "aliases": [
        "Govt District Hospital, Kekri, Ajmer"
      ]
    },
    {
      "name": "Shri Hari Deo Joshi General Hospital, Dungarpur",
      "aliases": [
        "Shri Hari Deo Joshi General Hospital, Dungarpur"
      ]
    }
  ],
  "MP": [
    {
      "name": "Gandhi Medical College, Bhopal",
      "aliases": [
        "Gandhi Medical College, Bhopal",
        "GANDHI MEDICAL COLLEGE BHOPAL"
      ]
    },
    {
      "name": "Gajra Raja Medical College, Gwalior",
      "aliases": [
        "Gajra Raja Medical College, Gwalior",
        "GAJRA RAJA MEDICAL COLLEGE GWALIOR"
      ]
    },
    {
      "name": "Shyam Shah Medical College, Rewa",
      "aliases": [
        "Shyam Shah Medical College, Rewa",
        "SHYAM SHAH MEDICAL COLLEGE REWA"
      ]
    },
    {
      "name": "Government Medical College, Ratlam",
      "aliases": [
        "Government Medical College, Ratlam"
      ]
    },
    {
      "name": "Government Medical College, Satna",
      "aliases": [
        "Government Medical College, Satna"
      ]
    },
    {
      "name": "Government Medical College, Datia",
      "aliases": [
        "Government Medical College, Datia"
      ]
    },
    {
      "name": "Government Medical College, Khandwa",
      "aliases": [
        "Government Medical College, Khandwa"
      ]
    },
    {
      "name": "Government Medical College, Jabalpur",
      "aliases": [
        "Government Medical College, Jabalpur"
      ]
    },
    {
      "name": "Government Medical College, Vidisha",
      "aliases": [
        "Government Medical College, Vidisha"
      ]
    },
    {
      "name": "Bundelkhand Medical College, Sagar",
      "aliases": [
        "Bundelkhand Medical College, Sagar"
      ]
    },
    {
      "name": "Government Medical College, Shivpuri",
      "aliases": [
        "Government Medical College, Shivpuri"
      ]
    },
    {
      "name": "Amaltas Institute of Medical Sciences, Dewas",
      "aliases": [
        "Amaltas Institute of Medical Sciences, Dewas"
      ]
    },
    {
      "name": "R.D. Gardi Medical College, Ujjain",
      "aliases": [
        "R.D. Gardi Medical College, Ujjain",
        "RD GARDI MEDICAL COLLEGE UJJAIN",
        "R D GARDI MEDICAL COLLEGE"
      ]
    },
    {
      "name": "People’s College of Medical Sciences & Research Centre, Bhopal",
      "aliases": [
        "People’s College of Medical Sciences & Research Centre, Bhopal",
        "PEOPLES COLLEGE OF MEDICAL SCIENCE BHOPAL",
        "PEOPLES COLLEGE OF MEDICAL SCIENCES BHOPAL"
      ]
    },
    {
      "name": "Sri Aurobindo Institute of Medical Sciences, Indore",
      "aliases": [
        "Sri Aurobindo Institute of Medical Sciences, Indore",
        "SRI AUROBINDO INSTITUTE OF MEDICAL SCIENCE INDORE"
      ]
    },
    {
      "name": "Chirayu Medical College & Hospital, Bhopal",
      "aliases": [
        "Chirayu Medical College & Hospital, Bhopal",
        "CHIRAYU MEDICAL COLLEGE AND HOSPITAL BHOPAL"
      ]
    },
    {
      "name": "L.N. Medical College, Bhopal",
      "aliases": [
        "L.N. Medical College, Bhopal"
      ]
    },
    {
      "name": "Gwalior Mansik Arogyashala, Gwalior",
      "aliases": [
        "Gwalior Mansik Arogyashala, Gwalior"
      ]
    }
  ],
  "BIHAR": [
    {
      "name": "P.M.C. Patna",
      "aliases": [
        "P.M.C. Patna",
        "P.M.C.PATNA",
        "PATNA MEDICAL COLLEGE"
      ]
    },
    {
      "name": "N.M.C. Patna",
      "aliases": [
        "N.M.C. Patna",
        "N.M.C. PATNA",
        "NALANDA MEDICAL COLLEGE PATNA"
      ]
    },
    {
      "name": "I.G.I.M.S. Patna",
      "aliases": [
        "I.G.I.M.S. Patna",
        "I.G.I.M.S. PATNA",
        "IGIMS PATNA"
      ]
    },
    {
      "name": "D.M.C. Laheriasarai",
      "aliases": [
        "D.M.C. Laheriasarai",
        "D.M.C.LAHERIASARAI",
        "DARBHANGA MEDICAL COLLEGE"
      ]
    },
    {
      "name": "S.K.M.C. Muzaffarpur",
      "aliases": [
        "S.K.M.C. Muzaffarpur",
        "S.K.M.C. MUZAFFARPUR",
        "SRI KRISHNA MEDICAL COLLEGE"
      ]
    },
    {
      "name": "A.N.M.M.C. Gaya",
      "aliases": [
        "A.N.M.M.C. Gaya",
        "A.N.M.M.C. GAYA",
        "ANUGRAH NARAYAN MAGADH MEDICAL COLLEGE"
      ]
    },
    {
      "name": "J.L.N.M.C. Bhagalpur",
      "aliases": [
        "J.L.N.M.C. Bhagalpur",
        "J.L.N.M.C. BHAGALPUR",
        "JAWAHARLAL NEHRU MEDICAL COLLEGE BHAGALPUR"
      ]
    },
    {
      "name": "G.M.C. Bettiah",
      "aliases": [
        "G.M.C. Bettiah",
        "G.M.C. BETTIAH",
        "GOVERNMENT MEDICAL COLLEGE BETTIAH"
      ]
    },
    {
      "name": "J.K.T.M.C. Madhepura",
      "aliases": [
        "J.K.T.M.C. Madhepura"
      ]
    },
    {
      "name": "G.M.C. Purnea",
      "aliases": [
        "G.M.C. Purnea"
      ]
    },
    {
      "name": "B.M.I.M.S., Pawapuri, Nalanda",
      "aliases": [
        "B.M.I.M.S., Pawapuri, Nalanda"
      ]
    },
    {
      "name": "BIMHAS Koilwar, Bhojpur",
      "aliases": [
        "BIMHAS Koilwar, Bhojpur"
      ]
    },
    {
      "name": "K.M.C. Katihar",
      "aliases": [
        "K.M.C. Katihar",
        "K.M.C. KATIHAR",
        "KATIHAR MEDICAL COLLEGE"
      ]
    },
    {
      "name": "MGMMC & LSK HOS, Kishanganj",
      "aliases": [
        "MGMMC & LSK HOS, Kishanganj",
        "MGMMC LSK HOS KISHANGANJ",
        "MGMMC LSK HOSPITAL KISHANGANJ"
      ]
    },
    {
      "name": "N.M.C. & H., Sasaram",
      "aliases": [
        "N.M.C. & H., Sasaram",
        "N.M.C H SASARAM",
        "N M C H SASARAM"
      ]
    },
    {
      "name": "Madhubani Medical College, Madhubani",
      "aliases": [
        "Madhubani Medical College, Madhubani",
        "MADHUBANI MEDICAL COLLEGE MADHUBANI"
      ]
    },
    {
      "name": "Netaji Subhas Medical College & Hospital, Bihta",
      "aliases": [
        "Netaji Subhas Medical College & Hospital, Bihta"
      ]
    },
    {
      "name": "Lord Buddha Koshi Medical College & Hospital, Saharsa",
      "aliases": [
        "Lord Buddha Koshi Medical College & Hospital, Saharsa",
        "LORD BUDHA KOSHI MEDICAL COLLEGE HOSPITAL SAHARSA",
        "AND HOSPITAL SAHARSA",
        "COLLEGE HOSPITAL SAHARSA"
      ]
    },
    {
      "name": "L.N.J.P. Hospital, Patna",
      "aliases": [
        "L.N.J.P. Hospital, Patna"
      ]
    },
    {
      "name": "Sadar Hospital, Chapra (Saran)",
      "aliases": [
        "Sadar Hospital, Chapra (Saran)"
      ]
    },
    {
      "name": "Sadar Hospital, Gopalganj",
      "aliases": [
        "Sadar Hospital, Gopalganj"
      ]
    },
    {
      "name": "Sadar Hospital, Jehanabad",
      "aliases": [
        "Sadar Hospital, Jehanabad"
      ]
    },
    {
      "name": "Sadar Hospital, Khagaria",
      "aliases": [
        "Sadar Hospital, Khagaria"
      ]
    },
    {
      "name": "Sadar Hospital, Lakhisarai",
      "aliases": [
        "Sadar Hospital, Lakhisarai"
      ]
    },
    {
      "name": "Sadar Hospital, Madhubani",
      "aliases": [
        "Sadar Hospital, Madhubani"
      ]
    },
    {
      "name": "Sadar Hospital, Motihari",
      "aliases": [
        "Sadar Hospital, Motihari"
      ]
    },
    {
      "name": "Sadar Hospital, Muzaffarpur",
      "aliases": [
        "Sadar Hospital, Muzaffarpur"
      ]
    },
    {
      "name": "Sadar Hospital, Nalanda (Bihar Sharif)",
      "aliases": [
        "Sadar Hospital, Nalanda (Bihar Sharif)"
      ]
    },
    {
      "name": "Sadar Hospital, Sasaram",
      "aliases": [
        "Sadar Hospital, Sasaram"
      ]
    },
    {
      "name": "Sadar Hospital, Sitamarhi",
      "aliases": [
        "Sadar Hospital, Sitamarhi"
      ]
    },
    {
      "name": "Sadar Hospital, Siwan",
      "aliases": [
        "Sadar Hospital, Siwan"
      ]
    },
    {
      "name": "Sadar Hospital, Madhepura",
      "aliases": [
        "Sadar Hospital, Madhepura"
      ]
    },
    {
      "name": "Sadar Hospital, Hajipur, Vaishali",
      "aliases": [
        "Sadar Hospital, Hajipur, Vaishali"
      ]
    },
    {
      "name": "Sadar Hospital, Begusarai",
      "aliases": [
        "Sadar Hospital, Begusarai"
      ]
    },
    {
      "name": "Sadar Hospital, Araria",
      "aliases": [
        "Sadar Hospital, Araria"
      ]
    },
    {
      "name": "Sadar Hospital, Banka",
      "aliases": [
        "Sadar Hospital, Banka"
      ]
    },
    {
      "name": "Sadar Hospital, Samastipur",
      "aliases": [
        "Sadar Hospital, Samastipur"
      ]
    },
    {
      "name": "Sadar Hospital, Sheohar",
      "aliases": [
        "Sadar Hospital, Sheohar"
      ]
    },
    {
      "name": "Sadar Hospital, Buxar",
      "aliases": [
        "Sadar Hospital, Buxar"
      ]
    },
    {
      "name": "Sadar Hospital, Purnea",
      "aliases": [
        "Sadar Hospital, Purnea"
      ]
    }
  ],
  "JHARKHAND": [
    {
      "name": "Rajendra Institute of Medical Sciences, Ranchi",
      "aliases": [
        "Rajendra Institute of Medical Sciences, Ranchi",
        "RAJENDRA INSTITUTE OF MEDICAL SCIENCES RANCHI",
        "JENDRA INSTITUTE OF MEDICAL SCIENCES RANCHI"
      ]
    },
    {
      "name": "Mahatma Gandhi Memorial Medical College, Jamshedpur",
      "aliases": [
        "Mahatma Gandhi Memorial Medical College, Jamshedpur",
        "MAHATMA GANDHI MEMORIAL MEDICAL COLLEGE JAMSHEDPUR",
        "HATMA GANDHI MEMORIAL MEDICAL COLLEGE JAMSHEDPUR"
      ]
    },
    {
      "name": "Shahid Nirmal Mahato Medical College, Dhanbad",
      "aliases": [
        "Shahid Nirmal Mahato Medical College, Dhanbad",
        "SNMMCH DHANBAD"
      ]
    }
  ]
};

function getCollegeMasterEntries() {
  return CANONICAL_COLLEGE_MASTER[state.counselling] || [];
}

function collegeMatchScore(raw, entry) {
  const r=norm(raw), rTokens=[...new Set(r.split(' ').filter(t=>t.length>2))];
  if(!r) return 0;
  let best=0;
  for(const candidate of [entry.name,...(entry.aliases||[])]) {
    const c=norm(candidate);
    if(!c) continue;
    if(r===c) best=Math.max(best,1200);
    else if(r.includes(c)) best=Math.max(best,1000 + Math.min(100,c.length/8));
    const cTokens=[...new Set(c.split(' ').filter(t=>t.length>2))];
    const common=cTokens.filter(t=>rTokens.includes(t)).length;
    if(cTokens.length) best=Math.max(best, (common/cTokens.length)*820);
  }
  return best;
}

function resolveCanonicalCollege(raw) {
  const text=String(raw||'').trim();
  if(!text) return '';
  const entries=getCollegeMasterEntries();
  let best=null, second=0;
  for(const entry of entries) {
    const score=collegeMatchScore(text,entry);
    if(score>(best?.score||0)) { second=best?.score||0; best={entry,score}; }
    else if(score>second) second=score;
  }
  if(!best || best.score<360) return '';
  if(best.score<900 && best.score-second<80) return '';
  return best.entry.name;
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
  // Apply aliases against normalized text. The older version tested regexes
  // containing punctuation against norm(), which strips punctuation and caused
  // many aliases to miss.
  const n=norm(s);
  const rules=[
    ["INDIRA GANDHI INSTITUTE MEDICAL SCIENCES", "Indira Gandhi Institute of Medical Sciences, Patna"],
    ["DR D Y PATIL MEDICAL COLLEGE", "Dr. D. Y. Patil Medical College"],
    ["MAHATMA GANDHI CANCER HOSPITAL", "Mahatma Gandhi Cancer Hospital and Research Institute"],
    ["SHRI B M PATIL MEDICAL COLLEGE", "Shri B. M. Patil Medical College Hospital and Research Centre"],
    ["SHRI VASANTRAO NAIK GOVT MEDICAL COLLEGE", "Shri Vasantrao Naik Govt. Medical College, Yavatmal"],
    ["PANDIT DINDAYAL UPADHYAY MEDICAL COLLEGE", "Pandit Dindayal Upadhyay Medical College, Rajkot"],
    ["MAULANA AZAD MEDICAL COLLEGE", "Maulana Azad Medical College"],
    ["NIL RATAN SIRCAR MEDICAL COLLEGE", "Nil Ratan Sircar Medical College"],
    ["RAVINDRA NATH TAGORE MEDICAL COLLEGE", "Ravindra Nath Tagore Medical College"],
    ["JASLOK HOSPITAL", "Jaslok Hospital and Research Centre"],
    ["AIG HOSPITAL", "AIG Hospitals"],
    ["K S HEGDE MEDICAL ACADEMY", "K. S. Hegde Medical Academy"],
    ["PGIMER", "PGIMER"],
    ["JIPMER", "JIPMER"],
    ["AIIMS NEW DELHI", "AIIMS New Delhi"],
    ["GURU GOBIND SINGH MEDICAL COLLEGE FARIDKOT", "Guru Gobind Singh Medical College, Faridkot"],
    ["GANDHI MEDICAL COLLEGE BHOPAL", "Gandhi Medical College, Bhopal"],
    ["PATNA MEDICAL COLLEGE", "Patna Medical College"],
    ["DARBHANGA MEDICAL COLLEGE", "Darbhanga Medical College"],
    ["ANUGRAH NARAYAN MAGADH MEDICAL COLLEGE", "Anugrah Narayan Magadh Medical College, Gaya"],
    ["S K M C MUZAFFARPUR", "S.K.M.C. Muzaffarpur"],
    ["D M C LAHERIASARAI", "D.M.C. Laheriasarai"],
    ["P M C PATNA", "P.M.C. Patna"],
    ["N M C H SASARAM", "N.M.C. & H., Sasaram"],
    ["N M C PATNA", "N.M.C. Patna"],
    ["I G I M S PATNA", "I.G.I.M.S. Patna"],
    ["G M C BETTIAH", "G.M.C., Bettiah"]
  ];
  for(const [needle,name] of rules){
    if(n.includes(needle)) return name;
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
  for(const raw of values.map(v=>String(v||"").trim()).filter(Boolean)){
    const c=resolveCanonicalCollege(raw);
    if(c) return c;
  }
  return "";
}

function isStrongCollegeName(v){
  const n=norm(v);
  if(!n || n.length<6) return false;
  if(/^(?:PAGE|AGE) NO/.test(n)) return false;
  if(/^[.\-_\s\d]+$/.test(n)) return false;
  return /(MEDICAL|INSTITUTE|HOSPITAL|UNIVERSITY|ACADEMY|COLLEGE|SCIENCES|CANCER)/.test(n);
}

function extractCollegeCandidates(raw){
  const c=resolveCanonicalCollege(raw);
  return c?[c]:[];
}

function extractCourseCandidates(raw){
  const text=String(raw||'');
  if(!text) return [];
  const n=norm(text);
  const hits=[];
  for(const [label,re] of COURSE_PATTERNS){
    const src=re.source;
    let m;
    try{
      const rx=new RegExp(src,'ig');
      while((m=rx.exec(n))!==null) hits.push({pos:m.index,label});
    }catch(e){}
  }
  hits.sort((a,b)=>a.pos-b.pos);
  const out=[]; const seen=new Set();
  for(const h of hits){
    if(!seen.has(h.label)){seen.add(h.label);out.push(h.label);}
  }
  return out;
}

function buildCollegeMaster(){
  state.collegeMaster=getCollegeMasterEntries().map(x=>({name:x.name,searchText:norm([x.name,...(x.aliases||[])].join(' '))}));
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
      .filter(x=>{
        if(!q) return true;
        const hay=norm(x.searchText);
        return hay.includes(q);
      })
      .sort((a,b)=>{
        if(!q) return a.name.localeCompare(b.name,'en',{sensitivity:'base'});
        const aq=norm(a.name), bq=norm(b.name);
        const as=aq.startsWith(q)?0:(aq.includes(q)?1:2);
        const bs=bq.startsWith(q)?0:(bq.includes(q)?1:2);
        return as-bs || aq.localeCompare(bq,'en',{sensitivity:'base'});
      })
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
  const q=norm(query);
  if(!q) return true;
  const hay=norm([x._college||'',x._collegeSearch||'',x.college||'',x._collegeAliases||''].join(' '));
  if(hay.includes(q)) return true;
  const tokens=q.split(' ').filter(t=>t.length>2);
  return tokens.length>=3 && tokens.every(t=>hay.includes(t));
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
  let college=resolveCanonicalCollege(rawCollege);
  if(!college && looksLikeSeatMarker(rawCollege) && !looksLikeRemark(rawCourse)) college=resolveCanonicalCollege(rawCourse);
  if(!college && state.counselling==='BIHAR') college=resolveCanonicalCollege(rawCourse);
  return {...x,_college:college,_course:course,_category:cleanRowCategory(x),_collegeSearch:norm([college,rawCollege].join(' '))};
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

function buildMovementRows(){
  const grouped=new Map();
  for(const x of state.allotments){
    const college=x._college, course=x._course, round=String(x.round||'').toUpperCase(), rank=Number(x.rank_value);
    if(!college || !course || !/^R[123]$|^STRAY$/.test(round) || !Number.isFinite(rank) || rank<=0) continue;
    const key=`${norm(college)}|${norm(course)}|${round}`;
    let g=grouped.get(key);
    if(!g) g={_college:college,_course:course,_collegeSearch:norm(college),round};
    g.minRank=g.minRank==null?rank:Math.min(g.minRank,rank);
    g.maxRank=g.maxRank==null?rank:Math.max(g.maxRank,rank);
    g.count=(g.count||0)+1;
    grouped.set(key,g);
  }
  const merged=new Map();
  for(const g of grouped.values()){
    const key=`${norm(g._college)}|${norm(g._course)}`;
    const out=merged.get(key)||{_college:g._college,_course:g._course,_collegeSearch:g._collegeSearch};
    out[`opening_rank_${g.round}`]=g.minRank;
    out[`closing_rank_${g.round}`]=g.maxRank;
    out[`allotment_count_${g.round}`]=g.count;
    merged.set(key,out);
  }
  return [...merged.values()];
}

function runMovement(){
  trackEvent('movement_search', {
    counselling: state.counselling,
    round: state.round,
    college: document.getElementById('moveCollege').value.trim(),
    course: document.getElementById('moveCourse').value.trim()
  });

  const selectedCollege=norm(document.getElementById('moveCollege').value);
  const selectedCourse=norm(document.getElementById('moveCourse').value);
  let rows=buildMovementRows();

  if(selectedCollege){
    rows=rows.filter(x=>collegeMatches(x,selectedCollege));
  }
  if(selectedCourse){
    rows=rows.filter(x=>norm(x._course)===selectedCourse);
  }

  // Merge exact cleaned college+course pairs from multiple movement rows.
  const merged=new Map();
  for(const x of rows){
    const key=`${norm(x._college)}|${norm(x._course)}`;
    const g=merged.get(key)||{_college:x._college,_course:x._course,_collegeSearch:x._collegeSearch};
    for(const r of ['R1','R2','R3','STRAY']){
      if(x[`allotment_count_${r}`]) g[`allotment_count_${r}`]=(g[`allotment_count_${r}`]||0)+x[`allotment_count_${r}`];
      if(Number.isFinite(x[`opening_rank_${r}`])) g[`opening_rank_${r}`]=g[`opening_rank_${r}`]==null?x[`opening_rank_${r}`]:Math.min(g[`opening_rank_${r}`],x[`opening_rank_${r}`]);
      if(Number.isFinite(x[`closing_rank_${r}`])) g[`closing_rank_${r}`]=g[`closing_rank_${r}`]==null?x[`closing_rank_${r}`]:Math.max(g[`closing_rank_${r}`],x[`closing_rank_${r}`]);
    }
    merged.set(key,g);
  }

  rows=[...merged.values()];
  if(!rows.length){
    document.getElementById('movementResults').hidden=true;
    document.getElementById('movementEmpty').hidden=false;
    document.getElementById('movementEmpty').textContent='No matching historical movement found. Try selecting a clean college name and course.';
    return;
  }

  // Prefer an exact college+course hit. If only a college is supplied, list the
  // first matching course rather than silently mixing several courses.
  rows.sort((a,b)=>{
    const ea=(selectedCollege && norm(a._college)===selectedCollege?0:1)+(selectedCourse && norm(a._course)===selectedCourse?0:1);
    const eb=(selectedCollege && norm(b._college)===selectedCollege?0:1)+(selectedCourse && norm(b._course)===selectedCourse?0:1);
    return ea-eb || a._college.localeCompare(b._college,'en',{sensitivity:'base'}) || a._course.localeCompare(b._course,'en',{sensitivity:'base'});
  });

  const x=rows[0];
  document.getElementById('movementEmpty').hidden=true;
  document.getElementById('movementResults').hidden=false;
  document.getElementById('movementTitle').textContent=`${x._college||'Institute not available'} · ${x._course||'Course not available'}`;
  const rounds=[['R1','Round 1'],['R2','Round 2'],['R3','Round 3'],['STRAY','Stray']];
  document.getElementById('movementRow').innerHTML=rounds.map(([r,label])=>{
    const o=x[`opening_rank_${r}`], c=x[`closing_rank_${r}`];
    const has=Number.isFinite(o)&&Number.isFinite(c);
    return `<div class="move-box"><small>${label}</small><strong>${has?`${fmt(o)} – ${fmt(c)}`:'—'}</strong><span>${x[`allotment_count_${r}`]?fmt(x[`allotment_count_${r}`])+' allotments':'No observed data'}</span></div>`;
  }).join('');
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
