const TOPICS = {
  museum: { emoji: "🖼️", label: "Museums", one: "Museum" },
  arch: { emoji: "🏛️", label: "Architecture", one: "Architecture" },
  culture: { emoji: "🛣️", label: "Culture & Americana", one: "Culture & Americana" },
  nature: { emoji: "🌲", label: "Nature & parks", one: "Nature" },
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let CFG, SITES, GUIDES, REFS, refById, refNum, map, layers;
const byId = {};

const state = {
  q: "",
  cats: new Set(Object.keys(TOPICS)),
  areas: new Set(),
  limit: Infinity,
  group: null,
  savedOnly: false,
  saved: new Set(),
  guide: null,
  active: null,
};

function store(key, value) {
  const k = "trip-" + CFG.key + "-" + key;
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(k));
    localStorage.setItem(k, JSON.stringify(value));
  } catch (e) {
    return null;
  }
}

function fmtDur(min) {
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function measure(s) {
  return CFG.mode === "drive" ? s.drive_min : s.air_mi;
}

function timeText(s) {
  if (CFG.mode === "drive") {
    if (s.drive_min < 15) return `in town · ${s.drive_mi} mi`;
    return `${fmtDur(s.drive_min)} drive · ${s.drive_mi} mi`;
  }
  const walk = s.air_mi <= 1.6 ? ` · about ${Math.max(5, Math.round(s.air_mi * 25 / 5) * 5)} min walk` : "";
  return `${s.air_mi} mi${walk}`;
}

function shortTime(s) {
  return CFG.mode === "drive" ? fmtDur(s.drive_min) : `${s.air_mi} mi`;
}

function areaName(code) {
  const a = CFG.areas.find(x => x[0] === code);
  return a ? a[1] : code;
}

function thumbUrl(img, width = 240) {
  if (!img || /\.svg$/i.test(img)) return null;
  return `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=${width}`;
}

function wikiUrl(title) {
  return "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
}

function directionsUrl(s) {
  const mode = CFG.mode === "drive" ? "driving" : "transit";
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=${mode}`;
}

function osmUrl(s) {
  return `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=16/${s.lat}/${s.lng}`;
}

function bandOf(s) {
  const v = measure(s);
  return CFG.bands.find(([, , lo, hi]) => v >= lo && v < hi) || CFG.bands[CFG.bands.length - 1];
}

function groupKey(s) {
  if (state.group === "cat") return TOPICS[s.cat].label;
  if (state.group === "area") return areaName(s.state);
  if (state.group === "band") return bandOf(s)[1];
  return s.region;
}

function matches(s, ignore) {
  if (ignore !== "cat" && !state.cats.has(s.cat)) return false;
  if (ignore !== "area" && !state.areas.has(s.state)) return false;
  if (measure(s) > state.limit) return false;
  if (state.savedOnly && !state.saved.has(s.id)) return false;
  if (state.guide && !state.guide.sites.includes(s.id)) return false;
  if (state.q) {
    const hay = `${s.name} ${s.desc} ${s.region} ${areaName(s.state)}`.toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

/* ---------- map ---------- */

function buildMap() {
  map = L.map("map", { zoomSnap: 0.5 });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  CFG.rings.forEach(r => {
    L.circle(CFG.origin, {
      radius: r * 1609.34, color: "#0b6b4f", weight: 1.2, opacity: 0.6,
      dashArray: "2 6", fill: false, interactive: false,
    }).addTo(map);
    const k = r / Math.SQRT2;
    const lat = CFG.origin[0] - k / 69.05;
    const lng = CFG.origin[1] - k / (69.17 * Math.cos(CFG.origin[0] * Math.PI / 180));
    L.marker([lat, lng], {
      interactive: false,
      icon: L.divIcon({ className: "", html: `<div class="ringlabel" style="transform:translate(-100%,0)">${r} mi</div>`, iconSize: [0, 0] }),
    }).addTo(map);
  });

  L.marker(CFG.origin, {
    icon: L.divIcon({ className: "", html: '<div class="origin" style="transform:translate(-50%,-50%) rotate(45deg)"></div>', iconSize: [0, 0] }),
    keyboard: false,
  }).addTo(map).bindTooltip(CFG.originName, { direction: "top", offset: [0, -10] });

  layers = { dots: L.layerGroup(), pins: L.layerGroup() };
  SITES.forEach(s => {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--c-" + s.cat).trim();
    s.dot = L.circleMarker([s.lat, s.lng], { radius: 6, weight: 2, color: "#fff", fillColor: color, fillOpacity: 1 });
    s.pin = L.marker([s.lat, s.lng], {
      title: s.name,
      icon: L.divIcon({
        className: "",
        html: `<div class="pin" style="--cat:var(--c-${s.cat});transform:translate(-50%,-50%)">${TOPICS[s.cat].emoji}</div>`,
        iconSize: [0, 0],
      }),
    });
    [s.dot, s.pin].forEach(m => {
      m.bindPopup(() => popupHtml(s), { maxWidth: 260 });
      m.on("click", () => setActive(s.id, false));
    });
  });

  map.on("zoomend", swapMarkers);
  map.on("popupopen", e => {
    const b = e.popup.getElement().querySelector("[data-show]");
    if (b) b.addEventListener("click", () => { map.closePopup(); setActive(b.dataset.show, false); });
  });
  map.fitBounds(L.latLngBounds(SITES.map(s => [s.lat, s.lng])).pad(0.05));
}

function swapMarkers() {
  const pins = map.getZoom() >= CFG.emojiZoom;
  map.removeLayer(pins ? layers.dots : layers.pins);
  map.addLayer(pins ? layers.pins : layers.dots);
}

function popupHtml(s) {
  const img = thumbUrl(s.img, 400);
  return `${img ? `<img src="${img}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <h4>${TOPICS[s.cat].emoji} ${esc(s.name)}</h4>
    <div class="pmeta">${TOPICS[s.cat].one} · ${esc(areaName(s.state))} · ${esc(timeText(s))}</div>
    <div>${esc(s.desc)}</div>
    <div class="links">
      <button class="btn" type="button" data-show="${s.id}">Show in list</button>
      <a class="btn" href="${directionsUrl(s)}" target="_blank" rel="noopener">Directions</a>
      ${s.wiki ? `<a class="btn" href="${wikiUrl(s.wiki)}" target="_blank" rel="noopener">Wikipedia</a>` : ""}
    </div>`;
}

function fitTo(items) {
  if (!items.length) return;
  map.fitBounds(L.latLngBounds(items.map(s => [s.lat, s.lng])).pad(0.15), { maxZoom: CFG.maxZoom });
}

/* ---------- filters and list ---------- */

function buildFilters() {
  const cats = $("cats");
  Object.entries(TOPICS).forEach(([k, t]) => {
    cats.insertAdjacentHTML("beforeend",
      `<button type="button" class="chip" data-cat="${k}">${t.emoji} ${t.label} <span class="n"></span></button>`);
  });
  cats.addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (b) toggle(state.cats, b.dataset.cat);
  });

  const areas = $("areas");
  CFG.areas.forEach(([k, label]) => {
    areas.insertAdjacentHTML("beforeend",
      `<button type="button" class="chip" data-area="${esc(k)}">${esc(label)} <span class="n"></span></button>`);
  });
  areas.addEventListener("click", e => {
    const b = e.target.closest("[data-area]");
    if (b) toggle(state.areas, b.dataset.area);
  });

  $("cat-all").addEventListener("click", () => {
    const all = state.cats.size === Object.keys(TOPICS).length;
    state.cats = new Set(all ? [] : Object.keys(TOPICS));
    render(true);
  });
  $("area-all").addEventListener("click", () => {
    const all = state.areas.size === CFG.areas.length;
    state.areas = new Set(all ? [] : CFG.areas.map(a => a[0]));
    render(true);
  });

  const dist = $("dist");
  if (CFG.mode === "drive") {
    dist.min = 0.5; dist.max = 15; dist.step = 0.5;
  } else {
    dist.min = 1; dist.max = 25; dist.step = 1;
  }
  dist.value = dist.max;
  dist.addEventListener("input", () => {
    const v = +dist.value;
    const atMax = v >= +dist.max;
    state.limit = atMax ? Infinity : (CFG.mode === "drive" ? v * 60 : v);
    render(true);
  });

  const group = $("group");
  CFG.groups.forEach(([k, label]) => group.add(new Option(label, k)));
  group.value = state.group;
  group.addEventListener("change", () => { state.group = group.value; store("group", state.group); render(false); });

  $("saved").addEventListener("change", e => { state.savedOnly = e.target.checked; render(true); });

  let timer;
  $("q").addEventListener("input", e => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(true); }, 150);
  });
}

