// Public website logic: loads prices, photos and business info from
// Firestore and builds the WhatsApp booking message.
import { canUseFirebase, getActiveConfig, USE_EMULATORS, FIREBASE_SDK } from "./firebase-config.js";
import {
  BUSINESS_NAME, DEFAULT_PHONE, DEFAULT_WHATSAPP, DEFAULT_AREAS, DEFAULT_HOURS, DEFAULT_FAQ,
  DEFAULT_SERVICES, VEHICLE_SIZES, esc, formatKwacha, hasPrice, digitsOnly, isSafeImage
} from "./defaults.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  services: [],
  settings: { phone: DEFAULT_PHONE, whatsapp: DEFAULT_WHATSAPP, areas: DEFAULT_AREAS, hours: DEFAULT_HOURS, faq: DEFAULT_FAQ },
  fs: null,
  db: null
};

const ICONS = {
  "car": "bi-car-front-fill",
  "home": "bi-house-heart-fill"
};

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

// First letter upper-case ("horse only" -> "Horse only"), used for service names everywhere on the site
function capitalise(text) {
  const t = String(text ?? "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------- prices
function priceText(service, sizeKey) {
  if (service.category === "car") {
    const v = service.prices?.[sizeKey];
    return hasPrice(v) ? formatKwacha(v) : "";
  }
  return hasPrice(service.price) ? `${formatKwacha(service.price)}${service.unit ? " " + service.unit : ""}` : "";
}

// Vehicle sizes that have a price for this service (all sizes if none are priced yet).
function pricedSizes(s) {
  const priced = VEHICLE_SIZES.filter(({ key }) => hasPrice(s?.prices?.[key]));
  return priced.length ? priced : VEHICLE_SIZES;
}

function lowestPrice(s) {
  const values = s.category === "car"
    ? VEHICLE_SIZES.map(({ key }) => s.prices?.[key])
    : [s.price];
  const valid = values.filter(hasPrice);
  return valid.length ? Math.min(...valid) : null;
}

function carHasAnyPrice(s) {
  return VEHICLE_SIZES.some(({ key }) => hasPrice(s.prices?.[key]));
}

// ---------------------------------------------------------------- render: services
function serviceCard(s) {
  const bullets = (s.bullets || []).filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join("");
  let priceHtml;
  if (s.category === "car") {
    priceHtml = carHasAnyPrice(s)
      ? `<table class="table table-sm price-table"><caption class="visually-hidden">Prices for ${esc(s.name)} by vehicle size</caption><tbody>${
          VEHICLE_SIZES.filter(({ key }) => hasPrice(s.prices?.[key])).map(({ key, label }) =>
            `<tr><th scope="row">${esc(label)}</th><td>${esc(formatKwacha(s.prices[key]))}</td></tr>`
          ).join("")
        }</tbody></table>`
      : "";
  } else {
    priceHtml = hasPrice(s.price)
      ? `<p class="price-big mb-3">${esc(formatKwacha(s.price))} <small>${esc(s.unit || "")}</small></p>`
      : "";
  }
  const colClass = s.category === "car" ? "col-sm-6 col-xl-3" : "col-md-6 col-lg-5";
  const from = lowestPrice(s);
  return `
    <div class="${colClass}">
      <article class="service-card svc-${s.category}">
        <div class="service-media">
          <div class="service-img" ${s.imageId ? `data-image-id="${esc(s.imageId)}"` : ""}>
            <i class="bi ${ICONS[s.category]}" aria-hidden="true"></i>
          </div>
          ${from ? `<span class="svc-chip">From ${esc(formatKwacha(from))}</span>` : ""}
        </div>
        <div class="service-body">
          <h4 class="h5">${esc(s.name)}</h4>
          ${s.description ? `<p>${esc(s.description)}</p>` : ""}
          ${bullets ? `<ul class="check-list">${bullets}</ul>` : ""}
          <div class="mt-auto">
            ${priceHtml}
            <button type="button" class="btn btn-primary btn-pill w-100" data-book="${esc(s.id)}">
              <i class="bi bi-whatsapp me-1"></i> Book this
            </button>
          </div>
        </div>
      </article>
    </div>`;
}

function renderServices() {
  const active = state.services.filter((s) => s.active !== false);
  const groups = { car: $("#carServices"), home: $("#homeServices") };
  for (const [cat, el] of Object.entries(groups)) {
    const list = active.filter((s) => s.category === cat);
    el.innerHTML = list.length
      ? list.map(serviceCard).join("")
      : `<div class="col-12"><p class="text-muted">Please contact us on WhatsApp for these services.</p></div>`;
    el.setAttribute("aria-busy", "false");
  }

  // Hero card: list the services you actually offer, plus the "from K…" price
  for (const [cat, rowId, listId] of [["car", "heroCar", "heroCarList"], ["home", "heroHome", "heroHomeList"]]) {
    const names = active.filter((s) => s.category === cat).map((s) => s.name).filter(Boolean);
    $("#" + listId).textContent = names.join(" · ");
    $("#" + rowId).hidden = !names.length;
  }

  // "From K…" prices in the hero card
  for (const [cat, id] of [["car", "heroCarFrom"], ["home", "heroHomeFrom"]]) {
    const prices = active.filter((s) => s.category === cat).map(lowestPrice).filter(Boolean);
    const slot = $("#" + id);
    slot.innerHTML = prices.length ? `<small>from</small>${esc(formatKwacha(Math.min(...prices)))}` : "";
    slot.hidden = !prices.length;
  }

  // Booking dropdown
  const select = $("#bService");
  const current = select.value;
  select.innerHTML = `<option value="">Choose a service…</option>` +
    ["car", "home"].map((cat) => {
      const opts = active.filter((s) => s.category === cat)
        .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
      return opts ? `<optgroup label="${cat === "car" ? "Car care" : "Home cleaning"}">${opts}</optgroup>` : "";
    }).join("");
  if (active.some((s) => s.id === current)) select.value = current;
  updateBookingUI();
}

// ---------------------------------------------------------------- render: settings
function renderSettings() {
  const st = state.settings;
  const wa = digitsOnly(st.whatsapp) || DEFAULT_WHATSAPP;
  const telDigits = digitsOnly(st.phone) || wa;

  $$("[data-wa-link]").forEach((a) => {
    const text = a.dataset.waText;
    a.href = `https://wa.me/${wa}` + (text ? `?text=${encodeURIComponent(text)}` : "");
  });
  $$("[data-tel-link]").forEach((a) => { a.href = `tel:+${telDigits}`; });
  $$("[data-phone-text]").forEach((el) => { el.textContent = st.phone || DEFAULT_PHONE; });

  const hours = st.hours || DEFAULT_HOURS;
  $("#hoursText").textContent = hours;
  $("#footHours").textContent = hours;

  const areas = (st.areas && st.areas.length ? st.areas : DEFAULT_AREAS);
  $("#areaList").innerHTML = areas.map((a) => `<li>${esc(a)}</li>`).join("");
  const areaSelect = $("#bArea");
  const current = areaSelect.value;
  areaSelect.innerHTML = `<option value="">Choose your area…</option>` +
    areas.map((a) => `<option>${esc(a)}</option>`).join("") +
    `<option value="__other">Other (type below)</option>`;
  if ([...areaSelect.options].some((o) => o.value === current)) areaSelect.value = current;

  const faq = (st.faq && st.faq.length ? st.faq : DEFAULT_FAQ);
  $("#faqList").innerHTML = faq.map((f, i) => `
    <div class="accordion-item">
      <h3 class="accordion-header">
        <button class="accordion-button ${i ? "collapsed" : ""}" type="button" data-bs-toggle="collapse"
                data-bs-target="#faq${i}" aria-expanded="${i ? "false" : "true"}" aria-controls="faq${i}">${esc(f.q)}</button>
      </h3>
      <div id="faq${i}" class="accordion-collapse collapse ${i ? "" : "show"}" data-bs-parent="#faqList">
        <div class="accordion-body">${esc(f.a)}</div>
      </div>
    </div>`).join("");
}

function showNotice(html) {
  const n = $("#dataNotice");
  n.innerHTML = html;
  n.classList.remove("d-none");
}

// ---------------------------------------------------------------- images
async function getImage(id) {
  const snap = await state.fs.getDoc(state.fs.doc(state.db, "images", id));
  const data = snap.exists() ? snap.data() : null;
  return data && isSafeImage(data.dataUrl) ? data : null;
}

async function loadBrandImages() {
  const [hero, logo] = await Promise.allSettled([getImage("hero"), getImage("logo")]);
  if (hero.value) {
    const h = $(".hero");
    h.style.setProperty("--hero-photo", `url("${hero.value.dataUrl}")`);
    h.classList.add("has-photo");
  }
  if (logo.value) {
    for (const id of ["navLogo", "footLogo"]) {
      const img = document.getElementById(id);
      img.src = logo.value.dataUrl;
      img.classList.remove("d-none");
    }
    $("#navLogoIcon").classList.add("d-none");
    $("#footLogoIcon").classList.add("d-none");
  }
}

async function loadServiceImages() {
  await Promise.allSettled($$(".service-img[data-image-id]").map(async (box) => {
    const img = await getImage(box.dataset.imageId);
    if (!img) return;
    const name = box.closest(".service-card").querySelector("h4").textContent;
    box.innerHTML = `<img src="${img.dataUrl}" alt="${esc(name)}" loading="lazy" decoding="async">`;
  }));
}

async function loadGallery() {
  const grid = $("#galleryGrid");
  const fs = state.fs;
  if (!fs) {
    grid.innerHTML = emptyGallery();
    return;
  }
  try {
    const col = fs.collection(state.db, "images");
    let docs;
    try {
      docs = (await fs.getDocs(fs.query(col, fs.where("type", "==", "gallery"), fs.orderBy("order"), fs.limit(48)))).docs;
    } catch (e) {
      // Index not deployed yet – fall back to unsorted query and sort here.
      docs = (await fs.getDocs(fs.query(col, fs.where("type", "==", "gallery")))).docs;
    }
    const items = docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => isSafeImage(d.dataUrl))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!items.length) { grid.innerHTML = emptyGallery(); return; }
    grid.innerHTML = items.map((g, i) => {
      const label = g.label === "before" || g.label === "after" ? g.label : "";
      const alt = g.caption || `${label ? label + " – " : ""}Smart-Mobile Car Wash work photo ${i + 1}`;
      return `
        <div class="col-6 col-md-4 col-lg-3">
          <button type="button" class="gallery-item" data-index="${i}" aria-label="View photo: ${esc(alt)}">
            <img src="${g.dataUrl}" alt="${esc(alt)}" loading="lazy" decoding="async">
            ${label ? `<span class="gallery-label ${label}">${label}</span>` : ""}
            ${g.caption ? `<span class="gallery-caption">${esc(g.caption)}</span>` : ""}
          </button>
        </div>`;
    }).join("");
    const modal = new bootstrap.Modal("#lightbox");
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".gallery-item");
      if (!btn) return;
      const g = items[Number(btn.dataset.index)];
      $("#lightboxImg").src = g.dataUrl;
      $("#lightboxImg").alt = g.caption || "Work photo";
      $("#lightboxCaption").textContent = [g.label ? g.label.toUpperCase() : "", g.caption || ""].filter(Boolean).join(" – ");
      modal.show();
    });
  } catch (e) {
    console.warn("Gallery could not load:", e.message);
    grid.innerHTML = emptyGallery();
  }
}

