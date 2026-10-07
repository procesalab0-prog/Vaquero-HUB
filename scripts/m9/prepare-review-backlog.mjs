import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";
import { auditStagedCatalog } from "./audit-staged-catalog.mjs";
import { prepareSicarOnly } from "./prepare-sicar-only.mjs";
import { reviewSicarFamilies } from "./review-sicar-families.mjs";

const json = (v) => JSON.stringify(v, null, 2) + "\n";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const digest = (v) => sha(stable(v));
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (v) => [...new Set(v)].sort(order);
const labels = {
  SICAR_EXPLICIT: "Confirmar modelo y tallas indicadas con T.",
  SICAR_UNSPLIT: "Confirmar modelo y atributos; conservar descripción completa",
  WOO_COMPONENT: "Revisar juntos los candidatos Woo relacionados",
  NO_CANDIDATE: "Aclarar identidad sin candidato Woo",
};
export function reviewTasks(c) {
  const tasks = [];
  const classes = new Set(c.members.map((r) => r.classification));
  const reasons = c.members.flatMap((r) => r.reasons).join(" ");
  if (c.kind.startsWith("SICAR_"))
    tasks.push(
      "Confirmar qué códigos forman cada modelo y qué talla/color/largo distingue cada uno.",
    );
  if (classes.has("DUPLICATE_WOO_BASE"))
    tasks.push(
      "Distinguir los productos Woo que comparten código base; no fusionarlos por nombre.",
    );
  if (classes.has("CONFLICT"))
    tasks.push(
      "Revisar combinaciones de atributos repetidas, incompletas o incompatibles en Woo.",
    );
  if (classes.has("SPECIAL_SUFFIX"))
    tasks.push(
      "Aclarar la talla u otro atributo que SICAR agrega al código base.",
    );
  if (
    classes.has("VARIANT_NOT_PUBLISHED") ||
    c.candidates.some((w) => w.status !== "publish")
  )
    tasks.push(
      "Renovar el estado y las variaciones Woo: el corte histórico no acredita publicación actual.",
    );
  if (/TAXONOM|CLASIFIC|SECCION|DEPARTAMENTO|CATEGOR/i.test(reasons))
    tasks.push(
      "Confirmar departamento y sección por código; no corregirlos automáticamente.",
    );
  if (/PRECIO_PUBLICO|RETAIL_PRICE|IMPORTE_INVALIDO:precio1/i.test(reasons))
    tasks.push(
      "Completar o corregir el precio público en SICAR y volver a exportar.",
    );
  if (
    c.members.some((r) => r.display_only) ||
    /EXHIB|MUESTRA|DISPLAY_ONLY/i.test(reasons)
  )
    tasks.push(
      "Confirmar presentación de exhibición y mantener bloqueada la compra web.",
    );
  if (/CASO.*DUE|OWNER|DUENO|DUEÑO/i.test(reasons))
    tasks.push(
      "Conservar el caso previo de los dueños hasta contrastar su respuesta con estos códigos.",
    );
  if (!tasks.length)
    tasks.push("Revisar el control pendiente antes de preparar otra carga.");
  return tasks;
}