function toggle(set, k) {
  set.has(k) ? set.delete(k) : set.add(k);
  render(true);
}

function render(fit) {
  const shown = SITES.filter(s => matches(s));

  document.querySelectorAll("[data-cat]").forEach(b => {
    b.setAttribute("aria-pressed", state.cats.has(b.dataset.cat));
    b.querySelector(".n").textContent = SITES.filter(s => s.cat === b.dataset.cat && matches(s, "cat")).length;
  });
  document.querySelectorAll("[data-area]").forEach(b => {
    b.setAttribute("aria-pressed", state.areas.has(b.dataset.area));
    b.querySelector(".n").textContent = SITES.filter(s => s.state === b.dataset.area && matches(s, "area")).length;
  });
  $("dist-val").textContent = state.limit === Infinity ? "any"
    : CFG.mode === "drive" ? `within ${fmtDur(state.limit)}` : `within ${state.limit} mi`;

  const groups = new Map();
  shown.slice().sort((a, b) => measure(a) - measure(b)).forEach(s => {
    const k = groupKey(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  });
  const ordered = [...groups.entries()];
  if (state.group === "cat") {
    const order = Object.values(TOPICS).map(t => t.label);
    ordered.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }
  if (state.group === "area") {
    const order = CFG.areas.map(a => a[1]);
    ordered.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }

  $("count").textContent = `${shown.length} sites · ${groups.size} groups`;

  const banner = state.guide
    ? `<div class="ghead"><h2>Guide: ${esc(state.guide.title)}</h2><button class="btn" type="button" id="clear-guide">Show all</button></div>`
    : "";
  const list = $("list");
  if (!shown.length) {
    list.innerHTML = banner + `<div class="empty">No sites match these filters. Widen the time or distance, turn topics back on, or clear the search.</div>`;
  } else {
    list.innerHTML = banner + ordered.map(([name, items], gi) => `
      <section class="group">
        <div class="ghead">
          <h2>${esc(name)}</h2>
          <span class="meta">${items.length} · from ${esc(shortTime(items[0]))}</span>
          <button class="btn" type="button" data-fit="${gi}">Map</button>
        </div>
        ${items.map(cardHtml).join("")}
      </section>`).join("");
  }
  list.querySelectorAll("[data-fit]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    fitTo(ordered[+b.dataset.fit][1]);
    if (isPhone()) $("map").scrollIntoView({ behavior: "smooth" });
  }));
  const clear = $("clear-guide");
  if (clear) clear.addEventListener("click", () => { state.guide = null; render(true); });

  layers.dots.clearLayers();
  layers.pins.clearLayers();
  shown.forEach(s => { layers.dots.addLayer(s.dot); layers.pins.addLayer(s.pin); });
  swapMarkers();
  if (fit) fitTo(shown);
}

