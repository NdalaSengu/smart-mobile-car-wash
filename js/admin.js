// Admin dashboard for Smart-Mobile Car Wash.
import { canUseFirebase, getActiveConfig, USE_EMULATORS, FIREBASE_SDK } from "./firebase-config.js";
import { compressImage, formatBytes } from "./image-utils.js";
import {
  DEFAULT_SERVICES, DEFAULT_AREAS, DEFAULT_FAQ, DEFAULT_HOURS, DEFAULT_PHONE, DEFAULT_WHATSAPP,
  VEHICLE_SIZES, esc, isSafeImage
} from "./defaults.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let fb = {};   // Firebase functions (auth + firestore)
let auth, db;
let tmpCounter = 0;

const state = {
  services: [],          // [{id|null, _key, ...}]
  images: new Map(),     // id -> image data
  gallery: [],           // [{id, ...}] sorted by order
  galleryQueue: [],      // pending uploads
  reviews: [],           // [{id|null, _key, ...}]
  settings: null
};

// ================================================================ UI helpers
function show(viewId) {
  for (const id of ["loadingView", "setupView", "loginView", "notAdminView", "dashboard"]) {
    $("#" + id).classList.toggle("d-none", id !== viewId);
  }
}

function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast align-items-center border-0 text-bg-${type === "error" ? "danger" : "success"}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<div class="d-flex"><div class="toast-body">
      <i class="bi ${type === "error" ? "bi-exclamation-triangle-fill" : "bi-check-circle-fill"} me-1"></i>${esc(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  $("#toasts").append(el);
  el.addEventListener("hidden.bs.toast", () => el.remove());
  new bootstrap.Toast(el, { delay: type === "error" ? 7000 : 3500 }).show();
}

function confirmBox(text, okLabel = "Yes, delete") {
  return new Promise((resolve) => {
    const modalEl = $("#confirmModal");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    $("#confirmText").textContent = text;
    $("#confirmOk").textContent = okLabel;
    let ok = false;
    const onOk = () => { ok = true; modal.hide(); };
    $("#confirmOk").addEventListener("click", onOk);
    modalEl.addEventListener("hidden.bs.modal", () => {
      $("#confirmOk").removeEventListener("click", onOk);
      resolve(ok);
    }, { once: true });
    modal.show();
  });
}

async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status"></span> Working…`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = html; }
}

function friendlyError(err) {
  const code = err?.code || "";
  if (code === "permission-denied") return "Permission denied. Check that firestore.rules are deployed and that config/admin has your UID.";
  if (code === "unavailable") return "No connection to the database. Check your internet and try again.";
  if (code.startsWith("auth/")) {
    return ({
      "auth/invalid-credential": "Wrong email or password.",
      "auth/wrong-password": "Wrong email or password.",
      "auth/user-not-found": "Wrong email or password.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
      "auth/network-request-failed": "Network error. Check your internet connection."
    })[code] || err.message;
  }
  return err?.message || String(err);
}

async function run(fn, successMsg) {
  try {
    await fn();
    if (successMsg) toast(successMsg);
    return true;
  } catch (err) {
    console.error(err);
    toast(friendlyError(err), "error");
    return false;
  }
}

function markInvalid(input, message) {
  input.classList.add("is-invalid");
  let feedback = input.parentElement.querySelector(".invalid-feedback");
  if (!feedback) {
    feedback = document.createElement("div");
    feedback.className = "invalid-feedback";
    input.after(feedback);
  }
  if (message) feedback.textContent = message;
}

function clearInvalid(root) {
  $$(".is-invalid", root).forEach((el) => el.classList.remove("is-invalid"));
}