// Components organize review work; they never assert that rows are one product.
export function reviewBacklog(rows, snapshot, woo, exclusions = []) {
  if (snapshot.inventory_balances !== 0 || snapshot.inventory_movements !== 0)
    throw Error("INVENTORY_MUST_REMAIN_EMPTY");
  if (woo.pagination_complete !== true || !Array.isArray(woo.products))
    throw Error("COMPLETE_WOO_REQUIRED");
  const audit = auditStagedCatalog(snapshot, rows);
  if (audit.results.some((r) => r.reasons.length || r.differences.length))
    throw Error("STAGED_CATALOG_CHANGED");
  const source = new Map(),
    products = new Map(),
    holds = new Map();
  for (const r of rows) {
    if (
      typeof r.barcode !== "string" ||
      !r.barcode ||
      source.has(r.barcode) ||
      r.barcode !== r.fields?.["clave1 *"] ||
      r.description !== r.fields?.["descripción *"]
    )
      throw Error("NON_UNIQUE_OR_CHANGED_SOURCE_IDENTITY");
    source.set(r.barcode, r);
  }
  for (const p of woo.products) {
    if (!Number.isSafeInteger(p.id) || p.id <= 0 || products.has(p.id))
      throw Error("INVALID_WOO_IDENTITY");
    products.set(p.id, p);
  }
  for (const h of exclusions) {
    if (
      !source.has(h.barcode) ||
      holds.has(h.barcode) ||
      !Array.isArray(h.reasons) ||
      source.get(h.barcode).description !== h.description
    )
      throw Error("INVALID_PREPARATION_HOLD");
    holds.set(h.barcode, h.reasons);
  }
  const loaded = new Set(snapshot.rows.map((r) => r.current.barcode));
  const pending = rows.filter((r) => !loaded.has(r.barcode));
  const groups = [];
  const only = reviewSicarFamilies(prepareSicarOnly(rows));
  for (const c of only.cases) {
    const members = c.members
      .map((r) => source.get(r.barcode))
      .filter((r) => !loaded.has(r.barcode));
    if (members.length)
      groups.push({
        kind:
          c.kind === "EXPLICIT_T_PROPOSAL" ? "SICAR_EXPLICIT" : "SICAR_UNSPLIT",
        title: c.product_name_proposed,
        members,
        ids: [],
        related: c.related_classification_cases,
        extra: c.issues,
      });
  }
  const others = pending.filter((r) => r.classification !== "SICAR_ONLY");
  const parent = new Map();
  const root = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    while (id !== current) {
      const next = parent.get(id);
      parent.set(id, current);
      id = next;
    }
    return current;
  };
  const idsFor = (r) => {
    const ids = unique([
      ...(r.candidate_product_ids ?? []),
      ...(r.product_id == null ? [] : [r.product_id]),
    ]);
    if (ids.some((id) => !products.has(id)))
      throw Error("UNKNOWN_WOO_CANDIDATE");
    return ids;
  };
  for (const r of others) {
    const ids = idsFor(r);
    for (const id of ids) parent.set(root(id), root(ids[0]));
  }
  const connected = new Map();
  for (const r of others) {
    const ids = idsFor(r),
      key = ids.length ? `woo:${root(ids[0])}` : `code:${r.barcode}`;
    connected.set(key, [...(connected.get(key) ?? []), r]);
  }
  for (const members of connected.values()) {
    const ids = unique(members.flatMap(idsFor));
    groups.push({
      kind: ids.length ? "WOO_COMPONENT" : "NO_CANDIDATE",
      title: ids.length
        ? ids.map((id) => products.get(id).name).join(" / ")
        : members[0].description,
      members,
      ids,
      extra: [],
      related: [],
    });
  }
  const seen = new Set();
  const cases = groups
    .map((g) => {
      const members = [...g.members]
        .sort((a, b) => order(a.barcode, b.barcode))
        .map((r) => {
          if (seen.has(r.barcode)) throw Error("OVERLAPPING_REVIEW_CASES");
          seen.add(r.barcode);
          return {
            barcode: r.barcode,
            description: r.description,
            department: r.fields.departamento,
            section: r.fields.categoria,
            public_price: r.fields.precio1,
            classification: r.classification,
            attributes: r.attributes ?? [],
            display_only: r.display_only ?? null,
            candidate_product_ids: idsFor(r),
            candidate_variation_ids: r.candidate_variation_ids ?? [],
            reasons: unique([
              ...(r.issues ?? []),
              ...(r.reasons ?? []),
              ...(r.commercial_checks ?? []),
              ...(holds.get(r.barcode) ?? []),
            ]),
          };
        });
      const candidates = g.ids.map((id) => {
        const p = products.get(id);
        let url = null;
        try {
          const u = new URL(p.permalink);
          if (u.protocol === "https:" && u.hostname === "vaquerosm.com")
            url = u.href;
        } catch {
          /* No invented URLs. */
        }
        return {
          id,
          name: p.name,
          status: p.status,
          short_description: p.short_description,
          url,
          attributes: p.attributes ?? [],
          variations: (p.variations ?? []).map((v) => ({
            id: v.id,
            status: v.status,
            attributes: v.attributes ?? [],
          })),
          already_staged_codes: snapshot.rows
            .filter((r) => r.current.woo_product_id === id)
            .map((r) => r.current.barcode)
            .sort(order),
        };
      });
      const evidence = {
        kind: g.kind,
        members,
        candidates,
        extra: g.extra,
        related: g.related,
      };
      return {
        case_id: digest([g.kind, members.map((r) => r.barcode)]),
        evidence_sha256: digest(evidence),
        title: g.title,
        question: labels[g.kind],
        ...evidence,
        status: "PENDING_HUMAN_REVIEW",
        import_allowed: false,
        send_allowed: false,
      };
    })
    .sort(
      (a, b) =>
        b.members.length - a.members.length || order(a.case_id, b.case_id),
    );
  if (seen.size !== pending.length || pending.some((r) => !seen.has(r.barcode)))
    throw Error("INCOMPLETE_REVIEW_PARTITION");
  const counts = (field) =>
    Object.fromEntries(
      unique(cases.flatMap((c) => c.members.map((r) => r[field]))).map(
        (value) => [
          value,
          cases.reduce(
            (n, c) => n + c.members.filter((r) => r[field] === value).length,
            0,
          ),
        ],
      ),
    );
  const packet = {
    version: "m9-review-backlog-1",
    sources_sha256: digest({ rows, snapshot, woo, exclusions }),
    summary: {
      source_rows: rows.length,
      staged_rows: loaded.size,
      pending_rows: pending.length,
      cases: cases.length,
      sicar_only_rows: pending.filter((r) => r.classification === "SICAR_ONLY")
        .length,
      by_classification: counts("classification"),
      by_department: counts("department"),
      top_twenty_rows: cases
        .slice(0, 20)
        .reduce((n, c) => n + c.members.length, 0),
      approved_for_import: 0,
    },
    inventory_included: false,
    write_allowed: false,
    send_allowed: false,
    cases,
  };
  return { ...packet, packet_sha256: digest(packet) };
}