function cardHtml(s) {
  const t = TOPICS[s.cat];
  const img = thumbUrl(s.img);
  const saved = state.saved.has(s.id);
  const src = s.refs.map(id => {
    const r = refById[id];
    const label = r.short || (r.kind === "book" ? r.title.split(":")[0] : r.title);
    return `<a href="#ref-${id}" data-ref="${id}">[${refNum[id]}] ${esc(label)}</a>`;
  }).join("; ");
  return `<article class="card${state.active === s.id ? " active" : ""}" id="card-${s.id}" data-id="${s.id}" style="--cat:var(--c-${s.cat})">
    <div class="thumb">${img ? `<img src="${img}" alt="" loading="lazy" onerror="this.remove()">` : t.emoji}</div>
    <div>
      <h3>${t.emoji} ${esc(s.name)}</h3>
      <button class="star" type="button" data-star="${s.id}" aria-pressed="${saved}" aria-label="Save ${esc(s.name)}">${saved ? "★" : "☆"}</button>
      <div class="sub"><span class="t">${esc(timeText(s))}</span><span>${esc(areaName(s.state))}</span></div>
      <p>${esc(s.desc)}</p>
      <div class="src">Sources: ${src}</div>
      <div class="links">
        ${s.wiki ? `<a class="btn" href="${wikiUrl(s.wiki)}" target="_blank" rel="noopener">Wikipedia</a>` : ""}
        ${s.url ? `<a class="btn" href="${s.url}" target="_blank" rel="noopener">Official site</a>` : ""}
        <a class="btn" href="${directionsUrl(s)}" target="_blank" rel="noopener">Directions</a>
        <a class="btn" href="${osmUrl(s)}" target="_blank" rel="noopener">OpenStreetMap</a>
      </div>
      ${img ? `<div class="credit">Photo: <a href="https://en.wikipedia.org/wiki/File:${encodeURIComponent(s.img)}" target="_blank" rel="noopener">Wikimedia Commons, see file page for author and license</a></div>` : ""}
    </div>
  </article>`;
}

