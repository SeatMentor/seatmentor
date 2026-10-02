const sampleSeats = [
  {college:"Sample Medical College", specialty:"Radiology", category:"General", seats:2},
  {college:"Sample Medical College", specialty:"Medicine", category:"OBC", seats:4},
  {college:"Sample Institute", specialty:"Paediatrics", category:"General", seats:3}
];

function searchSeats(){
  const c=document.getElementById("college").value.toLowerCase();
  const s=document.getElementById("specialty").value.toLowerCase();
  const cat=document.getElementById("category").value;
  const rows=sampleSeats.filter(x=>
    (!c || x.college.toLowerCase().includes(c)) &&
    (!s || x.specialty.toLowerCase().includes(s)) &&
    (!cat || x.category===cat)
  );
  document.getElementById("results").innerHTML = rows.length
    ? `<div class="card" style="box-shadow:none;overflow:auto"><table style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left;padding:12px">College</th><th style="text-align:left;padding:12px">Specialty</th><th style="text-align:left;padding:12px">Category</th><th style="text-align:left;padding:12px">Seats</th></tr>
      ${rows.map(r=>`<tr><td style="padding:12px;border-top:1px solid #eee">${r.college}</td><td style="padding:12px;border-top:1px solid #eee">${r.specialty}</td><td style="padding:12px;border-top:1px solid #eee">${r.category}</td><td style="padding:12px;border-top:1px solid #eee">${r.seats}</td></tr>`).join("")}
      </table></div>`
    : `<div class="empty">No matching seats found.</div>`;
}