// Answers are evidence to review, never import approval or a source correction.
export function collectReviewAnswers(packet, answers) {
  const { packet_sha256, ...body } = packet;
  if (
    packet.version !== "m9-review-backlog-1" ||
    digest(body) !== packet_sha256
  )
    throw Error("PACKET_CHANGED");
  if (!Array.isArray(answers)) throw Error("ANSWERS_REQUIRED");
  const cases = new Map(packet.cases.map((c) => [c.case_id, c])),
    seen = new Set();
  return answers.map((a) => {
    if (
      !a ||
      Object.keys(a).some(
        (k) =>
          ![
            "case_id",
            "packet_sha256",
            "evidence_sha256",
            "reviewer",
            "answer",
          ].includes(k),
      )
    )
      throw Error("UNSUPPORTED_ANSWER_FIELD");
    const c = cases.get(a.case_id);
    if (!c || seen.has(a.case_id)) throw Error("UNKNOWN_OR_DUPLICATE_CASE");
    seen.add(a.case_id);
    if (
      a.packet_sha256 !== packet_sha256 ||
      a.evidence_sha256 !== c.evidence_sha256
    )
      throw Error("STALE_ANSWER_EVIDENCE");
    if (
      typeof a.reviewer !== "string" ||
      !a.reviewer.trim() ||
      a.reviewer.length > 160 ||
      typeof a.answer !== "string" ||
      !a.answer.trim() ||
      a.answer.length > 8000
    )
      throw Error("REVIEWER_AND_ANSWER_REQUIRED");
    return {
      ...a,
      status: "ANSWER_RECORDED_REQUIRES_TECHNICAL_REVIEW",
      import_allowed: false,
      send_allowed: false,
    };
  });
}