const isPhone = () => matchMedia("(max-width: 820px)").matches;

function setActive(id, fromList) {
  document.querySelectorAll(".card.active").forEach(c => c.classList.remove("active"));
  state.active = id;
  const card = $("card-" + id);
  if (!card) return;
  card.classList.add("active");
  if (!fromList) card.scrollIntoView({ behavior: "smooth", block: isPhone() ? "nearest" : "center" });
}

function focusSite(s) {
  showView("map");
  if (!matches(s)) {
    state.guide = null;
    state.q = "";
    $("q").value = "";
    state.cats.add(s.cat);
    state.areas.add(s.state);
    state.limit = Infinity;
    $("dist").value = $("dist").max;
    render(false);
  }
  setActive(s.id, false);
  map.setView([s.lat, s.lng], Math.max(map.getZoom(), CFG.focusZoom));
  setTimeout(() => (map.getZoom() >= CFG.emojiZoom ? s.pin : s.dot).openPopup(), 300);
}

function bindList() {
  $("list").addEventListener("click", e => {
    const star = e.target.closest("[data-star]");
    if (star) {
      const id = star.dataset.star;
      state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
      store("saved", [...state.saved]);
      star.setAttribute("aria-pressed", state.saved.has(id));
      star.textContent = state.saved.has(id) ? "★" : "☆";
      if (state.savedOnly) render(false);
      return;
    }
    const ref = e.target.closest("[data-ref]");
    if (ref) {
      e.preventDefault();
      showView("refs", ref.dataset.ref);
      return;
    }
    if (e.target.closest("a, button")) return;
    const card = e.target.closest(".card");
    if (!card) return;
    const s = byId[card.dataset.id];
    setActive(s.id, true);
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), CFG.focusZoom));
    (map.getZoom() >= CFG.emojiZoom ? s.pin : s.dot).openPopup();
    if (isPhone()) $("map").scrollIntoView({ behavior: "smooth" });
  });
}

/* ---------- trip guides ---------- */

function guideTime(g) {
  if (CFG.mode === "drive") {
    return g.min_min === g.max_min ? `${fmtDur(g.min_min)} from ${CFG.originName}`
      : `${fmtDur(g.min_min)} to ${fmtDur(g.max_min)} from ${CFG.originName}`;
  }
  return `${g.min_mi} to ${g.max_mi} mi from ${CFG.originName}`;
}

function guideCard(g) {
  const items = g.sites.map(id => byId[id]);
  const mix = Object.entries(TOPICS)
    .map(([k, t]) => [t, items.filter(s => s.cat === k).length])
    .filter(([, n]) => n)
    .map(([t, n]) => `<span>${t.emoji} ${n} ${t.label.toLowerCase()}</span>`).join("");
  const list = items.map(s => `<li><span>${TOPICS[s.cat].emoji}</span>
      <button type="button" data-goto="${s.id}">${esc(s.name)}</button>
      <span class="t">${esc(shortTime(s))}</span></li>`).join("");
  const acts = g.link
    ? `<a class="btn" href="${g.link}">Open the Chicago guide</a>`
    : `<button class="btn" type="button" data-guide="${g.id}">Show on map</button>`;
  return `<article class="guide">
    <h3>${esc(g.title)}</h3>
    <div class="time">${esc(guideTime(g))}${g.states ? " · " + g.states.join(", ") : ""}</div>
    ${mix ? `<div class="mix">${mix}</div>` : ""}
    <p>${esc(g.intro)}</p>
    ${list ? `<ol>${list}</ol>` : ""}
    <div class="acts">${acts}</div>
  </article>`;
}