function emptyGallery() {
  return `<div class="col-12 text-center text-muted py-3">Photos of our recent work are coming soon.
    <a data-wa-link href="https://wa.me/${digitsOnly(state.settings.whatsapp) || DEFAULT_WHATSAPP}" target="_blank" rel="noopener">Ask us on WhatsApp</a> for examples.</div>`;
}

function lazyGallery() {
  const section = $("#gallery");
  if (!("IntersectionObserver" in window)) { loadGallery(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); loadGallery(); }
  }, { rootMargin: "400px" });
  io.observe(section);
}

// ---------------------------------------------------------------- reviews
const REVIEWS_SHOWN_FIRST = 6;

function starsHtml(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return `<span class="stars" role="img" aria-label="${r} out of 5 stars">${"★".repeat(r)}<span class="off">${"★".repeat(5 - r)}</span></span>`;
}

function reviewCard(r, hidden) {
  const name = String(r.name || "Customer").trim();
  const meta = [r.area, capitalise(r.service)].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="col-md-6 col-lg-4" ${hidden ? "hidden data-more-review" : ""}>
      <figure class="review-card mb-0">
        ${starsHtml(r.rating)}
        <blockquote class="pre-line">${esc(r.text)}</blockquote>
        <figcaption>
          <span class="review-avatar" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>
          <span><strong>${esc(name)}</strong>${meta ? `<small>${meta}</small>` : ""}</span>
        </figcaption>
      </figure>
    </div>`;
}

async function loadReviews() {
  const fs = state.fs;
  if (!fs) return;
  try {
    const snap = await fs.getDocs(fs.query(fs.collection(state.db, "reviews"), fs.where("active", "==", true)));
    const reviews = snap.docs.map((d) => d.data())
      .filter((r) => r.text && Number(r.rating) >= 1)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!reviews.length) return; // section stays hidden until you add reviews

    const avg = reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length;
    $("#reviewSummary").innerHTML =
      `<span class="score">${avg.toFixed(1)}</span>${starsHtml(avg)}<span>from ${reviews.length} customer review${reviews.length === 1 ? "" : "s"}</span>`;
    $("#reviewGrid").innerHTML = reviews.map((r, i) => reviewCard(r, i >= REVIEWS_SHOWN_FIRST)).join("");

    const more = $("#reviewMore");
    if (reviews.length > REVIEWS_SHOWN_FIRST) {
      more.hidden = false;
      more.textContent = `Show all ${reviews.length} reviews`;
      more.addEventListener("click", () => {
        $$("[data-more-review]").forEach((el) => { el.hidden = false; });
        more.hidden = true;
      }, { once: true });
    }
    $("#reviews").hidden = false;
    $("#navReviews").hidden = false;
  } catch (e) {
    console.warn("Reviews could not load:", e.message);
  }
}

// ---------------------------------------------------------------- booking
function selectedService() {
  return state.services.find((s) => s.id === $("#bService").value) || null;
}

function updateBookingUI() {
  const s = selectedService();
  const sizeWrap = $("#bSizeWrap");
  const size = $("#bSize");
  const isCar = s?.category === "car";
  sizeWrap.classList.toggle("d-none", !isCar);
  size.required = isCar;

  // Only offer the vehicle sizes this service has prices for
  const sizes = pricedSizes(isCar ? s : null);
  const sizeKeys = sizes.map((v) => v.key).join(",");
  if (size.dataset.keys !== sizeKeys) {
    const keep = size.value;
    size.innerHTML = (sizes.length > 1 ? `<option value="">Choose vehicle size…</option>` : "") +
      sizes.map((v) => `<option value="${v.key}">${esc(v.label)}</option>`).join("");
    size.dataset.keys = sizeKeys;
    if (sizes.some((v) => v.key === keep)) size.value = keep;
  }

  const box = $("#priceBox");
  if (!s) { box.classList.add("d-none"); return; }
  let text;
  if (isCar) {
    const p = size.value ? priceText(s, size.value) : "";
    text = p ? `Price for ${s.name} (${VEHICLE_SIZES.find((v) => v.key === size.value).label}): ${p}`
             : carHasAnyPrice(s) && !size.value ? `Choose your vehicle size to see the price.` : "";
  } else {
    const p = priceText(s);
    text = p ? `Price for ${s.name}: ${p}` : "";
  }
  box.textContent = text;
  box.classList.toggle("d-none", !text);
}

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function bindBookingForm() {
  $("#bSize").innerHTML = `<option value="">Choose vehicle size…</option>` +
    VEHICLE_SIZES.map((v) => `<option value="${v.key}">${esc(v.label)}</option>`).join("");

  const date = $("#bDate");
  // Earliest bookable time = now (refreshed whenever the field is used).
  const nowMinute = () => { const d = new Date(); d.setSeconds(0, 0); return d; };
  const refreshMin = () => { date.min = toLocalInputValue(nowMinute()); };
  refreshMin();
  date.addEventListener("focus", refreshMin);

  $("#bService").addEventListener("change", updateBookingUI);
  $("#bSize").addEventListener("change", updateBookingUI);
  $("#bArea").addEventListener("change", () => {
    const other = $("#bArea").value === "__other";
    $("#bAreaOtherWrap").classList.toggle("d-none", !other);
    $("#bAreaOther").required = other;
    if (other) $("#bAreaOther").focus();
  });

  // "Book this" buttons on service cards
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-book]");
    if (!btn) return;
    $("#bService").value = btn.dataset.book;
    updateBookingUI();
    $("#book").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(() => $("#bName").focus({ preventScroll: true }), 400);
  });

  // Close mobile menu after tapping a link
  $$("#navMenu a").forEach((a) => a.addEventListener("click", () => {
    const menu = $("#navMenu");
    if (menu.classList.contains("show")) bootstrap.Collapse.getOrCreateInstance(menu).hide();
  }));

  $("#bookingForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    refreshMin();
    const d = new Date(date.value);
    date.setCustomValidity(date.value && !isNaN(d) && d >= nowMinute() ? "" : "invalid");
    $("#bName").setCustomValidity($("#bName").value.trim() ? "" : "invalid");
    $("#bAreaOther").setCustomValidity($("#bAreaOther").required && !$("#bAreaOther").value.trim() ? "invalid" : "");
    form.classList.add("was-validated");
    if (!form.checkValidity()) {
      form.querySelector(":invalid")?.focus();
      return;
    }
    const msg = buildMessage();
    const wa = digitsOnly(state.settings.whatsapp) || DEFAULT_WHATSAPP;
    const url = `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`;
    // (window.open with "noopener" always returns null, so clear opener manually)
    const win = window.open(url, "_blank");
    resetBookingForm(form);
    if (win) win.opener = null;
    else window.location.href = url;
  });

  // Hide the "sent" note as soon as someone starts a new booking
  $("#bookingForm").addEventListener("input", () => { const n = $("#bookingSent"); if (n) n.hidden = true; });

  // Coming back to the page with the browser's Back button: start with an empty form
  window.addEventListener("pageshow", (e) => { if (e.persisted) resetBookingForm($("#bookingForm"), false); });
}

// Clear every field after the booking has been handed to WhatsApp
function resetBookingForm(form, showThanks = true) {
  form.reset();
  form.classList.remove("was-validated");
  for (const el of form.elements) if (el.setCustomValidity) el.setCustomValidity("");
  $("#bAreaOtherWrap").classList.add("d-none");
  $("#bAreaOther").required = false;
  const size = $("#bSize");
  size.innerHTML = ""; size.dataset.keys = "";   // rebuilt empty by updateBookingUI
  updateBookingUI();
  let note = $("#bookingSent");
  if (!note) {
    note = document.createElement("div");
    note.id = "bookingSent";
    note.className = "alert alert-success small mt-3 mb-0";
    note.setAttribute("role", "status");
    form.append(note);
  }
  note.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i> Your booking message is ready in WhatsApp. Tap <strong>Send</strong> there and we will confirm your time.`;
  note.hidden = !showThanks;
  clearTimeout(resetBookingForm.timer);
  if (showThanks) resetBookingForm.timer = setTimeout(() => { note.hidden = true; }, 12000);
}