export function backlogHtml(packet) {
  const data = json(packet).replaceAll("<", "\\u003c");
  const tasks = json(
    Object.fromEntries(packet.cases.map((c) => [c.case_id, reviewTasks(c)])),
  ).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Todo el pendiente de migración</title>
<style>body{font:16px system-ui;background:#f4f4ef;color:#243d32;margin:0}main{max-width:1150px;margin:auto;padding:24px}header{background:#234e3b;color:white;padding:24px;border-radius:16px}article{background:white;margin:20px 0;padding:20px;border-radius:12px}input,select,button{font:inherit;padding:12px;margin:8px}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}section{overflow:auto}small{overflow-wrap:anywhere}p{line-height:1.5}a{color:#215a40}</style>
<main><header><h1>Revisión completa de lo que falta</h1><p>${packet.summary.pending_rows} registros pendientes en ${packet.summary.cases} expedientes. Los primeros 20 reúnen ${packet.summary.top_twenty_rows} registros.</p></header>
<p>Los grupos sirven para revisar juntos datos relacionados. No significan que todos sean un mismo producto ni autorizan cargas. SICAR conserva sus códigos y precios; no incluimos existencias. Woo corresponde a la exportación histórica, no a una consulta actual.</p>
<input id="q" aria-label="Buscar" placeholder="Producto, código, ID Woo o motivo"><select id="type" aria-label="Tipo"><option value="">Todos los tipos</option>${Object.entries(
    labels,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      "",
    )}</select><p id="count"></p><button id="prev">Anterior</button><span id="page"></span><button id="next">Siguiente</button><div id="list"></div></main>
<script>const packet=${data};const tasks=${tasks};const q=document.getElementById('q'),type=document.getElementById('type'),list=document.getElementById('list');let page=0;function el(tag,text,p){const n=document.createElement(tag);n.textContent=text;p.append(n);return n;}function render(){const rows=packet.cases.filter(c=>(!type.value||c.kind===type.value)&&JSON.stringify(c).toLowerCase().includes(q.value.toLowerCase())),pages=Math.max(1,Math.ceil(rows.length/10));page=Math.min(page,pages-1);document.getElementById('count').textContent=rows.length+' expedientes · '+rows.reduce((n,c)=>n+c.members.length,0)+' registros';document.getElementById('page').textContent=(page+1)+' / '+pages;document.getElementById('prev').disabled=page===0;document.getElementById('next').disabled=page>=pages-1;list.replaceChildren();for(const c of rows.slice(page*10,page*10+10)){const a=document.createElement('article');list.append(a);el('h2',c.title,a);el('p',c.question+' · '+c.members.length+' códigos',a);el('small','Expediente '+c.case_id,a);for(const task of tasks[c.case_id])el('p',task,a);for(const w of c.candidates){el('h3','Woo '+w.id+': '+w.name+' ('+w.status+')',a);el('p','Código base en descripción corta: '+w.short_description,a);if(w.url){const link=el('a','Ver producto en Woo',a);link.href=w.url;link.target='_blank';link.rel='noopener noreferrer';}el('p',w.variations.length+' variaciones en el corte · '+w.already_staged_codes.length+' códigos ya cargados',a);}const section=document.createElement('section');a.append(section);const table=document.createElement('table');section.append(table);const head=document.createElement('tr');table.append(head);for(const t of ['Código','Descripción SICAR','Departamento / sección','Precio público','Motivos'])el('th',t,head);for(const r of c.members){const tr=document.createElement('tr');table.append(tr);for(const t of [r.barcode,r.description,r.department+' / '+r.section,r.public_price,r.reasons.join(' · ')])el('td',t,tr);}el('p','Responder con el expediente, qué códigos pertenecen al mismo modelo y qué talla/color/largo distingue cada uno. Si hay errores, indicar la corrección en SICAR y volver a exportar. La respuesta se revisa antes de cargar.',a);}}for(const n of [q,type])n.addEventListener('input',()=>{page=0;render();});document.getElementById('prev').onclick=()=>{page--;render();};document.getElementById('next').onclick=()=>{page++;render();};render();</script></html>`;
}

export async function prepareBacklog(configPath, output) {
  const config = JSON.parse(await readFile(configPath)),
    inputs = {};
  for (const key of ["rows", "snapshot", "woo", "exclusions"]) {
    const input = config.inputs?.[key];
    if (!input || !/^[a-f0-9]{64}$/.test(input.sha256))
      throw Error("PINNED_INPUT_REQUIRED");
    const bytes = await readFile(resolve(dirname(configPath), input.path));
    if (sha(bytes) !== input.sha256) throw Error("INPUT_HASH_CHANGED");
    inputs[key] = JSON.parse(bytes);
  }
  const packet = reviewBacklog(
    inputs.rows,
    inputs.snapshot,
    inputs.woo,
    inputs.exclusions,
  );
  const files = {
    "expedientes.json": json(packet),
    "resumen.json": json(packet.summary),
    "revision.html": backlogHtml(packet),
    "respuestas-pendientes.json": json(
      packet.cases.map((c) => ({
        case_id: c.case_id,
        packet_sha256: packet.packet_sha256,
        evidence_sha256: c.evidence_sha256,
        reviewer: "",
        answer: "",
      })),
    ),
    "trabajo-por-expediente.json": json(
      packet.cases.map((c) => ({
        case_id: c.case_id,
        rows: c.members.length,
        tasks: reviewTasks(c),
        import_allowed: false,
        send_allowed: false,
      })),
    ),
    "primeros-20.json": json({
      packet_sha256: packet.packet_sha256,
      rows: packet.summary.top_twenty_rows,
      cases: packet.cases.slice(0, 20),
      write_allowed: false,
      send_allowed: false,
    }),
    "prioridades-para-consulta.txt":
      "Primeros 20 expedientes por cantidad de códigos pendientes\n" +
      "No son necesariamente 20 productos: cada expediente puede contener modelos distintos. No se propone fusionarlos.\n" +
      "Para revisar con las tablas completas de revision.html. Los números corresponden exclusivamente a este paquete.\n\n" +
      packet.cases
        .slice(0, 20)
        .map(
          (c, i) =>
            `${i + 1}. ${c.title}\n${c.members.length} códigos pendientes. ${c.question}.\n${reviewTasks(c).join(" ")}\nExpediente: ${c.case_id}\n`,
        )
        .join("\n"),
    "resumen.txt":
      `Catálogo completo contabilizado: ${packet.summary.source_rows} registros.\n` +
      `Ya cargados según la captura verificada: ${packet.summary.staged_rows}.\n` +
      `Pendientes: ${packet.summary.pending_rows}, organizados en ${packet.summary.cases} expedientes.\n` +
      `Los primeros 20 reúnen ${packet.summary.top_twenty_rows} registros; no se aprueban automáticamente.\n` +
      "Este bloque prepara la revisión; no agrega productos ni modifica inventario o WooCommerce.\n" +
      "La captura de staging y el corte Woo son evidencia histórica verificada, no una lectura remota nueva.\n" +
      "Las respuestas se registran como testimonio y requieren revisión técnica antes de cualquier carga.\n",
  };
  for (let i = 0; i < packet.cases.length; i += 25)
    files[`bloque-${String(i / 25 + 1).padStart(3, "0")}.json`] = json({
      packet_sha256: packet.packet_sha256,
      cases: packet.cases.slice(i, i + 25),
      write_allowed: false,
      send_allowed: false,
    });
  files["sha256.json"] = json(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
  );
  await mkdir(output);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(output, name), value, { flag: "wx" });
  return packet.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [config, output] = process.argv.slice(2);
  if (!config || !output) throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT");
  console.log(await prepareBacklog(resolve(config), resolve(output)));
}
