// Default content. Used (1) by the admin "Load default data" button to seed
// Firestore the first time and (2) by the public site as a fallback when
// Firestore cannot be reached.

export const BUSINESS_NAME = "Smart-Mobile Care Wash";
export const DEFAULT_PHONE = "+260 974 286 757";
export const DEFAULT_WHATSAPP = "260974286757";

export const VEHICLE_SIZES = [
  { key: "small", label: "Small car / Sedan" },
  { key: "suv", label: "SUV / Double cab" },
  { key: "van", label: "Van / Minibus" },
  { key: "truck", label: "Truck / Large" }
];

export const DEFAULT_AREAS = [
  "Solwezi Town Centre",
  "Kandundu",
  "Kyawama",
  "Mushitala",
  "Kimasala",
  "Kapijimpanga",
  "Messengers",
  "Mitec",
  "Kansanshi"
];

export const DEFAULT_HOURS = "Monday – Saturday: 07:00 – 18:00\nSunday: by appointment";

export const DEFAULT_FAQ = [
  {
    q: "Do you really come to my home?",
    a: "Yes. We are a mobile service – we come to your home, office or yard anywhere in our service areas in Solwezi."
  },
  {
    q: "How do I book?",
    a: "Fill in the booking form on this page and tap “Send on WhatsApp”, or simply call or WhatsApp us on +260 974 286 757. We will confirm the time with you."
  },
  {
    q: "How much does it cost?",
    a: "Prices depend on the service and the size of your vehicle. You can see our current prices in the Services section. If a price says “Ask for quote”, send us a message and we will tell you."
  },
  {
    q: "Which areas do you cover?",
    a: "We cover Solwezi Town Centre and nearby areas such as Kandundu, Kyawama, Mushitala, Kimasala, Kapijimpanga, Messengers, Mitec and Kansanshi. If your area is not listed, ask us – we may still come."
  },
  {
    q: "Do you also clean carpets and sofas?",
    a: "Yes. Besides cars, we clean sitting-room carpets and mats, sofas and seats at your home."
  },
  {
    q: "How do I pay?",
    a: "We confirm the price and payment options with you on WhatsApp when you book."
  }
];

const noCarPrices = () => ({ small: null, suv: null, van: null, truck: null });

// Prices are left empty on purpose – set your real prices in admin.html.
export const DEFAULT_SERVICES = [
  {
    id: "car-exterior",
    name: "Exterior wash",
    category: "car",
    description: "A careful hand wash of the outside of your car – body, wheels and windows.",
    bullets: ["Hand wash and rinse", "Wheels and tyres cleaned", "Windows and mirrors wiped", "Dried by hand"],
    active: true,
    order: 1,
    imageId: "",
    prices: noCarPrices()
  },
  {
    id: "car-interior",
    name: "Interior cleaning",
    category: "car",
    description: "We clean the inside so your car looks and feels fresh again.",
    bullets: ["Seats and floor vacuumed", "Dashboard and console wiped", "Door panels cleaned", "Inside windows wiped"],
    active: true,
    order: 2,
    imageId: "",
    prices: noCarPrices()
  },
  {
    id: "car-mats",
    name: "Car mats",
    category: "car",
    description: "A deep clean of your car mats – rubber or carpet.",
    bullets: ["Mats washed and scrubbed", "Dirt and stains lifted", "Dried before fitting back"],
    active: true,
    order: 3,
    imageId: "",
    prices: noCarPrices()
  },
  {
    id: "car-full",
    name: "Full package",
    category: "car",
    description: "Inside + outside + mats – the complete clean for your car.",
    bullets: ["Full exterior wash", "Full interior cleaning", "Car mats cleaned", "Best value"],
    active: true,
    order: 4,
    imageId: "",
    prices: noCarPrices()
  },
  {
    id: "home-carpets",
    name: "Sitting-room carpets & mats",
    category: "home",
    description: "We wash your sitting-room carpets and mats right at your home.",
    bullets: ["Deep wash at your doorstep", "Dust and stains lifted", "Fresh and clean again"],
    active: true,
    order: 5,
    imageId: "",
    price: null,
    unit: "per carpet"
  },
  {
    id: "home-sofas",
    name: "Sofas & seats",
    category: "home",
    description: "Fabric sofas and seats cleaned so your sitting room feels new.",
    bullets: ["Fabric seats cleaned", "Stains treated", "Fresh look and feel"],
    active: true,
    order: 6,
    imageId: "",
    price: null,
    unit: "per seat"
  }
];

// ---------- small shared helpers ----------

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export function formatKwacha(value) {
  const n = Number(value);
  return "K" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function hasPrice(value) {
  return typeof value === "number" && isFinite(value) && value > 0;
}

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isSafeImage(dataUrl) {
  return typeof dataUrl === "string" && /^data:image\/(webp|jpeg|png);base64,/.test(dataUrl);
}
