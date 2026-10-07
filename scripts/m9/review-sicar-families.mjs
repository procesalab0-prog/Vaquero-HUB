import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evidenceFor } from "./plan-sicar-only.mjs";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const explicit =
  /^(.+)T\.(XS|S|M|L|XL|XXL|XXXL|\d+(?:\.\d+)?(?:X\d+(?:\.\d+)?)?)$/;

// Organize evidence for a human reviewer. A proposed family is never approval.
export function reviewSicarFamilies(review) {
  if (
    review.version !== "m9-sicar-only-review-1" ||
    !Array.isArray(review.records)
  )
    throw Error("INVALID_REVIEW");
  const codes = new Set(),
    groups = new Map();
  for (const row of review.records) {
    if (
      typeof row.barcode !== "string" ||
      !row.barcode ||
      codes.has(row.barcode)
    )
      throw Error("DUPLICATE_OR_INVALID_CODE");
    codes.add(row.barcode);
    const evidence = {
      barcode: row.barcode,
      description: row.description,
      department: row.department,
      section: row.section,
      retail_source: row.retail_source,
      sales_visibility: row.sales_visibility,
    };
    if (sha(json(evidence)) !== row.evidence_sha256)
      throw Error("ROW_EVIDENCE_CHANGED");
    const match = explicit.exec(row.description);
    const proposal = match ? { base: match[1], suffix: match[2] } : null;
    if (JSON.stringify(proposal) !== JSON.stringify(row.proposed))
      throw Error("PROPOSAL_CHANGED");
    const key = json(
      proposal
        ? ["EXPLICIT_T", row.department, row.section, proposal.base]
        : ["UNSPLIT", row.barcode],
    );
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const cases = [...groups]
    .map(([key, members]) => {
      members.sort((a, b) => order(a.barcode, b.barcode));
      const first = members[0],
        proposed = first.proposed !== null;
      const name = proposed ? first.proposed.base : first.description;
      const issues = [...new Set(members.flatMap((r) => r.issues))];
      if (
        proposed &&
        new Set(members.map((r) => r.proposed.suffix)).size !== members.length
      )
        issues.push("REPEATED_SUFFIX");
      if (name.length > 160) issues.push("PRODUCT_NAME_LIMIT");
      if (
        members.some(
          (r) =>
            r.proposed?.suffix.includes("X") && /^\d/.test(r.proposed.suffix),
        )
      )
        issues.push("SIZE_LENGTH_DIMENSIONS_REVIEW");
      return {
        case_id: sha(key),
        kind: proposed ? "EXPLICIT_T_PROPOSAL" : "UNSPLIT_RECORD",
        product_name_proposed: name,
        department: first.department,
        section: first.section,
        issues: issues.sort(),
        evidence_sha256: evidenceFor(members),
        members: members.map((r) => ({ ...r })),
        status: "PENDING_REVIEW",
        import_allowed: false,
      };
    })
    .sort((a, b) => order(a.case_id, b.case_id));
  const bases = new Map();
  for (const c of cases.filter((c) => c.kind === "EXPLICIT_T_PROPOSAL"))
    bases.set(c.product_name_proposed, [
      ...(bases.get(c.product_name_proposed) ?? []),
      c.case_id,
    ]);
  for (const c of cases) {
    c.related_classification_cases = (
      bases.get(c.product_name_proposed) ?? []
    ).filter((id) => id !== c.case_id);
    if (
      c.kind === "EXPLICIT_T_PROPOSAL" &&
      c.related_classification_cases.length
    )
      c.issues = [
        ...new Set([...c.issues, "BASE_IN_MULTIPLE_CLASSIFICATIONS"]),
      ].sort();
  }
  const departments = [...new Set(cases.map((c) => c.department))]
    .sort(order)
    .map((department) => {
      const subset = cases.filter((c) => c.department === department);
      return {
        department,
        cases: subset.length,
        rows: subset.reduce((n, c) => n + c.members.length, 0),
      };
    });
  const templates = cases.map((c) => ({
    family_key: "sicar-" + c.case_id.slice(0, 40),
    product_name: c.product_name_proposed,
    status: "pending",
    reviewer: "",
    reason: "",
    reviewed_at: "",
    evidence_sha256: c.evidence_sha256,
    members: c.members.map((r) => ({
      barcode: r.barcode,
      attributes:
        r.proposed && !c.issues.includes("SIZE_LENGTH_DIMENSIONS_REVIEW")
          ? { TALLA: r.proposed.suffix }
          : {},
    })),
  }));
  return {
    version: "m9-sicar-family-review-1",
    sources: review.sources ?? null,
    summary: {
      rows: codes.size,
      cases: cases.length,
      explicit_proposals: cases.filter((c) => c.kind === "EXPLICIT_T_PROPOSAL")
        .length,
      unsplit_records: cases.filter((c) => c.kind === "UNSPLIT_RECORD").length,
      cases_with_issues: cases.filter((c) => c.issues.length).length,
      approved_rows: 0,
      departments,
    },
    inventory_included: false,
    woo_writes: false,
    write_allowed: false,
    cases,
    templates,
  };
}

export function familyReviewHtml(packet) {
  const data = JSON.stringify(packet).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Revisión de familias SICAR</title>
<style>body{font:16px system-ui;margin:0;background:#f5f3ec;color:#20382d}main{max-width:1100px;margin:auto;padding:24px}header{background:#173e31;color:white;padding:28px;border-radius:18px}p{line-height:1.5}.stats,.filters{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}.stats span,article{background:white;padding:20px;border-radius:14px}input,select,button,a.download{font:inherit;padding:12px;border:1px solid #a8b6aa;border-radius:8px}input{flex:1;min-width:200px}button,a.download{cursor:pointer;background:#173e31;color:white}button:disabled{opacity:.4}article{margin:20px 0;border:1px solid #d4dbd2}h2{font-size:20px;overflow-wrap:anywhere}small{display:block;color:#536858}.notice{padding:12px;background:#fff1ce;border-radius:8px}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #ddd;padding:12px;overflow-wrap:anywhere}.table{overflow:auto}nav{display:flex;gap:12px;align-items:center;margin:20px 0}.empty{padding:30px}a{color:inherit}</style>
<main><header><h1>Revisemos los productos que sólo están en SICAR</h1><p>Una propuesta reúne códigos que podrían ser tallas del mismo modelo. Hay que confirmar el modelo y sus variantes antes de cargarlo. Los códigos de barras se conservan completos.</p></header>
<div class="stats"><span><b>${packet.summary.rows}</b> registros</span><span><b>${packet.summary.explicit_proposals}</b> propuestas con T.</span><span><b>${packet.summary.unsplit_records}</b> registros sin separar</span></div>
<p class="notice">Sólo revisión. Nada de esta página se carga al programa ni a WooCommerce. Las plantillas descargadas quedan pendientes, sin aprobación. Los registros sin “T.” conservan el nombre completo: no adivinamos la talla por sus últimos números.</p>
<p><a class="download" href="plantillas-pendientes.json" download>Descargar todas las plantillas pendientes</a></p>
<div class="filters"><input id="q" aria-label="Buscar producto o código" placeholder="Buscar producto o código"><select id="department" aria-label="Departamento"><option value="">Todos los departamentos</option></select><select id="kind" aria-label="Tipo de revisión"><option value="">Todas las revisiones</option><option value="EXPLICIT_T_PROPOSAL">Propuestas de familia con T.</option><option value="UNSPLIT_RECORD">Sin separar modelo y talla</option><option value="issues">Con observaciones adicionales</option></select></div>
<p id="count" role="status"></p><nav><button id="prev">Anterior</button><span id="page"></span><button id="next">Siguiente</button></nav><section id="cases" aria-label="Familias por revisar"></section>
<p>Para cada propuesta: confirmar si los códigos son del mismo modelo, sus tallas o atributos y el nombre que debe verse en Mi Tienda. Si algún dato está mal, se conserva en revisión hasta corregir y exportar otra vez SICAR. Los costos y precios de mayoreo siguen sin definir.</p></main>
<script>const packet=${data};
const labels={BASE_IN_MULTIPLE_CLASSIFICATIONS:'La misma base también aparece en otra clasificación. Revisar por separado.',REPEATED_SUFFIX:'Hay tallas repetidas: confirmar qué distingue cada código.',SIZE_LENGTH_DIMENSIONS_REVIEW:'Confirmar qué parte es talla y cuál es largo.',PRODUCT_NAME_LIMIT:'El nombre debe ajustarse al límite del programa.',TAXONOMY_REVIEW:'Revisar departamento o sección.',RETAIL_PRICE_REVIEW:'Revisar precio público.',SALES_VISIBILITY_REVIEW:'Revisar si debe aparecer para venta.',DISPLAY_ONLY_REVIEW:'Producto de exhibición: revisar su presentación.'};
const q=document.getElementById('q'),department=document.getElementById('department'),kind=document.getElementById('kind'),list=document.getElementById('cases'),count=document.getElementById('count'),page=document.getElementById('page'),prev=document.getElementById('prev'),next=document.getElementById('next');
for(const d of packet.summary.departments){const o=document.createElement('option');o.value=d.department;o.textContent=d.department+' ('+d.rows+' registros)';department.append(o);}
let index=0,filtered=[];const size=20;
function el(tag,text,parent){const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;}
function download(c){const t=packet.templates.find(t=>t.family_key==='sicar-'+c.case_id.slice(0,40));const url=URL.createObjectURL(new Blob([JSON.stringify([t],null,2)+'\\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pendiente-'+c.case_id.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function render(){filtered=packet.cases.filter(c=>(!department.value||c.department===department.value)&&(!kind.value||(kind.value==='issues'?c.issues.length:c.kind===kind.value))&&JSON.stringify([c.product_name_proposed,c.department,c.section,c.members.map(r=>[r.barcode,r.description])]).toLowerCase().includes(q.value.toLowerCase()));const pages=Math.max(1,Math.ceil(filtered.length/size));index=Math.min(index,pages-1);count.textContent=filtered.length+' revisiones · '+filtered.reduce((n,c)=>n+c.members.length,0)+' registros';page.textContent='Página '+(index+1)+' de '+pages;prev.disabled=index===0;next.disabled=index>=pages-1;list.replaceChildren();for(const c of filtered.slice(index*size,(index+1)*size)){const a=document.createElement('article');list.append(a);el('h2',c.product_name_proposed,a);el('small',c.department+' / '+c.section+' · '+(c.kind==='EXPLICIT_T_PROPOSAL'?'Propuesta de familia':'Modelo sin separar')+' · '+c.members.length+' códigos',a);if(c.issues.length){const p=el('p',c.issues.map(k=>labels[k]||k).join(' '),a);p.className='notice';}const wrap=document.createElement('div');wrap.className='table';a.append(wrap);const table=document.createElement('table');wrap.append(table);const head=document.createElement('tr');table.append(head);for(const title of ['Código de barras','Descripción SICAR','Talla indicada','Precio público'])el('th',title,head);for(const r of c.members){const tr=document.createElement('tr');table.append(tr);for(const text of [r.barcode,r.description,r.proposed?r.proposed.suffix:'Por confirmar',r.retail_cents===null?'Por confirmar':'$'+(r.retail_cents/100).toFixed(2)])el('td',text,tr);}const b=el('button','Descargar plantilla pendiente',a);b.addEventListener('click',()=>download(c));}if(!filtered.length)el('p','No hay resultados con estos filtros.',list);}
for(const input of [q,department,kind])input.addEventListener('input',()=>{index=0;render();});prev.addEventListener('click',()=>{index--;render();});next.addEventListener('click',()=>{index++;render();});render();</script></html>`;
}

async function main() {
  const [reviewPath, out] = process.argv.slice(2);
  if (!out) throw Error("Usage: VERIFIED_REVIEW.json NEW_OUTPUT");
  const bytes = await readFile(reviewPath);
  const hashes = JSON.parse(
    await readFile(resolve(dirname(reviewPath), "sha256.json")),
  );
  if (sha(bytes) !== hashes["revision.json"])
    throw Error("REVIEW_HASH_CHANGED");
  const packet = reviewSicarFamilies(JSON.parse(bytes));
  packet.input_sha256 = sha(bytes);
  const files = {
    "familias.json": json(packet),
    "plantillas-pendientes.json": json(packet.templates),
    "resumen.json": json(packet.summary),
    "revision.html": familyReviewHtml(packet),
  };
  await mkdir(out);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(out, name), value, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [name, sha(value)]),
      ),
    ),
    { flag: "wx" },
  );
  console.log(packet.summary);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
