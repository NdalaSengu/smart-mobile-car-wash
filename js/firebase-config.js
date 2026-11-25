// =====================================================================
//  FIREBASE CONFIG  👉  PASTE YOUR OWN VALUES HERE
// ---------------------------------------------------------------------
//  Where to find them:
//    1. Open https://console.firebase.google.com and choose your project.
//    2. Click the gear icon ⚙  →  "Project settings".
//    3. Scroll down to "Your apps". If there is no Web app yet, click the
//       </> (Web) icon and register one (you do NOT need Firebase Hosting
//       setup there – just give it a name).
//    4. Under "SDK setup and configuration" pick "Config" and copy the
//       values into the object below (replace every placeholder).
//
//  These values are NOT secret – it is normal for them to be public.
//  Your data is protected by the rules in firestore.rules.
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyAf-N4pCbcfclcIC6omswBLkI6Ls7Wy8ks",
  authDomain: "master-mobile-care-wash.firebaseapp.com",
  projectId: "master-mobile-care-wash",
  storageBucket: "master-mobile-care-wash.firebasestorage.app",
  messagingSenderId: "509162750940",
  appId: "1:509162750940:web:e7dd387e350f416ac54519"
};

// Firebase JavaScript SDK version loaded from the gstatic CDN.
export const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.14.1";

// ---------------------------------------------------------------------
//  You do NOT need to change anything below this line.
// ---------------------------------------------------------------------

// True once you have pasted a real config (used to show helpful messages).
export const isFirebaseConfigured =
  !firebaseConfig.apiKey.startsWith("PASTE_") &&
  firebaseConfig.projectId !== "your-project-id";

// Local testing with the Firebase Emulator Suite: open
// http://localhost:5000/?emulator (or /admin.html?emulator).
export const USE_EMULATORS =
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("emulator");

const EMULATOR_PROJECT = "demo-master-mobile";

export const canUseFirebase = USE_EMULATORS || isFirebaseConfigured;

export function getActiveConfig() {
  return USE_EMULATORS
    ? { apiKey: "demo-key", authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`, projectId: EMULATOR_PROJECT }
    : firebaseConfig;
}