// ================================================================ Auth
async function start() {
  if (!canUseFirebase) { show("setupView"); return; }
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-auth.js`),
      import(`${FIREBASE_SDK}/firebase-firestore.js`)
    ]);
    fb = { ...authM, ...fsM };
    const app = appM.initializeApp(getActiveConfig());
    auth = authM.getAuth(app);
    db = fsM.getFirestore(app);
    if (USE_EMULATORS) {
      authM.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      fsM.connectFirestoreEmulator(db, "127.0.0.1", 8085);
    }
  } catch (err) {
    console.error(err);
    show("setupView");
    $("#setupView p").textContent = "Could not load Firebase. Check your internet connection and reload the page.";
    return;
  }

  bindStaticEvents();
  fb.onAuthStateChanged(auth, handleUser);
}

async function handleUser(user) {
  $("#logoutBtn").classList.toggle("d-none", !user);
  $("#userEmail").textContent = user ? user.email : "";
  $("#userAvatar").textContent = user?.email ? user.email[0].toUpperCase() : "A";
  if (!user) { show("loginView"); return; }

  show("loadingView");
  let isAdmin = false;
  try {
    const snap = await fb.getDoc(fb.doc(db, "config", "admin"));
    isAdmin = snap.exists() && snap.data().uid === user.uid;
  } catch (err) {
    if (err.code !== "permission-denied") console.error(err);
  }
  if (!isAdmin) {
    $("#myUid").value = user.uid;
    show("notAdminView");
    return;
  }
  show("dashboard");
  const hour = new Date().getHours();
  $("#greeting").textContent = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("#todayText").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  goTo(location.hash.slice(1) || "overview");
  await loadAll();
}

function bindStaticEvents() {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    const errBox = $("#loginError");
    errBox.classList.add("d-none");
    if (!email || !password) {
      errBox.textContent = "Please enter your email and password.";
      errBox.classList.remove("d-none");
      return;
    }
    await busy($("#loginBtn"), async () => {
      try {
        await fb.signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        errBox.textContent = friendlyError(err);
        errBox.classList.remove("d-none");
      }
    });
  });

  $("#forgotBtn").addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim();
    const errBox = $("#loginError");
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      errBox.textContent = "Type your email address above first, then tap “Forgot password?”.";
      errBox.classList.remove("d-none");
      $("#loginEmail").focus();
      return;
    }
    errBox.classList.add("d-none");
    await run(() => fb.sendPasswordResetEmail(auth, email),
      "If this email belongs to the admin account, a password reset link has been sent. Check your inbox (and spam).");
  });

  $("#logoutBtn").addEventListener("click", () => fb.signOut(auth));
  $("#logoutBtn2").addEventListener("click", () => fb.signOut(auth));
  $("#pwToggle").addEventListener("click", () => {
    const pw = $("#loginPassword");
    const showing = pw.type === "text";
    pw.type = showing ? "password" : "text";
    $("#pwToggle").innerHTML = `<i class="bi ${showing ? "bi-eye" : "bi-eye-slash"}"></i>`;
    $("#pwToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });

  // Drag & drop onto any upload zone
  document.addEventListener("dragover", (e) => {
    const zone = e.target.closest?.(".dropzone");
    if (!zone) return;
    e.preventDefault();
    zone.classList.add("dragover");
  });
  document.addEventListener("dragleave", (e) => {
    e.target.closest?.(".dropzone")?.classList.remove("dragover");
  });
  document.addEventListener("drop", (e) => {
    const zone = e.target.closest?.(".dropzone");
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove("dragover");
    const input = $("input[type=file]", zone);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) { toast("Please drop an image file (JPG, PNG or WebP).", "error"); return; }
    const dt = new DataTransfer();
    (input.multiple ? files : files.slice(0, 1)).forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  $("#copyUid").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#myUid").value); toast("UID copied."); }
    catch { $("#myUid").select(); }
  });

  $("#seedBtn").addEventListener("click", (e) => seedDefaults(e.currentTarget));

  // Services
  $$("[data-add-service]").forEach((b) => b.addEventListener("click", () => addService(b.dataset.addService)));
  $("#serviceList").addEventListener("click", onServiceListClick);
  $("#serviceList").addEventListener("change", onServiceToggle);
  $("#svcDrawer").addEventListener("click", onDrawerClick);
  $$("[data-filter]").forEach((chip) => chip.addEventListener("click", () => {
    serviceFilter = chip.dataset.filter;
    $$("[data-filter]").forEach((c) => c.classList.toggle("active", c === chip));
    renderServices();
  }));

  // Navigation
  $$(".sidebar-nav [data-section]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); goTo(a.dataset.section); }));
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) goTo(g.dataset.goto);
  });
  window.addEventListener("hashchange", () => goTo(location.hash.slice(1)));

  $("#svcDrawer").addEventListener("change", (e) => {
    if (e.target.name === "svcCategory") {
      const card = e.target.closest("[data-key]");
      const isCar = e.target.value === "car";
      $(".car-prices", card).classList.toggle("d-none", !isCar);
      $(".home-prices", card).classList.toggle("d-none", isCar);
    }
  });

  // Image slots (hero / logo / service photos)
  document.addEventListener("change", onSlotFileChange);
  document.addEventListener("click", onSlotClick);

  // Gallery
  $("#galleryFiles").addEventListener("change", onGalleryFiles);
  $("#galleryUploadBtn").addEventListener("click", (e) => uploadGalleryQueue(e.currentTarget));
  $("#galleryQueue").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-queue-remove]");
    if (!btn) return;
    syncQueueInputs();
    state.galleryQueue = state.galleryQueue.filter((q) => q.key !== btn.dataset.queueRemove);
    renderGalleryQueue();
  });
  $("#galleryList").addEventListener("click", onGalleryListClick);

  // Business
  $("#addAreaBtn").addEventListener("click", addArea);
  $("#newArea").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addArea(); } });
  $("#areaEditor").addEventListener("click", onAreaClick);
  $("#addFaqBtn").addEventListener("click", () => {
    syncBusinessInputs();
    state.settings.faq.push({ q: "", a: "" });
    renderFaqEditor();
    $$("#faqEditor [name=faqQ]").at(-1)?.focus();
  });
  $("#faqEditor").addEventListener("click", onFaqClick);

  // Reviews
  $("#addReviewBtn").addEventListener("click", addReview);
  $("#reviewList").addEventListener("click", (e) => {
    if (e.target.closest("[data-add-review]")) { addReview(); return; }
    const btn = e.target.closest("[data-action=edit]");
    if (!btn) return;
    const r = state.reviews.find((x) => x._key === btn.closest("[data-key]").dataset.key);
    if (r) openReviewEditor(r);
  });
  $("#reviewList").addEventListener("change", onReviewToggle);
  $("#revDrawer").addEventListener("click", onReviewDrawerClick);
  $("#businessForm").addEventListener("submit", saveBusiness);
}

// ================================================================ Load data
async function loadAll() {
  try {
    const [svcSnap, imgSnap, setSnap] = await Promise.all([
      fb.getDocs(fb.query(fb.collection(db, "services"), fb.orderBy("order"))),
      fb.getDocs(fb.collection(db, "images")),
      fb.getDoc(fb.doc(db, "settings", "business"))
    ]);
    state.services = svcSnap.docs.map((d) => ({ id: d.id, _key: d.id, ...d.data() }));
    state.images = new Map(imgSnap.docs.map((d) => [d.id, d.data()]));
    state.gallery = imgSnap.docs.filter((d) => d.data().type === "gallery")
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const s = setSnap.exists() ? setSnap.data() : {};
    state.settings = {
      phone: s.phone ?? DEFAULT_PHONE,
      whatsapp: s.whatsapp ?? DEFAULT_WHATSAPP,
      hours: s.hours ?? DEFAULT_HOURS,
      areas: Array.isArray(s.areas) ? [...s.areas] : [...DEFAULT_AREAS],
      faq: Array.isArray(s.faq) ? s.faq.map((f) => ({ ...f })) : DEFAULT_FAQ.map((f) => ({ ...f }))
    };
    $("#seedCard").classList.toggle("d-none", state.services.length > 0 && setSnap.exists());
    renderPhotos();
    renderBusiness();
    renderServices();
    await loadReviews();
  } catch (err) {
    console.error(err);
    toast("Could not load data: " + friendlyError(err), "error");
  }
}

// ================================================================ Seed
async function seedDefaults(btn) {
  const hasData = state.services.length > 0;
  const ok = await confirmBox(
    hasData
      ? "This will reset the 6 default services and the business info (areas, hours, FAQ) to the default text. Services you added yourself and all photos stay. Continue?"
      : "Load the default services, service areas, working hours and FAQ?",
    "Yes, load defaults");
  if (!ok) return;
  await busy(btn, () => run(async () => {
    const batch = fb.writeBatch(db);
    for (const { id, ...svc } of DEFAULT_SERVICES) {
      const existing = state.services.find((s) => s.id === id);
      batch.set(fb.doc(db, "services", id), { ...svc, imageId: existing?.imageId || "", updatedAt: fb.serverTimestamp() });
    }
    batch.set(fb.doc(db, "settings", "business"), {
      phone: DEFAULT_PHONE, whatsapp: DEFAULT_WHATSAPP, hours: DEFAULT_HOURS,
      areas: DEFAULT_AREAS, faq: DEFAULT_FAQ, updatedAt: fb.serverTimestamp()
    });
    await batch.commit();
    await loadAll();
  }, "Default data loaded. Now set your prices!"));
}

// ================================================================ Services
function sortedServices() {
  return [...state.services].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function priceValue(v) {
  return typeof v === "number" ? String(v) : "";
}

function priceSummary(s) {
  if (s.category === "car") {
    const vals = VEHICLE_SIZES.map(({ key }) => s.prices?.[key]).filter((v) => typeof v === "number" && v > 0);
    if (!vals.length) return `<span class="text-muted fst-italic">No prices yet</span>`;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = min === max ? kw(min) : `${kw(min)} – ${kw(max)}`;
    return `<strong>${range}</strong><small class="d-block text-muted">${vals.length} of 4 sizes priced</small>`;
  }
  return typeof s.price === "number" && s.price > 0
    ? `<strong>${kw(s.price)}</strong><small class="d-block text-muted">${esc(s.unit || "")}</small>`
    : `<span class="text-muted fst-italic">No price yet</span>`;
}

function kw(n) { return "K" + Number(n).toLocaleString("en-US"); }

function serviceRowHtml(s) {
  const k = esc(s._key);
  const img = s.imageId ? state.images.get(s.imageId)?.dataUrl : null;
  const thumb = isSafeImage(img)
    ? `<img class="svc-thumb" src="${img}" alt="">`
    : `<span class="svc-thumb svc-thumb-empty"><i class="bi ${s.category === "car" ? "bi-car-front" : "bi-house"}"></i></span>`;
  return `
  <div class="svc-row ${s.active === false ? "is-off" : ""}" data-key="${k}" data-cat="${esc(s.category)}">
    <div class="svc-cell-main">
      ${thumb}
      <div class="min-w-0">
        <button type="button" class="svc-name" data-action="edit">${esc(s.name || "Untitled")}</button>
        <span class="cat-badge cat-${esc(s.category)}">${s.category === "car" ? "Car" : "Home"}</span>
        <span class="text-muted small ms-1">#${esc(s.order ?? 0)}</span>
      </div>
    </div>
    <div class="svc-cell-price">${priceSummary(s)}</div>
    <div class="svc-cell-status">
      <div class="form-check form-switch m-0">
        <input class="form-check-input" type="checkbox" role="switch" data-action="toggle" id="tg-${k}" ${s.active !== false ? "checked" : ""}>
        <label class="form-check-label small" for="tg-${k}">${s.active !== false ? "Visible" : "Hidden"}</label>
      </div>
    </div>
    <div class="svc-cell-actions">
      <button type="button" class="btn btn-sm btn-light btn-pill px-3" data-action="edit"><i class="bi bi-pencil"></i> Edit</button>
    </div>
  </div>`;
}

let serviceFilter = "all";

function renderServices() {
  const list = sortedServices();
  const shown = list.filter((s) => serviceFilter === "all" || s.category === serviceFilter);
  $("#serviceList").innerHTML = shown.length
    ? shown.map(serviceRowHtml).join("")
    : `<div class="empty-state"><i class="bi bi-tags"></i><p class="mb-2">${list.length ? "No services in this category." : "No services yet."}</p>
        ${list.length ? "" : `<button class="btn btn-primary btn-sm btn-pill px-3" type="button" data-goto="overview">Load default data</button>`}</div>`;
  $("#cntAll").textContent = list.length;
  $("#cntCar").textContent = list.filter((s) => s.category === "car").length;
  $("#cntHome").textContent = list.filter((s) => s.category === "home").length;
  $("#navCountServices").textContent = list.length || "";
  renderOverview();
}

function serviceFormHtml(s) {
  const k = esc(s._key);
  const isCar = s.category === "car";
  return `
  <div class="drawer-form" data-key="${k}">
    <form novalidate>
      <div class="drawer-section">
        <div class="form-check form-switch toggle-card">
          <input class="form-check-input" type="checkbox" role="switch" id="act-${k}" name="svcActive" ${s.active !== false ? "checked" : ""}>
          <label class="form-check-label" for="act-${k}"><strong>Show on website</strong><small class="d-block text-muted">Turn off to hide this service without deleting it.</small></label>
        </div>
      </div>
      <div class="drawer-section">
        <p class="drawer-title">Prices <span class="text-muted fw-normal">(leave empty to hide that size)</span></p>
        <div class="car-prices ${isCar ? "" : "d-none"}">
          <div class="price-grid">
            ${VEHICLE_SIZES.map(({ key, label }) => `
              <div>
                <label class="form-label small" for="p-${key}-${k}">${esc(label)}</label>
                <div class="input-group"><span class="input-group-text">K</span>
                  <input class="form-control" id="p-${key}-${k}" name="svcPrice_${key}" type="number" min="0" step="any" inputmode="decimal" placeholder="Not offered" value="${priceValue(s.prices?.[key])}">
                  <div class="invalid-feedback">Positive number or empty.</div>
                </div>
              </div>`).join("")}
          </div>
        </div>
        <div class="home-prices ${isCar ? "d-none" : ""}">
          <div class="price-grid">
            <div>
              <label class="form-label small" for="hp-${k}">Price</label>
              <div class="input-group"><span class="input-group-text">K</span>
                <input class="form-control" id="hp-${k}" name="svcPrice" type="number" min="0" step="any" inputmode="decimal" placeholder="No price" value="${priceValue(s.price)}">
                <div class="invalid-feedback">Positive number or empty.</div>
              </div>
            </div>
            <div>
              <label class="form-label small" for="un-${k}">Unit</label>
              <input class="form-control" id="un-${k}" name="svcUnit" maxlength="40" placeholder="e.g. per seat" value="${esc(s.unit || "")}">
            </div>
          </div>
        </div>
      </div>
      <div class="drawer-section">
        <p class="drawer-title">Details</p>
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label" for="nm-${k}">Name *</label>
            <input class="form-control" id="nm-${k}" name="svcName" maxlength="100" value="${esc(s.name || "")}" placeholder="e.g. Exterior wash">
            <div class="invalid-feedback">Please enter a name.</div>
          </div>
          <div class="col-7">
            <label class="form-label" for="cat-${k}">Category</label>
            <select class="form-select" id="cat-${k}" name="svcCategory">
              <option value="car" ${isCar ? "selected" : ""}>Car</option>
              <option value="home" ${!isCar ? "selected" : ""}>Home</option>
            </select>
          </div>
          <div class="col-5">
            <label class="form-label" for="ord-${k}">Order</label>
            <input class="form-control" id="ord-${k}" name="svcOrder" type="number" step="1" value="${esc(s.order ?? 0)}">
            <div class="invalid-feedback">Whole number.</div>
          </div>
          <div class="col-12">
            <label class="form-label" for="ds-${k}">Short description</label>
            <textarea class="form-control" id="ds-${k}" name="svcDesc" rows="2" maxlength="500">${esc(s.description || "")}</textarea>
          </div>
          <div class="col-12">
            <label class="form-label" for="bl-${k}">Bullet points <span class="text-muted fw-normal">(one per line)</span></label>
            <textarea class="form-control" id="bl-${k}" name="svcBullets" rows="4">${esc((s.bullets || []).join("\n"))}</textarea>
            <div class="invalid-feedback">Maximum 20 bullet points, 150 characters each.</div>
          </div>
        </div>
      </div>
    </form>
    <div class="drawer-footer">
      <button type="button" class="btn btn-outline-danger btn-pill px-3" data-action="delete"><i class="bi bi-trash"></i> ${s.id ? "Delete" : "Discard"}</button>
      <button type="button" class="btn btn-primary btn-pill px-4" data-action="save"><i class="bi bi-check2"></i> Save changes</button>
    </div>
  </div>`;
}

let drawerService = null;

function openServiceEditor(s) {
  drawerService = s;
  $("#svcDrawerTitle").textContent = s.name || (s.category === "car" ? "New car service" : "New home service");
  $("#svcDrawerSub").textContent = s.id ? "Edit service" : "Add service";
  $("#svcDrawerBody").innerHTML = serviceFormHtml(s);
  bootstrap.Offcanvas.getOrCreateInstance("#svcDrawer").show();
  if (!s.id) setTimeout(() => $("#svcDrawerBody [name=svcName]")?.focus(), 350);
}

function closeServiceEditor() {
  bootstrap.Offcanvas.getOrCreateInstance("#svcDrawer").hide();
}

function addService(category) {
  const maxOrder = Math.max(0, ...state.services.map((s) => Number(s.order) || 0));
  const s = {
    id: null, _key: `new-${++tmpCounter}`, name: "", category, description: "", bullets: [],
    active: true, order: maxOrder + 1, imageId: "",
    ...(category === "car" ? { prices: { small: null, suv: null, van: null, truck: null } } : { price: null, unit: "" })
  };
  goTo("services");
  openServiceEditor(s);
}

function parsePrice(input) {
  const raw = input.value.trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!isFinite(n) || n <= 0 || n > 1000000) {
    markInvalid(input);
    throw new Error("validation");
  }
  return Math.round(n * 100) / 100;
}

function readServiceForm(card) {
  const f = $("form", card);
  const el = (name) => f.elements[name];
  clearInvalid(f);
  let ok = true;

  const name = el("svcName").value.trim();
  if (!name) { markInvalid(el("svcName")); ok = false; }
  const order = Number(el("svcOrder").value);
  if (!Number.isInteger(order)) { markInvalid(el("svcOrder")); ok = false; }
  const bullets = el("svcBullets").value.split("\n").map((b) => b.trim()).filter(Boolean);
  if (bullets.length > 20 || bullets.some((b) => b.length > 150)) { markInvalid(el("svcBullets")); ok = false; }
  const category = el("svcCategory").value;

  const data = {
    name, category, order, bullets,
    description: el("svcDesc").value.trim(),
    active: el("svcActive").checked
  };
  try {
    if (category === "car") {
      data.prices = {};
      for (const { key } of VEHICLE_SIZES) {
        try { data.prices[key] = parsePrice(el(`svcPrice_${key}`)); } catch { ok = false; }
      }
    } else {
      data.price = parsePrice(el("svcPrice"));
      data.unit = el("svcUnit").value.trim();
    }
  } catch { ok = false; }

  if (!ok) {
    $(".is-invalid", f)?.focus();
    throw new Error("Please fix the highlighted fields. Prices must be positive numbers (or empty).");
  }
  return data;
}

async function onServiceListClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const row = btn.closest("[data-key]");
  const s = state.services.find((x) => x._key === row.dataset.key);
  if (!s) return;
  if (btn.dataset.action === "edit") openServiceEditor(s);
}

async function onServiceToggle(e) {
  const input = e.target.closest("[data-action=toggle]");
  if (!input) return;
  const s = state.services.find((x) => x._key === input.closest("[data-key]").dataset.key);
  const active = input.checked;
  input.disabled = true;
  const ok = await run(async () => {
    await fb.updateDoc(fb.doc(db, "services", s.id), { active, updatedAt: fb.serverTimestamp() });
    s.active = active;
  }, `“${s.name}” is now ${active ? "visible" : "hidden"} on the website.`);
  if (!ok) input.checked = !active;
  renderServices();
}

async function onDrawerClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const card = btn.closest("[data-key]");
  const s = drawerService;
  if (!s || card.dataset.key !== s._key) return;

  if (btn.dataset.action === "save") {
    let data;
    try { data = readServiceForm(card); } catch (err) { toast(err.message, "error"); return; }
    await busy(btn, () => run(async () => {
      const id = s.id || fb.doc(fb.collection(db, "services")).id;
      const payload = { ...data, imageId: s.imageId || "", updatedAt: fb.serverTimestamp() };
      await fb.setDoc(fb.doc(db, "services", id), payload);
      // replace local copy (setDoc overwrites the whole document)
      for (const k of ["prices", "price", "unit"]) delete s[k];
      Object.assign(s, data, { id });
      if (!state.services.includes(s)) state.services.push(s);
      renderServices();
      renderServiceSlots();
      closeServiceEditor();
    }, `“${data.name}” saved.`));
  }

  if (btn.dataset.action === "delete") {
    if (!s.id) { closeServiceEditor(); return; }
    const name = s.name || "this service";
    if (!(await confirmBox(`Delete “${name}”? It will disappear from the website. This cannot be undone.`))) return;
    await busy(btn, () => run(async () => {
      await fb.deleteDoc(fb.doc(db, "services", s.id));
      if (s.imageId) {
        await fb.deleteDoc(fb.doc(db, "images", s.imageId)).catch(() => {});
        state.images.delete(s.imageId);
      }
      state.services = state.services.filter((x) => x !== s);
      renderServices();
      renderServiceSlots();
      closeServiceEditor();
    }, `“${name}” deleted.`));
  }
}

// ================================================================ Navigation & overview
const SECTIONS = {
  overview: "Overview",
  services: "Prices & services",
  photos: "Photos",
  reviews: "Reviews",
  business: "Business info"
};

function goTo(section) {
  if (!SECTIONS[section]) section = "overview";
  $$("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== section; });
  $$(".sidebar-nav [data-section]").forEach((a) => {
    a.classList.toggle("active", a.dataset.section === section);
    if (a.dataset.section === section) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  $("#pageTitle").textContent = SECTIONS[section];
  $("#crumbName").textContent = SECTIONS[section];
  if (location.hash !== "#" + section) history.replaceState(null, "", "#" + section);
  bootstrap.Offcanvas.getInstance("#sidebar")?.hide();
  window.scrollTo({ top: 0 });
}

function renderOverview() {
  if (!state.settings) return;
  const services = state.services.filter((s) => s.id);
  const active = services.filter((s) => s.active !== false);
  const priced = active.filter((s) => s.category === "car"
    ? VEHICLE_SIZES.some(({ key }) => typeof s.prices?.[key] === "number")
    : typeof s.price === "number");
  const withPhoto = services.filter((s) => s.imageId && state.images.has(s.imageId));
  const hasHero = state.images.has("hero");
  const hasLogo = state.images.has("logo");

  const stats = [
    { icon: "bi-tags", label: "Services on website", value: `${active.length}`, sub: `of ${services.length} total`, go: "services" },
    { icon: "bi-cash-coin", label: "Services with prices", value: `${priced.length}`, sub: `${active.length - priced.length} without a price`, go: "services" },
    { icon: "bi-images", label: "Gallery photos", value: `${state.gallery.length}`, sub: `${withPhoto.length} service photos`, go: "photos" },
    { icon: "bi-geo-alt", label: "Service areas", value: `${state.settings.areas.length}`, sub: `${state.settings.faq.length} FAQ items`, go: "business" }
  ];
  $("#statCards").innerHTML = stats.map((s) => `
    <div class="col-6 col-xl-3">
      <button type="button" class="stat-card" data-goto="${s.go}">
        <span class="stat-icon"><i class="bi ${s.icon}"></i></span>
        <span class="stat-value">${s.value}</span>
        <span class="stat-label">${s.label}</span>
        <span class="stat-sub">${s.sub}</span>
      </button>
    </div>`).join("");

  const items = [
    { done: services.length > 0, title: "Add your services", text: "Load the default services or add your own.", go: "overview" },
    { done: active.length > 0 && priced.length === active.length, title: "Set your prices", text: `${priced.length} of ${active.length} visible services have prices.`, go: "services" },
    { done: hasHero, title: "Upload a banner photo", text: "A wide photo for the top of the website.", go: "photos" },
    { done: hasLogo, title: "Upload your logo", text: "Shown in the menu and footer.", go: "photos" },
    { done: services.length > 0 && withPhoto.length >= services.length, title: "Add service photos", text: `${withPhoto.length} of ${services.length} services have a photo.`, go: "photos" },
    { done: state.reviews.filter((r) => r.active).length >= 3, title: "Add customer reviews", text: `${state.reviews.filter((r) => r.active).length} review${state.reviews.filter((r) => r.active).length === 1 ? "" : "s"} on the website – aim for at least 3.`, go: "reviews" },
    { done: state.gallery.length >= 3, title: "Add gallery photos", text: `${state.gallery.length} photo${state.gallery.length === 1 ? "" : "s"} so far – aim for at least 3.`, go: "photos" }
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  $("#setupPercent").textContent = `${pct}%`;
  $("#setupBar").style.width = `${pct}%`;
  $("#checklist").innerHTML = items.map((i) => `
    <li class="${i.done ? "done" : ""}">
      <span class="check"><i class="bi ${i.done ? "bi-check-lg" : "bi-circle"}"></i></span>
      <div class="flex-grow-1 min-w-0"><strong>${esc(i.title)}</strong><small>${esc(i.text)}</small></div>
      ${i.done ? `<span class="badge rounded-pill text-bg-success-subtle text-success-emphasis">Done</span>`
               : `<button type="button" class="btn btn-sm btn-light btn-pill" data-goto="${i.go}">Open <i class="bi bi-arrow-right"></i></button>`}
    </li>`).join("");

  $("#navCountPhotos").textContent = state.gallery.length || "";
}

// ================================================================ Image slots
const slots = new Map(); // key -> { opts, pending }

function slotHtml(key, opts) {
  const current = opts.getCurrent();
  const thumbClass = opts.logo ? "thumb logo-thumb" : "thumb";
  const has = isSafeImage(current);
  return `
  <div class="slot-card h-100" data-slot-card="${esc(key)}">
    <div class="slot-head">
      <h4 class="h6 mb-0">${esc(opts.title)}</h4>
      ${has ? '<span class="badge rounded-pill text-bg-success-subtle text-success-emphasis"><i class="bi bi-check-circle-fill"></i> Has photo</span>'
            : '<span class="badge rounded-pill text-bg-light text-muted border">No photo</span>'}
    </div>
    ${opts.hint ? `<p class="small text-muted mb-2">${esc(opts.hint)}</p>` : ""}
    <div class="slot-previews">
      <figure>
        <figcaption>Current</figcaption>
        ${has ? `<img class="${thumbClass}" src="${current}" alt="Current ${esc(opts.title)}">`
              : `<div class="${thumbClass} thumb-empty"><i class="bi bi-image"></i></div>`}
      </figure>
      <figure>
        <figcaption>New</figcaption>
        <div data-slot-preview><div class="${thumbClass} thumb-empty"><i class="bi bi-plus-lg"></i></div></div>
      </figure>
    </div>
    <p class="size-note text-center mb-2" data-slot-info></p>
    ${opts.disabledReason
      ? `<p class="small text-warning-emphasis text-center mb-0"><i class="bi bi-info-circle"></i> ${esc(opts.disabledReason)}</p>`
      : `<label class="dropzone">
           <input type="file" accept="image/*" class="visually-hidden" data-slot="${esc(key)}" aria-label="Choose photo for ${esc(opts.title)}">
           <i class="bi bi-cloud-arrow-up"></i>
           <span><strong>Choose a photo</strong> or drag it here</span>
         </label>
         <div class="slot-actions">
           <button type="button" class="btn btn-sm btn-primary btn-pill px-3" data-slot-save="${esc(key)}" disabled><i class="bi bi-cloud-upload"></i> Save photo</button>
           ${has ? `<button type="button" class="btn btn-sm btn-outline-danger btn-pill px-3" data-slot-remove="${esc(key)}"><i class="bi bi-trash"></i> Remove</button>` : ""}
         </div>`}
  </div>`;
}

function mountSlot(container, key, opts) {
  slots.set(key, { opts, pending: null });
  container.innerHTML = slotHtml(key, opts);
}

async function onSlotFileChange(e) {
  const input = e.target.closest("input[data-slot]");
  if (!input || !input.files[0]) return;
  const slot = slots.get(input.dataset.slot);
  const card = input.closest("[data-slot-card]");
  const info = $("[data-slot-info]", card);
  const saveBtn = $("[data-slot-save]", card);
  info.textContent = "Compressing…";
  saveBtn.disabled = true;
  try {
    const result = await compressImage(input.files[0], slot.opts.compress || {});
    slot.pending = result;
    $("[data-slot-preview]", card).innerHTML =
      `<img class="${slot.opts.logo ? "thumb logo-thumb" : "thumb"}" src="${result.dataUrl}" alt="New photo preview">`;
    info.textContent = `${formatBytes(result.originalBytes)} → ${formatBytes(result.bytes)} · ${result.width}×${result.height} · ${result.mime.split("/")[1].toUpperCase()}`;
    saveBtn.disabled = false;
  } catch (err) {
    slot.pending = null;
    info.textContent = "";
    toast(err.message, "error");
  }
}

async function onSlotClick(e) {
  const saveBtn = e.target.closest("[data-slot-save]");
  const removeBtn = e.target.closest("[data-slot-remove]");
  if (saveBtn) {
    const slot = slots.get(saveBtn.dataset.slotSave);
    if (!slot?.pending) return;
    await busy(saveBtn, () => run(async () => {
      await slot.opts.save(slot.pending);
      slot.pending = null;
      slot.opts.rerender();
      renderServices();
    }, `${slot.opts.title} saved.`));
  }
  if (removeBtn) {
    const slot = slots.get(removeBtn.dataset.slotRemove);
    if (!(await confirmBox(`Remove the ${slot.opts.title.toLowerCase()}?`))) return;
    await busy(removeBtn, () => run(async () => {
      await slot.opts.remove();
      slot.opts.rerender();
      renderServices();
    }, `${slot.opts.title} removed.`));
  }
}

function imageDoc(result, type, extra = {}) {
  return {
    dataUrl: result.dataUrl, type, caption: "", label: "", order: 0,
    createdAt: fb.serverTimestamp(), ...extra
  };
}

async function saveImage(id, data) {
  await fb.setDoc(fb.doc(db, "images", id), data);
  state.images.set(id, { ...data });
}

async function deleteImage(id) {
  await fb.deleteDoc(fb.doc(db, "images", id));
  state.images.delete(id);
}

function renderPhotos() {
  const fixedSlot = (containerSel, id, title, hint, extra = {}) => {
    const opts = {
      title, hint, ...extra,
      getCurrent: () => state.images.get(id)?.dataUrl,
      save: (r) => saveImage(id, imageDoc(r, id)),
      remove: () => deleteImage(id),
      rerender: () => mountSlot($(containerSel), id, opts)
    };
    opts.rerender();
  };
  fixedSlot("#heroSlot", "hero", "Hero banner photo", "Wide photo shown behind the big title at the top of the website.");
  fixedSlot("#logoSlot", "logo", "Logo", "Square logo, transparent background works best.",
    { logo: true, compress: { maxSize: 400, targetBytes: 100 * 1024, keepTransparency: true } });
  renderServiceSlots();
  renderGalleryList();
  renderGalleryQueue();
}

function renderServiceSlots() {
  const wrap = $("#serviceSlots");
  const list = sortedServices();
  if (!list.length) { wrap.innerHTML = `<div class="col-12 text-muted small">Add services first.</div>`; return; }
  wrap.innerHTML = list.map((s) => `<div class="col-sm-6 col-lg-4" data-svc-slot="${esc(s._key)}"></div>`).join("");
  for (const s of list) {
    const key = `svc:${s._key}`;
    const container = $(`[data-svc-slot="${CSS.escape(s._key)}"]`, wrap);
    const opts = {
      title: s.name || "New service",
      disabledReason: s.id ? "" : "Save this service first (Prices & services tab).",
      getCurrent: () => (s.imageId ? state.images.get(s.imageId)?.dataUrl : null),
      save: async (r) => {
        const imageId = `svc_${s.id}`;
        await saveImage(imageId, imageDoc(r, "service"));
        if (s.imageId !== imageId) {
          await fb.updateDoc(fb.doc(db, "services", s.id), { imageId, updatedAt: fb.serverTimestamp() });
          s.imageId = imageId;
        }
      },
      remove: async () => {
        const old = s.imageId;
        await fb.updateDoc(fb.doc(db, "services", s.id), { imageId: "", updatedAt: fb.serverTimestamp() });
        s.imageId = "";
        if (old) await deleteImage(old);
      },
      rerender: () => mountSlot(container, key, opts)
    };
    opts.rerender();
  }
}

// ================================================================ Gallery
function labelSelect(name, value) {
  return `<select class="form-select form-select-sm" name="${name}" aria-label="Before/after label">
    <option value="" ${!value ? "selected" : ""}>No label</option>
    <option value="before" ${value === "before" ? "selected" : ""}>Before</option>
    <option value="after" ${value === "after" ? "selected" : ""}>After</option>
  </select>`;
}

async function onGalleryFiles(e) {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  syncQueueInputs();
  $("#galleryUploadBtn").classList.add("d-none");
  const status = document.createElement("p");
  status.className = "small text-muted";
  $("#galleryQueue").prepend(status);
  for (const [i, file] of files.entries()) {
    status.textContent = `Compressing ${i + 1} of ${files.length}…`;
    try {
      const result = await compressImage(file);
      state.galleryQueue.push({ key: `q${++tmpCounter}`, result, caption: "", label: "", name: file.name });
    } catch (err) {
      toast(err.message, "error");
    }
  }
  renderGalleryQueue();
}

function renderGalleryQueue() {
  const q = state.galleryQueue;
  $("#galleryUploadBtn").classList.toggle("d-none", !q.length);
  $("#galleryUploadBtn").innerHTML = `<i class="bi bi-cloud-upload"></i> Upload ${q.length} photo${q.length === 1 ? "" : "s"}`;
  $("#galleryQueue").innerHTML = q.length ? `
    <p class="small fw-semibold text-center mb-2"><i class="bi bi-hourglass-split"></i> Ready to upload – add a caption and label, then tap Upload</p>
    <div class="row g-3 mb-3 justify-content-center">` + q.map((item) => `
      <div class="col-6 col-md-4 col-xl-3" data-queue="${item.key}">
        <div class="photo-card pending">
          <div class="photo-media">
            <img src="${item.result.dataUrl}" alt="Preview of ${esc(item.name)}">
            <button type="button" class="photo-remove" data-queue-remove="${item.key}" aria-label="Remove from upload list"><i class="bi bi-x-lg"></i></button>
          </div>
          <div class="photo-body">
            <input class="form-control form-control-sm mb-2" name="qCaption" maxlength="200" placeholder="Caption (optional)" value="${esc(item.caption)}" aria-label="Caption">
            ${labelSelect("qLabel", item.label)}
            <p class="size-note mb-0 mt-2">${formatBytes(item.result.originalBytes)} → <strong>${formatBytes(item.result.bytes)}</strong></p>
          </div>
        </div>
      </div>`).join("") + `</div>` : "";
}

function syncQueueInputs() {
  for (const item of state.galleryQueue) {
    const row = $(`[data-queue="${item.key}"]`);
    if (!row) continue;
    item.caption = $("[name=qCaption]", row).value.trim();
    item.label = $("[name=qLabel]", row).value;
  }
}

async function uploadGalleryQueue(btn) {
  syncQueueInputs();
  const queue = [...state.galleryQueue];
  if (!queue.length) return;
  await busy(btn, async () => {
    let order = Math.max(0, ...state.gallery.map((g) => Number(g.order) || 0));
    let done = 0;
    for (const item of queue) {
      const ok = await run(async () => {
        const data = imageDoc(item.result, "gallery", { caption: item.caption, label: item.label, order: ++order });
        const ref = await fb.addDoc(fb.collection(db, "images"), data);
        state.gallery.push({ id: ref.id, ...data });
        state.images.set(ref.id, data);
        state.galleryQueue = state.galleryQueue.filter((q) => q !== item);
      });
      if (!ok) break;
      done++;
    }
    renderGalleryQueue();
    renderGalleryList();
    if (done) toast(`${done} photo${done > 1 ? "s" : ""} added to the gallery.`);
  });
}

function renderGalleryList() {
  const g = state.gallery;
  renderOverview();
  $("#galleryList").innerHTML = g.length ? `
    <p class="small fw-semibold text-center mb-2">On the website (${g.length})</p>
    <div class="row g-3 justify-content-center">` + g.map((item, i) => `
      <div class="col-6 col-md-4 col-xl-3" data-gallery="${esc(item.id)}">
        <div class="photo-card">
          <div class="photo-media">
            <img src="${isSafeImage(item.dataUrl) ? item.dataUrl : ""}" alt="${esc(item.caption || "Gallery photo")}" loading="lazy">
            <span class="photo-pos">#${i + 1}</span>
            ${item.label ? `<span class="photo-label ${esc(item.label)}">${esc(item.label)}</span>` : ""}
          </div>
          <div class="photo-body">
            <input class="form-control form-control-sm mb-2" name="gCaption" maxlength="200" placeholder="Caption" value="${esc(item.caption || "")}" aria-label="Caption">
            ${labelSelect("gLabel", item.label)}
            <div class="photo-actions">
              <div class="btn-group btn-group-sm" role="group" aria-label="Reorder">
                <button type="button" class="btn btn-outline-secondary" data-g="up" ${i === 0 ? "disabled" : ""} aria-label="Move earlier"><i class="bi bi-arrow-left"></i></button>
                <button type="button" class="btn btn-outline-secondary" data-g="down" ${i === g.length - 1 ? "disabled" : ""} aria-label="Move later"><i class="bi bi-arrow-right"></i></button>
              </div>
              <button type="button" class="btn btn-sm btn-primary" data-g="save" aria-label="Save caption and label"><i class="bi bi-check2"></i></button>
              <button type="button" class="btn btn-sm btn-outline-danger" data-g="delete" aria-label="Delete photo"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
      </div>`).join("") + `</div>` : `<div class="empty-state"><i class="bi bi-images"></i><p class="mb-0">No gallery photos yet. Add some above.</p></div>`;
}

async function onGalleryListClick(e) {
  const btn = e.target.closest("[data-g]");
  if (!btn) return;
  const row = btn.closest("[data-gallery]");
  const idx = state.gallery.findIndex((g) => g.id === row.dataset.gallery);
  const item = state.gallery[idx];
  const action = btn.dataset.g;

  if (action === "save") {
    const caption = $("[name=gCaption]", row).value.trim();
    const label = $("[name=gLabel]", row).value;
    await busy(btn, () => run(async () => {
      await fb.updateDoc(fb.doc(db, "images", item.id), { caption, label });
      Object.assign(item, { caption, label });
      renderGalleryList();
    }, "Photo details saved."));
  }

  if (action === "delete") {
    if (!(await confirmBox("Delete this gallery photo? This cannot be undone."))) return;
    await busy(btn, () => run(async () => {
      await deleteImage(item.id);
      state.gallery.splice(idx, 1);
      renderGalleryList();
    }, "Photo deleted."));
  }

  if (action === "up" || action === "down") {
    const to = action === "up" ? idx - 1 : idx + 1;
    if (to < 0 || to >= state.gallery.length) return;
    const list = [...state.gallery];
    [list[idx], list[to]] = [list[to], list[idx]];
    await run(async () => {
      const batch = fb.writeBatch(db);
      list.forEach((g, i) => {
        if (g.order !== i + 1) batch.update(fb.doc(db, "images", g.id), { order: i + 1 });
      });
      await batch.commit();
      list.forEach((g, i) => { g.order = i + 1; });
      state.gallery = list;
      renderGalleryList();
    }, "Order saved.");
  }
}

// ================================================================ Reviews
async function loadReviews() {
  try {
    const snap = await fb.getDocs(fb.collection(db, "reviews"));
    state.reviews = snap.docs.map((d) => ({ id: d.id, _key: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    state.reviews = [];
    toast("Could not load reviews: " + friendlyError(err), "error");
  }
  renderReviews();
}

function sortedReviews() {
  return [...state.reviews].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function adminStars(n) {
  const r = Math.max(0, Math.min(5, Number(n) || 0));
  return `<span class="admin-stars" aria-label="${r} out of 5 stars">${"★".repeat(r)}<span>${"★".repeat(5 - r)}</span></span>`;
}

function reviewRowHtml(r) {
  const k = esc(r._key);
  const meta = [r.area, r.service].filter(Boolean).map(esc).join(" · ");
  const snippet = String(r.text || "").length > 110 ? String(r.text).slice(0, 110) + "…" : String(r.text || "");
  return `
  <div class="svc-row rev-row ${r.active ? "" : "is-off"}" data-key="${k}">
    <div class="svc-cell-main">
      <span class="svc-thumb svc-thumb-empty rev-initial">${esc(String(r.name || "?").charAt(0).toUpperCase())}</span>
      <div class="min-w-0">
        <button type="button" class="svc-name" data-action="edit">${esc(r.name || "Unnamed")}</button>
        ${meta ? `<small class="d-block text-muted">${meta}</small>` : ""}
        <small class="d-block text-muted fst-italic text-truncate">“${esc(snippet)}”</small>
      </div>
    </div>
    <div class="svc-cell-price">${adminStars(r.rating)}</div>
    <div class="svc-cell-status">
      <div class="form-check form-switch m-0">
        <input class="form-check-input" type="checkbox" role="switch" data-action="toggle" id="rtg-${k}" ${r.active ? "checked" : ""}>
        <label class="form-check-label small" for="rtg-${k}">${r.active ? "Visible" : "Hidden"}</label>
      </div>
    </div>
    <div class="svc-cell-actions">
      <button type="button" class="btn btn-sm btn-light btn-pill px-3" data-action="edit"><i class="bi bi-pencil"></i> Edit</button>
    </div>
  </div>`;
}

function renderReviews() {
  const list = sortedReviews();
  const visible = list.filter((r) => r.active);
  const avg = visible.length ? visible.reduce((s, r) => s + Number(r.rating || 0), 0) / visible.length : 0;
  $("#reviewStats").innerHTML = visible.length
    ? `<strong class="text-body">${avg.toFixed(1)}</strong> ${adminStars(Math.round(avg))} · ${visible.length} on website${list.length > visible.length ? `, ${list.length - visible.length} hidden` : ""}`
    : list.length ? `${list.length} review${list.length === 1 ? "" : "s"}, none switched on yet` : "No reviews yet";
  $("#reviewList").innerHTML = list.length
    ? list.map(reviewRowHtml).join("")
    : `<div class="empty-state"><i class="bi bi-chat-heart"></i><p class="mb-2">No reviews yet. Add your first one from a happy customer.</p>
        <button class="btn btn-primary btn-sm btn-pill px-3" type="button" data-add-review><i class="bi bi-plus-lg"></i> Add review</button></div>`;
  $("#navCountReviews").textContent = list.length || "";
  renderOverview();
}

let drawerReview = null;

function reviewFormHtml(r) {
  const k = esc(r._key);
  const areas = state.settings?.areas || [];
  const services = sortedServices().map((s) => s.name).filter(Boolean);
  if (r.service && !services.includes(r.service)) services.push(r.service);
  return `
  <div class="drawer-form" data-key="${k}">
    <form novalidate>
      <div class="drawer-section">
        <div class="form-check form-switch toggle-card">
          <input class="form-check-input" type="checkbox" role="switch" id="ract-${k}" name="revActive" ${r.active ? "checked" : ""}>
          <label class="form-check-label" for="ract-${k}"><strong>Show on website</strong><small class="d-block text-muted">Turn off to hide this review without deleting it.</small></label>
        </div>
      </div>
      <div class="drawer-section">
        <p class="drawer-title">Rating *</p>
        <div class="star-pick" role="radiogroup" aria-label="Rating">
          ${[1, 2, 3, 4, 5].map((n) => `
            <input type="radio" class="btn-check" name="revRating" id="rr${n}-${k}" value="${n}" ${Number(r.rating) === n ? "checked" : ""}>
            <label class="btn btn-outline-warning" for="rr${n}-${k}">${n} ★</label>`).join("")}
        </div>
        <div class="small text-danger mt-2" data-rating-error hidden>Please choose a rating.</div>
      </div>
      <div class="drawer-section">
        <p class="drawer-title">Review</p>
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label" for="rtx-${k}">What the customer said *</label>
            <textarea class="form-control" id="rtx-${k}" name="revText" rows="5" maxlength="600" placeholder="e.g. They came to my house on time and my car looks brand new. Very friendly team!">${esc(r.text || "")}</textarea>
            <div class="invalid-feedback">Please type the review (up to 600 characters).</div>
          </div>
          <div class="col-12">
            <label class="form-label" for="rnm-${k}">Customer name *</label>
            <input class="form-control" id="rnm-${k}" name="revName" maxlength="60" value="${esc(r.name || "")}" placeholder="e.g. Mary P.">
            <div class="form-text">First name + initial is enough. Ask the customer first.</div>
            <div class="invalid-feedback">Please enter a name.</div>
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="rar-${k}">Area</label>
            <input class="form-control" id="rar-${k}" name="revArea" maxlength="60" list="rarl-${k}" value="${esc(r.area || "")}" placeholder="e.g. Kandundu">
            <datalist id="rarl-${k}">${areas.map((a) => `<option value="${esc(a)}">`).join("")}</datalist>
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="rsv-${k}">Service</label>
            <select class="form-select" id="rsv-${k}" name="revService">
              <option value="">(not shown)</option>
              ${services.map((n) => `<option ${n === r.service ? "selected" : ""}>${esc(n)}</option>`).join("")}
            </select>
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="rod-${k}">Order</label>
            <input class="form-control" id="rod-${k}" name="revOrder" type="number" step="1" value="${esc(r.order ?? 0)}">
            <div class="invalid-feedback">Whole number.</div>
          </div>
        </div>
      </div>
    </form>
    <div class="drawer-footer">
      <button type="button" class="btn btn-outline-danger btn-pill px-3" data-action="delete"><i class="bi bi-trash"></i> ${r.id ? "Delete" : "Discard"}</button>
      <button type="button" class="btn btn-primary btn-pill px-4" data-action="save"><i class="bi bi-check2"></i> Save review</button>
    </div>
  </div>`;
}

function openReviewEditor(r) {
  drawerReview = r;
  $("#revDrawerTitle").textContent = r.name || "New review";
  $("#revDrawerSub").textContent = r.id ? "Edit review" : "Add review";
  $("#revDrawerBody").innerHTML = reviewFormHtml(r);
  bootstrap.Offcanvas.getOrCreateInstance("#revDrawer").show();
  if (!r.id) setTimeout(() => $("#revDrawerBody [name=revText]")?.focus(), 350);
}

function addReview() {
  const maxOrder = Math.max(0, ...state.reviews.map((r) => Number(r.order) || 0));
  goTo("reviews");
  openReviewEditor({ id: null, _key: `newr-${++tmpCounter}`, name: "", area: "", service: "", rating: 5, text: "", active: true, order: maxOrder + 1 });
}

function readReviewForm(card) {
  const f = $("form", card);
  const el = (name) => f.elements[name];
  clearInvalid(f);
  let ok = true;
  const text = el("revText").value.trim();
  if (!text || text.length > 600) { markInvalid(el("revText")); ok = false; }
  const name = el("revName").value.trim();
  if (!name) { markInvalid(el("revName")); ok = false; }
  const order = Number(el("revOrder").value);
  if (!Number.isInteger(order)) { markInvalid(el("revOrder")); ok = false; }
  const rating = Number(f.querySelector("[name=revRating]:checked")?.value);
  const ratingOk = Number.isInteger(rating) && rating >= 1 && rating <= 5;
  $("[data-rating-error]", f).hidden = ratingOk;
  if (!ratingOk) ok = false;
  if (!ok) {
    $(".is-invalid", f)?.focus();
    throw new Error("Please fix the highlighted fields.");
  }
  return {
    name, text, rating, order,
    area: el("revArea").value.trim(),
    service: el("revService").value,
    active: el("revActive").checked
  };
}

async function onReviewDrawerClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const card = btn.closest("[data-key]");
  const r = drawerReview;
  if (!r || card.dataset.key !== r._key) return;

  if (btn.dataset.action === "save") {
    let data;
    try { data = readReviewForm(card); } catch (err) { toast(err.message, "error"); return; }
    await busy(btn, () => run(async () => {
      const id = r.id || fb.doc(fb.collection(db, "reviews")).id;
      const payload = { ...data, updatedAt: fb.serverTimestamp() };
      if (!r.id) payload.createdAt = fb.serverTimestamp();
      await fb.setDoc(fb.doc(db, "reviews", id), payload, { merge: true });
      Object.assign(r, data, { id });
      if (!state.reviews.includes(r)) state.reviews.push(r);
      renderReviews();
      bootstrap.Offcanvas.getOrCreateInstance("#revDrawer").hide();
    }, `Review from ${data.name} saved.`));
  }

  if (btn.dataset.action === "delete") {
    if (!r.id) { bootstrap.Offcanvas.getOrCreateInstance("#revDrawer").hide(); return; }
    if (!(await confirmBox(`Delete the review from “${r.name}”? This cannot be undone. (Tip: you can hide it instead.)`))) return;
    await busy(btn, () => run(async () => {
      await fb.deleteDoc(fb.doc(db, "reviews", r.id));
      state.reviews = state.reviews.filter((x) => x !== r);
      renderReviews();
      bootstrap.Offcanvas.getOrCreateInstance("#revDrawer").hide();
    }, "Review deleted."));
  }
}

async function onReviewToggle(e) {
  const input = e.target.closest("[data-action=toggle]");
  if (!input) return;
  const r = state.reviews.find((x) => x._key === input.closest("[data-key]").dataset.key);
  if (!r) return;
  const active = input.checked;
  input.disabled = true;
  const ok = await run(async () => {
    await fb.updateDoc(fb.doc(db, "reviews", r.id), { active, updatedAt: fb.serverTimestamp() });
    r.active = active;
  }, `Review from ${r.name} is now ${active ? "visible" : "hidden"} on the website.`);
  if (!ok) input.checked = !active;
  renderReviews();
}

// ================================================================ Business info
function renderBusiness() {
  const s = state.settings;
  $("#bizPhone").value = s.phone || "";
  $("#bizWhatsapp").value = s.whatsapp || "";
  $("#bizHours").value = s.hours || "";
  renderAreaEditor();
  renderFaqEditor();
}

function renderAreaEditor() {
  const a = state.settings.areas;
  $("#areaEditor").innerHTML = a.map((area, i) => `
    <div class="list-row" data-i="${i}">
      <input class="form-control form-control-sm" name="area" maxlength="60" value="${esc(area)}" aria-label="Area ${i + 1}">
      <div class="btn-group btn-group-sm">
        <button type="button" class="btn btn-outline-secondary" data-area="up" ${i === 0 ? "disabled" : ""} aria-label="Move up"><i class="bi bi-arrow-up"></i></button>
        <button type="button" class="btn btn-outline-secondary" data-area="down" ${i === a.length - 1 ? "disabled" : ""} aria-label="Move down"><i class="bi bi-arrow-down"></i></button>
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger" data-area="remove" aria-label="Remove area"><i class="bi bi-x-lg"></i></button>
    </div>`).join("") || `<p class="small text-muted">No areas yet.</p>`;
}

function renderFaqEditor() {
  const f = state.settings.faq;
  $("#faqEditor").innerHTML = f.map((item, i) => `
    <div class="list-row flex-column align-items-stretch" data-i="${i}">
      <input class="form-control form-control-sm" name="faqQ" maxlength="200" placeholder="Question" value="${esc(item.q)}" aria-label="Question ${i + 1}">
      <textarea class="form-control form-control-sm" name="faqA" rows="2" maxlength="1000" placeholder="Answer" aria-label="Answer ${i + 1}">${esc(item.a)}</textarea>
      <div class="d-flex gap-2 justify-content-end">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-faq="up" ${i === 0 ? "disabled" : ""} aria-label="Move up"><i class="bi bi-arrow-up"></i></button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-faq="down" ${i === f.length - 1 ? "disabled" : ""} aria-label="Move down"><i class="bi bi-arrow-down"></i></button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-faq="remove"><i class="bi bi-trash"></i> Remove</button>
      </div>
    </div>`).join("") || `<p class="small text-muted">No questions yet.</p>`;
}

function syncBusinessInputs() {
  state.settings.areas = $$("#areaEditor [name=area]").map((i) => i.value.trim());
  state.settings.faq = $$("#faqEditor [data-i]").map((row) => ({
    q: $("[name=faqQ]", row).value.trim(),
    a: $("[name=faqA]", row).value.trim()
  }));
}

function move(arr, i, dir) {
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function addArea() {
  const input = $("#newArea");
  const v = input.value.trim();
  if (!v) { input.focus(); return; }
  syncBusinessInputs();
  if (state.settings.areas.some((a) => a.toLowerCase() === v.toLowerCase())) {
    toast("That area is already in the list.", "error");
    return;
  }
  state.settings.areas.push(v);
  input.value = "";
  renderAreaEditor();
}

async function onAreaClick(e) {
  const btn = e.target.closest("[data-area]");
  if (!btn) return;
  syncBusinessInputs();
  const i = Number(btn.closest("[data-i]").dataset.i);
  const a = state.settings.areas;
  if (btn.dataset.area === "remove") {
    if (!(await confirmBox(`Remove “${a[i] || "this area"}” from the list? (Saved when you tap “Save business info”.)`, "Remove"))) return;
    a.splice(i, 1);
  } else move(a, i, btn.dataset.area);
  renderAreaEditor();
}

async function onFaqClick(e) {
  const btn = e.target.closest("[data-faq]");
  if (!btn) return;
  syncBusinessInputs();
  const i = Number(btn.closest("[data-i]").dataset.i);
  const f = state.settings.faq;
  if (btn.dataset.faq === "remove") {
    if (!(await confirmBox(`Remove the question “${f[i].q || "(empty)"}”? (Saved when you tap “Save business info”.)`, "Remove"))) return;
    f.splice(i, 1);
  } else move(f, i, btn.dataset.faq);
  renderFaqEditor();
}

async function saveBusiness(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearInvalid(form);
  syncBusinessInputs();
  const phone = $("#bizPhone").value.trim();
  const whatsapp = $("#bizWhatsapp").value.replace(/[\s+]/g, "");
  let ok = true;
  if (!/^\+?[\d\s()-]{7,25}$/.test(phone)) { markInvalid($("#bizPhone")); ok = false; }
  if (!/^\d{8,15}$/.test(whatsapp)) { markInvalid($("#bizWhatsapp")); ok = false; }

  const areas = state.settings.areas.filter(Boolean);
  $$("#faqEditor [data-i]").forEach((row, i) => {
    const f = state.settings.faq[i];
    if (!!f.q !== !!f.a) { markInvalid($(f.q ? "[name=faqA]" : "[name=faqQ]", row), ""); ok = false; }
  });
  const faq = state.settings.faq.filter((f) => f.q && f.a);
  if (!ok) {
    toast("Please fix the highlighted fields (each FAQ needs both a question and an answer).", "error");
    $(".is-invalid", form)?.focus();
    return;
  }
  const data = { phone, whatsapp, hours: $("#bizHours").value.trim(), areas, faq, updatedAt: fb.serverTimestamp() };
  await busy($("button[type=submit]", form), () => run(async () => {
    await fb.setDoc(fb.doc(db, "settings", "business"), data);
    Object.assign(state.settings, { phone, whatsapp, hours: data.hours, areas: [...areas], faq: faq.map((f) => ({ ...f })) });
    renderBusiness();
    renderOverview();
    $("#seedCard").classList.toggle("d-none", state.services.length > 0);
  }, "Business info saved."));
}

start();
