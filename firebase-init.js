/* ===========================================================
   FIREBASE INIT — shared by index.html (customer site) and
   admin.html (admin panel). Loaded via the compat SDK (CDN
   <script> tags, no bundler needed) — see the <script> tags
   near the bottom of each HTML file.
   =========================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyDn-AIlKa2OvOBSBkr5Zdst-bxDZoOUubE",
  authDomain: "viva-perf.firebaseapp.com",
  /* JESUS IS LORD*/
  projectId: "viva-perf",
  storageBucket: "viva-perf.firebasestorage.app",
  messagingSenderId: "764281350514",
  appId: "1:764281350514:web:6e1c6c1ebe92ff74ca55eb",
  measurementId: "G-MG28FJP9X4"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();