function buildMessage() {
  const s = selectedService();
  const area = $("#bArea").value === "__other" ? $("#bAreaOther").value.trim() : $("#bArea").value;
  const sizeKey = $("#bSize").value;
  const when = new Date($("#bDate").value).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
  const lines = [
    `Hello ${BUSINESS_NAME}! I would like to book:`,
    "",
    `*Name:* ${$("#bName").value.trim()}`,
    `*Area:* ${area}`,
    `*Service:* ${s.name} (${s.category === "car" ? "Car" : "Home"})`
  ];
  if (s.category === "car") lines.push(`*Vehicle size:* ${VEHICLE_SIZES.find((v) => v.key === sizeKey).label}`);
  const price = priceText(s, sizeKey);
  if (price) lines.push(`*Price on website:* ${price}`);
  lines.push(`*Preferred date/time:* ${when}`);
  const notes = $("#bNotes").value.trim();
  if (notes) lines.push(`*Notes:* ${notes}`);
  lines.push("", "Thank you!");
  return lines.join("\n");
}

// ---------------------------------------------------------------- start
async function loadFromFirestore() {
  if (!canUseFirebase) throw new Error("Firebase is not configured yet (js/firebase-config.js).");
  const [appMod, fs] = await withTimeout(Promise.all([
    import(`${FIREBASE_SDK}/firebase-app.js`),
    import(`${FIREBASE_SDK}/firebase-firestore.js`)
  ]), 10000);
  const app = appMod.initializeApp(getActiveConfig());
  state.fs = fs;
  state.db = fs.getFirestore(app);
  if (USE_EMULATORS) fs.connectFirestoreEmulator(state.db, "127.0.0.1", 8085);

  const [svcSnap, setSnap] = await withTimeout(Promise.all([
    fs.getDocs(fs.query(fs.collection(state.db, "services"), fs.orderBy("order"))),
    fs.getDoc(fs.doc(state.db, "settings", "business"))
  ]), 10000);

  const services = svcSnap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, ...data, name: capitalise(data.name) };
  });
  state.services = services.length ? services : DEFAULT_SERVICES;
  if (setSnap.exists()) state.settings = { ...state.settings, ...setSnap.data() };
}

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  const nav = $("#siteNav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 10);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  bindBookingForm();
  renderSettings();

  try {
    await loadFromFirestore();
    renderSettings();
    renderServices();
    loadBrandImages().catch(() => {});
    loadServiceImages().catch(() => {});
    loadReviews();
  } catch (err) {
    console.warn("Live data unavailable, showing default content:", err.message);
    state.services = DEFAULT_SERVICES;
    state.fs = null;
    renderServices();
    showNotice(`<i class="bi bi-info-circle me-1"></i> We couldn't load our latest prices right now.
      Please <a data-wa-link href="https://wa.me/${digitsOnly(state.settings.whatsapp) || DEFAULT_WHATSAPP}" target="_blank" rel="noopener">message us on WhatsApp</a>
      or <a data-tel-link href="tel:+${digitsOnly(state.settings.phone)}">call us</a> for our prices.`);
  }
  lazyGallery();
}

init();