function renderGuides() {
  const view = $("view-guides");
  let html = `<p class="intro">${esc(CFG.guideIntro)}</p>`;
  if (CFG.mode === "drive") {
    CFG.bands.forEach(([key, label]) => {
      const gs = GUIDES.filter(g => g.band === key);
      if (!gs.length) return;
      const n = gs.reduce((a, g) => a + g.sites.length, 0);
      html += `<h2><span class="eyebrow">${gs.length} guides · ${n} sites</span>${esc(label)}</h2>
        <div class="guides">${gs.map(guideCard).join("")}</div>`;
    });
  } else {
    html += `<div class="guides">${GUIDES.map(guideCard).join("")}</div>`;
  }
  view.innerHTML = html;
}

function bindGuides() {
  $("view-guides").addEventListener("click", e => {
    const go = e.target.closest("[data-goto]");
    if (go) return focusSite(byId[go.dataset.goto]);
    const gb = e.target.closest("[data-guide]");
    if (!gb) return;
    state.guide = GUIDES.find(g => g.id === gb.dataset.guide);
    state.cats = new Set(Object.keys(TOPICS));
    state.areas = new Set(CFG.areas.map(a => a[0]));
    state.limit = Infinity;
    $("dist").value = $("dist").max;
    state.q = "";
    $("q").value = "";
    showView("map");
    render(true);
    if (isPhone()) $("map").scrollIntoView({ behavior: "smooth" });
  });
}

/* ---------- references ---------- */

function citeHtml(r) {
  if (r.kind === "book") return `${esc(r.author)}. <i>${esc(r.title)}</i>. ${esc(r.pub)}.`;
  return `${esc(r.author)}. ${esc(r.title)}. <span style="font-family:var(--mono);font-size:.85em">${esc(r.pub)}</span>`;
}

function renderRefs() {
  const block = kind => REFS.filter(r => r.kind === kind).map(r => {
    const cited = SITES.filter(s => s.refs.includes(r.id)).sort((a, b) => measure(a) - measure(b));
    const chips = r.id === "wiki"
      ? `<span class="note">Linked from every site that has an article.</span>`
      : cited.map(s => `<button type="button" data-goto="${s.id}">${TOPICS[s.cat].emoji} ${esc(s.name)}</button>`).join("");
    return `<div class="ref" id="ref-${r.id}">
      <div class="num">${refNum[r.id] ? `[${refNum[r.id]}]` : ""}</div>
      <div class="cite">${citeHtml(r)}</div>
      <div class="acts"><a href="${r.url}" target="_blank" rel="noopener">${r.kind === "book" ? "Find in a library (WorldCat)" : "Open website"}</a>${cited.length ? ` · cited for ${cited.length} sites` : ""}</div>
      <div class="cited">${chips}</div>
    </div>`;
  }).join("");
  $("view-refs").innerHTML = `
    <p class="intro">Every site cites at least one of these sources. Publications link to WorldCat so you can find a library copy; institutions link to their own sites. Tap a site to see it on the map.</p>
    <h2>Publications and guidebooks</h2>${block("book")}
    <h2>Institutions and reference websites</h2>${block("web")}
    <p class="note">${CFG.mode === "drive"
      ? "Driving times and road distances come from OpenStreetMap routing (OSRM) without traffic."
      : "Distances are straight-line from Union Station."}
      Photos and article links come from Wikipedia and Wikimedia Commons. Check hours, seasons and reservations on each official site before you go.</p>`;
}

function bindRefs() {
  $("view-refs").addEventListener("click", e => {
    const b = e.target.closest("[data-goto]");
    if (b) focusSite(byId[b.dataset.goto]);
  });
}

/* ---------- views ---------- */

function showView(name, refId) {
  ["map", "guides", "refs"].forEach(v => { $("view-" + v).hidden = v !== name; });
  document.querySelectorAll("[data-view]").forEach(b => {
    if (b.dataset.view === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (name === "map") setTimeout(() => map.invalidateSize(), 0);
  if (refId) {
    const el = $("ref-" + refId);
    el.classList.add("hl");
    setTimeout(() => el.classList.remove("hl"), 2500);
    el.scrollIntoView({ block: "center" });
  } else if (name !== "map") {
    window.scrollTo(0, 0);
  }
  const hash = { map: "", guides: "#guides", refs: "#references" }[name];
  history.replaceState(null, "", location.pathname + hash);
}

/* ---------- start ---------- */

function slug(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function airMiles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function buildGuides(intros) {
  const byRegion = new Map();
  SITES.forEach(s => {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region).push(s);
  });
  const guides = [...byRegion].map(([title, items]) => {
    items.sort((a, b) => a.drive_min - b.drive_min);
    const mins = items.map(s => s.drive_min);
    const n = mins.length;
    const median = Math.round((mins[(n - 1) >> 1] + mins[n >> 1]) / 2);
    const band = CFG.bands.find(([, , lo, hi]) => median >= lo && median < hi)[0];
    return {
      id: "g-" + slug(title), band, title,
      intro: intros[title] || "",
      median_min: median, min_min: mins[0], max_min: mins[n - 1],
      states: [...new Set(items.map(s => s.state))].sort(),
      sites: items.map(s => s.id),
    };
  });
  return guides.concat(CFG.extraGuides || []).sort((a, b) => a.median_min - b.median_min);
}

async function start() {
  const main = document.body.dataset.dataset;
  const dir = main.slice(0, main.lastIndexOf("/") + 1);
  let data, parts, refs;
  try {
    data = await loadJson(main);
    CFG = data.config;
    [parts, refs] = await Promise.all([
      Promise.all((CFG.files || []).map(f => loadJson(dir + f))),
      loadJson(dir + CFG.references),
    ]);
  } catch (e) {
    const help = location.protocol === "file:"
      ? "Browsers block reading the data files when a page is opened directly from disk. Serve the folder instead, for example run <code>python3 -m http.server</code> inside it and open http://localhost:8000."
      : `A data file could not be loaded (${esc(e.message)}).`;
    $("list").innerHTML = `<div class="empty">${help}</div>`;
    return;
  }

  SITES = data.sites || [];
  const intros = {};
  if (parts.length) {
    CFG.areas = parts.map(p => [p.state, p.name]);
    parts.forEach(p => {
      Object.entries(p.regions || {}).forEach(([k, v]) => { if (!intros[k]) intros[k] = v; });
      p.sites.forEach(s => SITES.push({ ...s, state: p.state, id: `${p.state}-${slug(s.name)}` }));
    });
  }
  SITES.forEach(s => {
    s.air_mi = Math.round(airMiles(CFG.origin, [s.lat, s.lng]) * 10) / 10;
    if (CFG.mode === "drive" && s.drive_min == null) {
      s.drive_mi = Math.round(s.air_mi * 1.2);
      s.drive_min = Math.round(s.drive_mi / 55 * 60);
    }
    byId[s.id] = s;
  });
  GUIDES = data.guides || buildGuides(intros);
  if (CFG.mode !== "drive") {
    GUIDES.forEach(g => {
      const d = g.sites.map(id => byId[id].air_mi);
      g.min_mi = Math.min(...d);
      g.max_mi = Math.max(...d);
    });
  }

  REFS = refs.filter(r => r.id === "wiki" || SITES.some(s => s.refs.includes(r.id)));
  refById = Object.fromEntries(REFS.map(r => [r.id, r]));
  refNum = {};
  REFS.filter(r => r.id !== "wiki").forEach((r, i) => { refNum[r.id] = i + 1; });

  state.areas = new Set(CFG.areas.map(a => a[0]));
  state.group = store("group") || CFG.groups[0][0];
  state.saved = new Set(store("saved") || []);

  $("from").textContent = CFG.subtitle;
  buildMap();
  buildFilters();
  bindList();
  renderGuides();
  bindGuides();
  renderRefs();
  bindRefs();
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  if (isPhone()) $("filters").open = false;
  render(false);

  if (location.hash === "#guides") showView("guides");
  if (location.hash === "#references") showView("refs");
}

start();
