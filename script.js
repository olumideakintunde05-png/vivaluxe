/* ===========================================================
   VIVA PERFUMERY — app logic
   =========================================================== */

/* Wishlist persistence: guests get localStorage (survives reload on
   this device); logged-in users get it synced to their Firestore user
   doc (survives across devices too). See loadGuestWishlist() /
   persistWishlist() / the auth-state handler below for the sync. */
let wishlist = new Set(WISHLIST_IDS);
let cart = CART.map(c => ({ ...c }));
let cartOwnerUid; // tracks which account (or guest/undefined-not-yet-known) the current cart belongs to
loadGuestWishlist(); // populate from localStorage immediately; onAuthStateChanged below overrides this for logged-in users
loadGuestCart(); // same idea for cart — see GUEST_CART_KEY / persistCart() / the auth-state handler below
let activeCategory = 'necklaces';
let productDetailReturnScreen = null;
let currentProductDetailId = null;
let ORDERS = [];
let ordersUnsub = null;
let orderListStatus = null; // which status the "order list" screen is currently showing
const ADMIN_EMAILS = ['Vivaluxebyvivian@gmail.com']; // update to the real admin login email(s)
let adminOrdersUnsub = null;

/* Formspree endpoint for the Newsletter signup form — no backend,
   no Firestore. Each submission arrives as an email to whatever
   inbox the form is connected to, plus a row in that form's
   Formspree dashboard (exportable as CSV).
   Set up at https://formspree.io (free tier, 50 submissions/mo):
   1. Sign up, click "New Form", give it a name (e.g. "Viva Luxe Newsletter").
   2. Set the notification email to your admin inbox.
   3. Copy the endpoint it gives you (https://formspree.io/f/xxxxxxx)
      and paste it below.
   (Reviews now go straight to Firestore and display on the homepage —
   see watchReviews() / submitReview() — no Formspree involved there.) */
const NEWSLETTER_FORMSPREE_ENDPOINT = 'https://formspree.io/f/mjyblopz';

/* ---------------- Order notifications (email + WhatsApp) ----------------
   Writing the order to Firestore is enough to trigger both — a Cloud
   Function (see functions/index.js) watches the 'orders' collection and
   emails the admin from her own Gmail, and messages her own WhatsApp
   Business number via Meta's WhatsApp Cloud API, whenever a new doc is
   created. Nothing to call from here; this comment just documents where
   those alerts actually come from, so it isn't mistaken for a missing
   feature. (Previously this ran client-side through CallMeBot, a
   third-party WhatsApp relay — that's been retired in favor of the
   Cloud Function, which uses only the admin's own Gmail and WhatsApp
   Business accounts. See functions/index.js for setup.) */

/* ---------------- Stock deduction on approved orders ----------------
   Called once an order is confirmed sold: the instant Paystack verifies
   payment, or when admin clicks "Accept" on a bank-transfer order (see
   adminSetOrderStatus in admin.js — same function, duplicated there since
   it's a separate script file). Guarded by order.stockDeducted so a
   double-click or re-run can never subtract stock twice for one order. */
function deductStockForOrder(orderId, items){
  if(!items || !items.length) return Promise.resolve();
  const orderRef = db.collection('orders').doc(orderId);
  return db.runTransaction(t => {
    return t.get(orderRef).then(orderSnap => {
      if(orderSnap.exists && orderSnap.data().stockDeducted) return; // already deducted — never double-count
      const productRefs = items.map(i => db.collection('products').doc(i.id));
      return Promise.all(productRefs.map(ref => t.get(ref))).then(snaps => {
        snaps.forEach((snap, idx) => {
          if(!snap.exists) return;
          const currentStock = snap.data().stock;
          if(currentStock === undefined || currentStock === null) return; // stock not tracked for this product — leave it alone
          t.update(productRefs[idx], { stock: Math.max(0, currentStock - items[idx].qty) });
        });
        t.update(orderRef, { stockDeducted: true });
      });
    });
  }).catch(err => console.warn('Stock deduction failed (order was still saved fine):', err));
}

/* ---------------- Currency formatting ----------------
   Used everywhere a price is shown (product cards, cart, checkout,
   product detail). Coerces to a number first since admin-entered
   prices can arrive as strings from a form field. */
function nairaFmt(amount){
  const n = Number(amount) || 0;
  return '₦' + n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

/* ---------------- Navigation ---------------- */
function showScreen(name){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === name));
  window.scrollTo(0,0);
  if(name === 'wishlist') renderWishlist();
  if(name === 'cart') renderCart();
  if(name === 'home') playHeroAnimation();
}

/* ---------------- Hero entrance animation ----------------
   Waits for the hero background photo to actually finish loading
   before revealing the text — adding .hero-animate too early would
   make the eyebrow/title drop in over a blank/half-loaded image.
   Re-triggerable: removing then re-adding the class lets it replay
   every time the Home screen is shown, not just on first paint. */
function playHeroAnimation(){
  const hero = document.querySelector('.hero');
  const bgImg = document.querySelector('.hero-bg-img');
  if(!hero || !bgImg) return;
  hero.classList.remove('hero-animate');
  void hero.offsetWidth; // force reflow so the removed class registers before re-adding it
  const reveal = () => hero.classList.add('hero-animate');
  if(bgImg.complete && bgImg.naturalWidth > 0){
    reveal();
  } else {
    bgImg.addEventListener('load', reveal, { once: true });
  }
}

/* ---------------- Thumb helper ----------------
   Renders a real <img> for the product/category/collection photo.
   If the file hasn't been uploaded yet (or 404s), it quietly
   swaps in the matching soft-gold icon instead — nothing ever
   shows a broken-image icon. */
function thumbHtml(img, icon, alt){
  return `<div class="thumb">
    <img src="${img}" alt="${alt || ''}" loading="lazy"
      onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
    <div class="thumb-fallback" style="display:none;">${icon}</div>
  </div>`;
}

/* ---------------- Perfume request → WhatsApp ---------------- */
function requestPerfumesWhatsApp(){
  const message = encodeURIComponent(WHATSAPP_PERFUME_MSG);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
}

/* ---------------- Coming soon toast (for UI-preview-only actions) ---------------- */
function comingSoon(label){
  alert(`This is a UI preview — ${label} is not wired up yet.`);
}

/* ---------------- Info pages (About / Shipping / Returns / Terms / Privacy / Contact) ---------------- */
let infoReturnScreen = 'home';
function showInfo(key){
  const page = INFO_PAGES[key];
  if(!page) return;
  const current = document.querySelector('.screen.active');
  if(current) infoReturnScreen = current.id.replace('screen-', '');
  document.getElementById('infoTitle').textContent = page.title;
  document.getElementById('infoBody').innerHTML = page.body.split('{{CONTACT_EMAIL}}').join(CONTACT_EMAIL);
  showScreen('info');
}

/* ---------------- Site settings (Firestore-backed) ----------------
   WhatsApp number, contact email, and delivery fees are editable
   live from the admin panel's Settings tab. This listens for changes
   and overwrites the defaults from data.js as soon as they arrive or
   change, so the storefront never needs a redeploy for these. */
const SITE_TEXT_DEFAULTS = {
  shopByCategory: 'Shop by Category',
  ourProducts: 'Product Categories',
  perfumeHeading: 'Need a perfume?',
  whyUs: 'Why Us',
  emailUpdates: 'Get e-mail updates',
  reviews: 'Reviews',
  faq: 'Frequently Asked',
  shopPageTitle: 'Shop',
  heroEyebrow: 'Non-Tarnish Jewellery • Minimal • Timeless • Statement Pieces',
  heroTitle: 'Elevate Every Moment',
  topBanner: 'Free delivery on orders over ₦150,000',
  whatsappBtnText: 'Chat on WhatsApp',
};
function applySiteText(siteText){
  const map = { ...SITE_TEXT_DEFAULTS, ...(siteText || {}) };
  Object.keys(map).forEach(key => {
    const el = document.getElementById('txt-' + key);
    if(el) el.textContent = map[key];
  });
}
function applySiteSettings(data){
  if(!data) return;
  if(data.whatsappNumber) WHATSAPP_NUMBER = data.whatsappNumber;
  if(data.contactEmail) CONTACT_EMAIL = data.contactEmail;
  if(data.whatsappPerfumeMsg) WHATSAPP_PERFUME_MSG = data.whatsappPerfumeMsg;
  if(data.whatsappSupportMsg) WHATSAPP_SUPPORT_MSG = data.whatsappSupportMsg;
  if(data.whatsappFloatMsg) WHATSAPP_FLOAT_MSG = data.whatsappFloatMsg;
  if(typeof data.freeDeliveryThreshold === 'number') FREE_DELIVERY_THRESHOLD = data.freeDeliveryThreshold;
  if(typeof data.defaultDeliveryFee === 'number') DELIVERY_FEE = data.defaultDeliveryFee;
  // deliveryStates is the complete, current list of locations set from
  // the admin panel (states can be added or removed there). When present
  // it fully replaces the built-in default list rather than merging.
  if(Array.isArray(data.deliveryStates) && data.deliveryStates.length){
    NIGERIAN_STATES.length = 0;
    data.deliveryStates.forEach(s => NIGERIAN_STATES.push(s));
  }
  if(data.stateDeliveryFees && typeof data.stateDeliveryFees === 'object'){
    STATE_DELIVERY_FEES = Array.isArray(data.deliveryStates) && data.deliveryStates.length
      ? data.stateDeliveryFees
      : { ...STATE_DELIVERY_FEES, ...data.stateDeliveryFees };
  }
  if(data.bankName) BANK_NAME = data.bankName;
  if(data.bankAccountNumber) BANK_ACCOUNT_NUMBER = data.bankAccountNumber;
  if(data.bankAccountName) BANK_ACCOUNT_NAME = data.bankAccountName;
  applyBankDetails();
  if(data.socialLinks && typeof data.socialLinks === 'object'){
    SOCIAL_INSTAGRAM = data.socialLinks.instagram || '';
    SOCIAL_FACEBOOK = data.socialLinks.facebook || '';
    SOCIAL_TIKTOK = data.socialLinks.tiktok || '';
  }
  if(Array.isArray(data.faqs) && data.faqs.length){
    HELP_FAQS.length = 0;
    data.faqs.forEach(f => HELP_FAQS.push(f));
    if(typeof renderFaqs === 'function') renderFaqs();
  }
  if(Array.isArray(data.whyUsItems) && data.whyUsItems.length){
    data.whyUsItems.forEach((item, i) => {
      if(WHY_US[i]){
        WHY_US[i].title = item.title || WHY_US[i].title;
        WHY_US[i].text = item.text || WHY_US[i].text;
      }
    });
    if(typeof renderWhyUs === 'function') renderWhyUs();
  }
  if(data.bestSellersName && COLLECTIONS[0]){
    COLLECTIONS[0].name = data.bestSellersName;
    if(typeof renderCollections === 'function') renderCollections();
  }
  // New categories added from admin (beyond the original fixed set)
  // arrive here and must be pushed into CATEGORIES before the
  // categoryLabels rename step below, since that step only updates
  // labels on entries that already exist — it can't add new ones.
  let categoriesChanged = false;
  if(Array.isArray(data.customCategories) && data.customCategories.length){
    data.customCategories.forEach(nc => {
      if(nc && nc.key && !CATEGORIES.find(c => c.key === nc.key)){
        CATEGORIES.push({ key: nc.key, label: nc.label || nc.key, icon: nc.icon || null });
        categoriesChanged = true;
      }
    });
  }
  if(data.categoryLabels && typeof data.categoryLabels === 'object'){
    Object.keys(data.categoryLabels).forEach(key => {
      const c = CATEGORIES.find(x => x.key === key);
      if(c) c.label = data.categoryLabels[key];
    });
    categoriesChanged = true;
  }
  if(categoriesChanged){
    if(typeof renderCategoryTiles === 'function') renderCategoryTiles();
    if(typeof renderShopCategoryChips === 'function') renderShopCategoryChips();
  }
  // Same pattern as categories: new "Explore Collections" tabs get
  // pushed in first (customCollections), then renames are applied
  // (collectionLabels) — the 3 built-in tabs (new/best/sale) can be
  // renamed but not removed, since their filter logic is hardcoded.
  let collectionsChanged = false;
  if(Array.isArray(data.customCollections) && data.customCollections.length){
    data.customCollections.forEach(nc => {
      if(nc && nc.key && !COLLECTION_TABS.find(c => c.key === nc.key)){
        COLLECTION_TABS.push({ key: nc.key, label: nc.label || nc.key, type: 'tag' });
        collectionsChanged = true;
      }
    });
  }
  if(data.collectionLabels && typeof data.collectionLabels === 'object'){
    Object.keys(data.collectionLabels).forEach(key => {
      const c = COLLECTION_TABS.find(x => x.key === key);
      if(c) c.label = data.collectionLabels[key];
    });
    collectionsChanged = true;
  }
  if(collectionsChanged && typeof renderCollectionTabs === 'function') renderCollectionTabs();
  if(data.siteImages && typeof data.siteImages === 'object'){
    applySiteImages(data.siteImages);
  }
  if(data.infoPages && typeof data.infoPages === 'object'){
    Object.keys(data.infoPages).forEach(key => {
      if(INFO_PAGES[key]) INFO_PAGES[key] = { ...INFO_PAGES[key], ...data.infoPages[key] };
    });
  }
  applySiteText(data.siteText);
  // Refresh any already-rendered screen that shows these values.
  if(document.getElementById('screen-cart')?.classList.contains('active')) renderCart();
  if(document.getElementById('screen-checkout')?.classList.contains('active')) renderCheckoutSummary();
  const stateSel = document.getElementById('ckState');
  if(stateSel) populateStates();
}
function applyBankDetails(){
  const numEl = document.getElementById('bankAcctNum');
  const nameEl = document.getElementById('bankNameVal');
  const acctNameEl = document.getElementById('bankAcctNameVal');
  if(numEl) numEl.textContent = BANK_ACCOUNT_NUMBER;
  if(nameEl) nameEl.textContent = BANK_NAME;
  if(acctNameEl) acctNameEl.textContent = BANK_ACCOUNT_NAME;
}
function applySiteImages(siteImages){
  if(siteImages.logoHeader){
    document.querySelectorAll('img[data-site-logo="header"]').forEach(img => img.src = siteImages.logoHeader);
  }
  if(siteImages.logoFooter){
    document.querySelectorAll('img[data-site-logo="footer"]').forEach(img => img.src = siteImages.logoFooter);
  }
  if(siteImages.heroBg){
    document.querySelectorAll('img[data-site-hero-bg]').forEach(img => img.src = siteImages.heroBg);
  }
}
function openSocialLink(platform){
  const urls = { instagram: SOCIAL_INSTAGRAM, facebook: SOCIAL_FACEBOOK, tiktok: SOCIAL_TIKTOK };
  const labels = { instagram: 'Instagram link', facebook: 'Facebook link', tiktok: 'TikTok link' };
  const url = urls[platform];
  if(url) window.open(url, '_blank', 'noopener');
  else comingSoon(labels[platform] || (platform + ' link'));
}
function watchSiteSettings(){
  if(typeof db === 'undefined') return;
  db.collection('settings').doc('site').onSnapshot(doc => {
    if(doc.exists) applySiteSettings(doc.data());
  }, err => console.error('Failed to load site settings:', err));
}
function closeInfo(){
  showScreen(infoReturnScreen);
}

const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>`;

/* ---------------- Hamburger side drawer ---------------- */
function openMenu(){
  document.getElementById('menuOverlay').classList.add('open');
  document.getElementById('sideDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMenu(){
  document.getElementById('menuOverlay').classList.remove('open');
  document.getElementById('sideDrawer').classList.remove('open');
  document.body.style.overflow = '';
}
function drawerGo(screen, categoryKey){
  closeMenu();
  if(categoryKey){
    selectCategory(categoryKey);
  } else {
    showScreen(screen);
  }
}

/* ---------------- Search ---------------- */
function openSearch(){
  document.getElementById('searchOverlay').classList.add('open');
  document.getElementById('searchResults').innerHTML = `<div class="search-hint">Search for necklaces, rings, bracelets, and more.</div>`;
  setTimeout(() => document.getElementById('searchInput').focus(), 300);
}
function closeSearch(){
  document.getElementById('searchOverlay').classList.remove('open');
  document.getElementById('searchInput').value = '';
}
function runSearch(q){
  const term = q.trim().toLowerCase();
  const results = document.getElementById('searchResults');
  if(term.length === 0){
    results.innerHTML = `<div class="search-hint">Search for necklaces, rings, bracelets, and more.</div>`;
    return;
  }
  const matches = PRODUCTS.filter(p =>
    p.name.toLowerCase().includes(term) ||
    (p.sub || '').toLowerCase().includes(term) ||
    (p.kicker || '').toLowerCase().includes(term)
  );
  results.innerHTML = matches.length
    ? `<div class="product-grid">${productListHtml(matches)}</div>`
    : `<div class="search-hint">No results for "${q}".</div>`;
}

/* ---------------- Bottom sheet (Sort / Filter) ---------------- */
let activeSort = 'default';
let activeFilter = null;

function openSheet(){
  document.getElementById('sheetOverlay').classList.add('open');
  document.getElementById('bottomSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheet(){
  document.getElementById('sheetOverlay').classList.remove('open');
  document.getElementById('bottomSheet').classList.remove('open');
  document.body.style.overflow = '';
}
const SORT_OPTIONS = [
  { key:'default',    label:'Featured' },
  { key:'price-asc',  label:'Price: Low to High' },
  { key:'price-desc', label:'Price: High to Low' },
  { key:'rating',     label:'Top Rated' },
];
function openSortSheet(){
  document.getElementById('sheetContent').innerHTML = `
    <h3 class="sheet-title">Sort by</h3>
    ${SORT_OPTIONS.map(o => `
      <div class="sheet-option ${activeSort===o.key?'active':''}" onclick="applySort('${o.key}')">
        <span>${o.label}</span>${activeSort===o.key?CHECK_ICON:''}
      </div>`).join('')}
  `;
  openSheet();
}
function applySort(key){
  activeSort = key;
  closeSheet();
  renderShopGrid();
}
const FILTER_OPTIONS = [
  { key:null,       label:'All Prices' },
  { key:'under50',  label:'Under ₦50,000' },
  { key:'50to150',  label:'₦50,000 – ₦150,000' },
  { key:'above150', label:'Above ₦150,000' },
];
function openFilterSheet(){
  renderFilterSheet();
  openSheet();
}
function renderFilterSheet(){
  document.getElementById('sheetContent').innerHTML = `
    <h3 class="sheet-title">Filter by Price</h3>
    ${FILTER_OPTIONS.map(o => `
      <div class="sheet-option ${activeFilter===o.key?'active':''}" onclick="applyFilter(${o.key?`'${o.key}'`:null})">
        <span>${o.label}</span>${activeFilter===o.key?CHECK_ICON:''}
      </div>`).join('')}
    <button class="btn-black sheet-apply" onclick="closeSheet()">Show Results</button>
  `;
}
function applyFilter(key){
  activeFilter = key;
  renderFilterSheet();
  renderShopGrid();
}
function inPriceRange(price, key){
  if(key === 'under50')  return price < 50000;
  if(key === '50to150')  return price >= 50000 && price <= 150000;
  if(key === 'above150') return price > 150000;
  return true;
}

/* ---------------- Firestore: live products ---------------- */
function watchProducts(){
  if(typeof db === 'undefined'){
    console.error('Firestore not ready — check your connection and reload.');
    document.getElementById('shopGrid').innerHTML = `<div class="empty-state">Couldn't connect — check your connection and reload the page.</div>`;
    return;
  }
  db.collection('products').onSnapshot(snapshot => {
    PRODUCTS = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderShopGrid();
    renderJewelryHighlights();
    renderWishlist();
    renderCart();
    if(document.getElementById('searchOverlay').classList.contains('open')){
      runSearch(document.getElementById('searchInput').value);
    }
  }, err => {
    console.error('Failed to load products:', err);
    document.getElementById('shopGrid').innerHTML = `<div class="empty-state">Couldn't load products — check your connection and try again.</div>`;
  });
}

/* ---------------- Rating stars ---------------- */
function ratingHtml(rating, count){
  if(!count) return '';
  const r = Number(rating) || 0;
  return `<div class="p-rating">
    <svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z"/></svg>
    ${r.toFixed(1)} <span style="opacity:.7">(${count})</span>
  </div>`;
}

/* ---------------- Home: "Shop by Category" square image tiles (Glitz-style) ---------------- */
function renderCategoryTiles(){
  const row = document.getElementById('catTileRow');
  if(!row) return;
  const featuredKeys = ['necklaces', 'earrings', 'bracelets', 'sunglasses'];
  const shown = featuredKeys
    .map(key => CATEGORIES.find(c => c.key === key))
    .filter(Boolean);
  row.innerHTML = shown.map(c => `
    <div class="cat-tile" onclick="selectCategory('${c.key}');showScreen('shop')">
      <img src="${c.icon}" alt="${c.label}">
      <span>${c.label}</span>
    </div>
  `).join('');
}

function selectCategory(key){
  activeCategory = key;
  renderShopCategoryChips();
  showScreen('shop');
  renderShopGrid();
}

/* ---------------- Collection scroller ---------------- */
function renderCollections(){
  const row = document.getElementById('collectionRow');
  if(!row) return;
  row.innerHTML = COLLECTIONS.map(c => `
    <div class="collection-card">
      ${thumbHtml(c.img, c.icon, c.name)}
      <h3>${c.name}</h3>
      <span class="explore" onclick="showScreen('shop')">Explore
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 6l6 6-6 6"/></svg>
      </span>
    </div>
  `).join('');
}

/* Cover photo for grid/cart/wishlist thumbnails — first image in the
   gallery array. Falls back to the old single-image field for any
   product created before the multi-photo update. */
function coverImg(p){
  return (p.images && p.images[0]) || p.img || '';
}
/* Full photo set for the product detail gallery. */
function galleryImages(p){
  if(p.images && p.images.length) return p.images;
  return p.img ? [p.img] : [];
}
/* Stock display text. Treats missing/undefined stock as "not tracked
   yet" rather than assuming it's out of stock, since older products
   may not have a stock value set. */
function stockLabel(stock){
  if(stock === undefined || stock === null) return 'In Stock';
  if(stock <= 0) return 'Out of Stock';
  if(stock <= 3) return `Only ${stock} left`;
  return 'In Stock';
}

/* ---------------- Product detail ---------------- */
function openProductDetail(id){
  const p = productById(id);
  if(!p) return;
  const current = document.querySelector('.screen.active');
  if(current) productDetailReturnScreen = current.id.replace('screen-', '');
  currentProductDetailId = id;

  const images = galleryImages(p);
  const track = document.getElementById('pdGalleryTrack');
  const dots = document.getElementById('pdDots');
  if(images.length){
    track.innerHTML = images.map(url => `
      <div class="pd-slide"><img src="${url}" alt="${p.name}" loading="lazy"></div>
    `).join('');
  } else {
    track.innerHTML = `<div class="pd-slide">${p.icon || ICONS.product}</div>`;
  }
  dots.innerHTML = images.length > 1
    ? images.map((_, i) => `<span class="dot ${i===0?'active':''}"></span>`).join('')
    : '';
  track.scrollLeft = 0;
  track.onscroll = () => {
    if(images.length < 2) return;
    const idx = Math.round(track.scrollLeft / track.clientWidth);
    dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  };

  document.getElementById('pdHeartBtn').classList.toggle('filled', wishlist.has(id));
  document.getElementById('pdKicker').textContent = productKickerLabel(p);
  document.getElementById('pdName').textContent = p.name;
  document.getElementById('pdSub').textContent = p.sub;
  document.getElementById('pdRating').innerHTML = ratingHtml(p.rating, p.count);
  document.getElementById('pdPrice').textContent = nairaFmt(p.price);
  const stockText = stockLabel(p.stock);
  const outOfStock = p.stock !== undefined && p.stock !== null && p.stock <= 0;
  document.getElementById('pdStock').textContent = stockText;
  document.getElementById('pdStock').classList.toggle('low', p.stock > 0 && p.stock <= 3);
  document.getElementById('pdStock').classList.toggle('out', outOfStock);
  const addBtn = document.getElementById('pdAddToBagBtn');
  addBtn.disabled = outOfStock;
  addBtn.textContent = outOfStock ? 'Out of Stock' : '';
  if(!outOfStock){
    addBtn.innerHTML = `Add to Cart
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6h15l-1.5 9h-13z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>`;
  }
  addBtn.onclick = outOfStock ? null : () => addToCart(id);

  showScreen('product-detail');
}

/* ---------------- Product card ---------------- */
function productCardHtml(p){
  const filled = wishlist.has(p.id) ? 'filled' : '';
  const outOfStock = p.stock !== undefined && p.stock !== null && p.stock <= 0;
  return `
    <div class="product-card" onclick="openProductDetail('${p.id}')">
      <button class="heart-btn ${filled}" onclick="event.stopPropagation(); toggleWishlist('${p.id}', this)">
        <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.4 8 2 4.5 5.4 4A5.4 5.4 0 0112 7a5.4 5.4 0 016.6-3c3.4.5 5 4 3.4 7.7C19.5 16.4 12 21 12 21z"/></svg>
      </button>
      ${thumbHtml(coverImg(p), p.icon || ICONS.product, p.name)}
      <div class="p-kicker">${productKickerLabel(p)}</div>
      <div class="p-name">${p.name || 'Unnamed item'}</div>
      <div class="p-sub">${p.sub || ''}</div>
      ${ratingHtml(p.rating, p.count)}
      <div class="p-price">${nairaFmt(p.price)}</div>
      <button class="card-cart-btn ${outOfStock ? 'out' : ''}"
        ${outOfStock ? 'disabled' : ''}
        onclick="event.stopPropagation(); ${outOfStock ? '' : `addToCart('${p.id}')`}">
        ${outOfStock ? 'Out Of Stock' : 'Add To Cart'}
      </button>
    </div>
  `;
}
/* Renders a list of products, skipping (and logging) any single
   product whose data is malformed instead of letting one bad admin
   entry blank out the entire grid. */
function productListHtml(list){
  const cards = [];
  list.forEach(p => {
    try{ cards.push(productCardHtml(p)); }
    catch(err){ console.error('Skipped a product that failed to render:', p && p.id, err); }
  });
  return cards.join('');
}

/* Sorts by name the way a person would: "Pear Earring 2" before
   "Pear Earring 10", and groups same-named product families (01,
   02, 03...) together in ascending numeric order, instead of
   Firestore's arbitrary document order. */
function naturalNameSort(list){
  return [...list].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' })
  );
}

/* Same numeric-aware sort as naturalNameSort, but for the Earrings
   category only: any "Statement Earring" product family sorts to
   the front (ascending numeric order among themselves), ahead of
   every other earring family (Pear Earring, Vintage Earring, etc.),
   which then follow in their normal natural sort order. */
function earringsHighlightSort(list){
  const isStatement = p => /^statement earring/i.test(String(p.name || '').trim());
  return [...list].sort((a, b) => {
    const aStatement = isStatement(a);
    const bStatement = isStatement(b);
    if(aStatement !== bStatement) return aStatement ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
  });
}

/* ---------------- Customer Reviews (homepage) ---------------- */
let selectedReviewStars = 5;

function watchReviews(){
  if(typeof db === 'undefined') return;
  db.collection('reviews').orderBy('createdAt', 'desc').limit(30).onSnapshot(snapshot => {
    const reviews = snapshot.docs.map(doc => doc.data());
    renderReviews(reviews);
  }, err => {
    console.error('Could not load reviews:', err);
  });
}

function renderReviews(reviews){
  const el = document.getElementById('reviewsList');
  if(!el) return;
  if(!reviews.length){
    el.innerHTML = `<p class="review-empty">No reviews yet — be the first to leave one.</p>`;
    return;
  }
  el.innerHTML = reviews.map(r => {
    const stars = '★'.repeat(Math.max(0, Math.min(5, Number(r.rating) || 0))) + '☆'.repeat(5 - Math.max(0, Math.min(5, Number(r.rating) || 0)));
    const dateStr = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `
      <div class="review-card">
        <div class="review-card-top">
          <span class="review-name">${escapeHtml(r.name || 'Anonymous')}</span>
          <span class="review-stars">${stars}</span>
        </div>
        <div class="review-comment">${escapeHtml(r.comment || '')}</div>
        ${dateStr ? `<div class="review-date">${dateStr}</div>` : ''}
      </div>
    `;
  }).join('');
}

/* Small HTML-escape helper — reviews are free-text from customers,
   so this stops a review comment from ever being rendered as markup. */
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openWriteReviewSheet(){
  selectedReviewStars = 5;
  document.getElementById('sheetContent').innerHTML = `
    <h3 class="sheet-title">Write a Review</h3>
    <input class="form-input" id="reviewNameInput" placeholder="Your name" style="margin-bottom:10px;">
    <div class="star-picker" id="reviewStarPicker"></div>
    <textarea class="form-input" id="reviewCommentInput" placeholder="Share your experience..." rows="3" style="width:100%;resize:vertical;margin-bottom:12px;"></textarea>
    <button class="btn-black" style="width:100%;justify-content:center;" onclick="submitReview()">Submit Review</button>
    <p id="reviewSubmitStatus" style="font-size:12px;margin-top:8px;"></p>
  `;
  renderStarPicker();
  openSheet();
}

function renderStarPicker(){
  const picker = document.getElementById('reviewStarPicker');
  if(!picker) return;
  picker.innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<span class="${n <= selectedReviewStars ? 'filled' : ''}" onclick="setReviewStars(${n})">★</span>`
  ).join('');
}
function setReviewStars(n){
  selectedReviewStars = n;
  renderStarPicker();
}

async function submitReview(){
  const name = document.getElementById('reviewNameInput').value.trim();
  const comment = document.getElementById('reviewCommentInput').value.trim();
  const statusEl = document.getElementById('reviewSubmitStatus');

  if(!name){
    statusEl.textContent = 'Please enter your name.';
    return;
  }
  if(!comment){
    statusEl.textContent = 'Please write a short review.';
    return;
  }
  if(typeof db === 'undefined'){
    statusEl.textContent = 'Could not connect — check your connection and try again.';
    return;
  }

  statusEl.textContent = 'Submitting...';
  try{
    await db.collection('reviews').add({
      name: name.slice(0, 60),
      rating: selectedReviewStars,
      comment: comment.slice(0, 500),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeSheet();
  } catch(err){
    console.error('Could not submit review:', err);
    statusEl.textContent = 'Could not submit your review — please try again.';
  }
}

/* ---------------- Home "Our Products" category dropdown ---------------- */
let homeCategoryFilter = CATEGORIES[0].key; // starts on the first real category (Necklaces) — no "All" option
function openHomeCategorySheet(){
  document.getElementById('sheetContent').innerHTML = `
    <h3 class="sheet-title">Product Categories</h3>
    ${CATEGORIES.map(c => `
      <div class="sheet-option ${homeCategoryFilter===c.key?'active':''}" onclick="applyHomeCategory('${c.key}')">
        <span>${c.label}</span>${homeCategoryFilter===c.key?CHECK_ICON:''}
      </div>`).join('')}
  `;
  openSheet();
}
function applyHomeCategory(key){
  homeCategoryFilter = key;
  closeSheet();
  renderJewelryHighlights();
}
function renderJewelryHighlights(){
  const grid = document.getElementById('jewelryHighlights');
  const label = document.getElementById('homeCatFilterLabel');
  if(label){
    const cat = CATEGORIES.find(c => c.key === homeCategoryFilter);
    label.textContent = cat ? cat.label : CATEGORIES[0].label;
  }
  // Home "Our Products" shows any product in the selected category,
  // capped at 10 below — no highlight flag required.
  let list = PRODUCTS.filter(p => productCategory(p) === homeCategoryFilter);
  // Earrings gets a special-case sort (Statement Earring families
  // first); every other category keeps plain natural-name sorting.
  list = homeCategoryFilter === 'earrings' ? earringsHighlightSort(list) : naturalNameSort(list);
  // Homepage "Our Products" is a curated teaser, not the full Shop
  // page — cap it at 10 items per category after sorting.
  list = list.slice(0, 10);
  grid.innerHTML = list.length
    ? productListHtml(list)
    : `<div class="empty-state">No featured products in this category yet.</div>`;
  renderCollectionGrid();
}

/* ---------------- Home: "Explore Collections" tabs ---------------- */
let activeCollectionTab = 'new';
function renderCollectionTabs(){
  const wrap = document.getElementById('collectionTabs');
  if(!wrap) return;
  wrap.innerHTML = COLLECTION_TABS.map(c => `
    <div class="tab ${activeCollectionTab===c.key?'active':''}" data-tab="${c.key}" onclick="setCollectionTab('${c.key}')">${c.label}</div>
  `).join('');
}
function setCollectionTab(tab){
  activeCollectionTab = tab;
  document.querySelectorAll('#collectionTabs .tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  renderCollectionGrid();
}
function renderCollectionGrid(){
  const grid = document.getElementById('collectionGrid');
  if(!grid) return;
  let items = [];
  let emptyMsg = '';
  if(activeCollectionTab === 'new'){
    items = PRODUCTS.filter(p => p.isNew);
    emptyMsg = 'No new arrivals yet — check back soon.';
  } else if(activeCollectionTab === 'best'){
    items = [...PRODUCTS]
      .filter(p => p.rating)
      .sort((a, b) => (b.rating * (b.count || 0)) - (a.rating * (a.count || 0)));
    emptyMsg = 'No best sellers yet.';
  } else if(activeCollectionTab === 'sale'){
    items = PRODUCTS.filter(p => p.onSale);
    emptyMsg = 'Nothing on sale right now.';
  } else {
    // Any collection added from admin after the 3 built-ins — matched
    // by tag rather than a dedicated flag.
    const cat = COLLECTION_TABS.find(c => c.key === activeCollectionTab);
    items = PRODUCTS.filter(p => Array.isArray(p.collectionTags) && p.collectionTags.includes(activeCollectionTab));
    emptyMsg = `Nothing in "${cat ? cat.label : activeCollectionTab}" yet.`;
  }
  items = items.slice(0, 8);
  grid.innerHTML = items.length
    ? productListHtml(items)
    : `<div class="empty-state">${emptyMsg}</div>`;
}

/* ---------------- Home: testimonials (real reviews from Firestore) ---------------- */
function watchTestimonials(){
  const row = document.getElementById('testimonialRow');
  if(!row) return;
  if(typeof db === 'undefined'){
    console.error('Firestore not ready — check your connection and reload.');
    row.innerHTML = `<div class="empty-state">Couldn't connect — check your connection and reload the page.</div>`;
    return;
  }
  db.collection('reviews').orderBy('createdAt', 'desc').limit(10).onSnapshot(snapshot => {
    const reviews = snapshot.docs.map(doc => doc.data());
    row.innerHTML = reviews.length
      ? reviews.map(r => `
          <div class="testimonial-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="quote-mark"><path d="M7 7c-2.2 0-4 1.8-4 4v6h6v-6H6.5c0-1.4 1-2.5 2.5-2.5V7zM17 7c-2.2 0-4 1.8-4 4v6h6v-6h-2.5c0-1.4 1-2.5 2.5-2.5V7z"/></svg>
            <p class="testimonial-text">${escapeHtml(r.text)}</p>
            <div class="testimonial-name">${escapeHtml(r.name || 'Anonymous')}</div>
          </div>
        `).join('')
      : `<div class="empty-state">No reviews yet — be the first to share yours below.</div>`;
  }, err => {
    console.error('Failed to load reviews:', err);
    row.innerHTML = `<div class="empty-state">Couldn't load reviews right now.</div>`;
  });
}
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---------------- Home: newsletter signup ---------------- */
function submitNewsletter(){
  const emailInput = document.getElementById('newsletterEmail');
  const email = emailInput.value.trim();
  if(!email) return;
  const form = document.getElementById('newsletterForm');
  const btn = form.querySelector('button');
  if(btn){ btn.disabled = true; }
  fetch(NEWSLETTER_FORMSPREE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email })
  })
    .then(res => {
      if(!res.ok) throw new Error('Formspree submission failed: ' + res.status);
      form.style.display = 'none';
      document.getElementById('newsletterThanks').style.display = 'block';
      emailInput.value = '';
    })
    .catch(err => {
      console.error('Failed to save newsletter signup:', err);
      if(btn){ btn.disabled = false; }
      alert('Could not sign up right now — please try again.');
    });
}

/* ---------------- Why Us ---------------- */
function renderWhyUs(){
  const row = document.getElementById('whyRow');
  if(!row) return;
  row.innerHTML = WHY_US.map(w => `
    <div class="why-card">
      <div class="why-icon">${w.icon}</div>
      <h4>${w.title}</h4>
      <p>${w.text}</p>
    </div>
  `).join('');
}

/* ---------------- Shop tabs + grid ---------------- */
/* ---------------- Shop page category chips ---------------- */
function renderShopCategoryChips(){
  const wrap = document.getElementById('shopTabs');
  if(!wrap) return;
  wrap.innerHTML = CATEGORIES.map(c => `
    <div class="tab ${activeCategory===c.key?'active':''}" onclick="setShopCategory('${c.key}')">${c.label}</div>
  `).join('');
}
function setShopCategory(key){
  activeCategory = key;
  renderShopCategoryChips();
  renderShopGrid();
}
/* Some products were created before the `category` field existed
   and only have the old `kicker` text — this keeps them matching
   JESUS IS LORD 
   the right category tab until they're re-saved in admin. */
const KICKER_TO_CATEGORY = {
  'Necklace':'necklaces', 'Earrings':'earrings', 'Bracelet':'bracelets',
  'Ring':'rings', 'Anklet':'anklets', 'Watch':'mens-watches', 'Sunglasses':'sunglasses',
};
function productCategory(p){
  return p.category || KICKER_TO_CATEGORY[p.kicker] || null;
}
/* Always resolves to the CURRENT category label from CATEGORIES (which
   admin's "Save Category Names" updates live), instead of a product's
   stored `kicker` text — which was only ever a snapshot of the label
   at the moment the product was created/saved, so renames in admin
   never reached product cards, the product detail page, or wishlist
   rows that displayed p.kicker directly. */
function productKickerLabel(p){
  const key = productCategory(p);
  const cat = key && CATEGORIES.find(c => c.key === key);
  return (cat && cat.label) || p.kicker || '';
}
function renderShopGrid(){
  let list = activeCategory === 'all' ? PRODUCTS : PRODUCTS.filter(p => productCategory(p) === activeCategory);
  if(activeFilter){
    list = list.filter(p => inPriceRange(p.price, activeFilter));
  }
  if(activeSort === 'price-asc'){
    list = [...list].sort((a,b)=>a.price-b.price);
  } else if(activeSort === 'price-desc'){
    list = [...list].sort((a,b)=>b.price-a.price);
  } else if(activeSort === 'rating'){
    list = [...list].sort((a,b)=>b.rating-a.rating);
  } else {
    // Default ("Featured"): keep numbered product families in
    // sequence — Pear Earring 01, 02, 03... — instead of Firestore's
    // arbitrary document order. Earrings gets the same "Statement
    // Earring" families first rule used on the homepage.
    list = activeCategory === 'earrings' ? earringsHighlightSort(list) : naturalNameSort(list);
  }
  document.getElementById('shopGrid').innerHTML = list.length
    ? productListHtml(list)
    : `<div class="empty-state">No products in this category yet.</div>`;
}

/* ---------------- Wishlist ---------------- */
const GUEST_WISHLIST_KEY = 'viva_wishlist';
function loadGuestWishlist(){
  wishlist = new Set();
  try{
    const raw = localStorage.getItem(GUEST_WISHLIST_KEY);
    if(raw) wishlist = new Set(JSON.parse(raw));
  } catch(e){ /* corrupt/unavailable storage — start empty, harmless */ }
}
function persistWishlist(){
  const ids = Array.from(wishlist);
  if(auth.currentUser){
    db.collection('users').doc(auth.currentUser.uid).set({ wishlist: ids }, { merge: true })
      .catch(err => console.error('Failed to save wishlist:', err));
  } else {
    try{ localStorage.setItem(GUEST_WISHLIST_KEY, JSON.stringify(ids)); } catch(e){ /* storage unavailable — ignore */ }
  }
}
function toggleWishlist(id, btnEl){
  if(wishlist.has(id)){ wishlist.delete(id); } else { wishlist.add(id); }
  if(btnEl) btnEl.classList.toggle('filled');
  persistWishlist();
  renderWishlist();
}
function renderWishlist(){
  const ids = Array.from(wishlist).filter(id => productById(id));
  document.getElementById('wishlistCount').textContent = `${ids.length} item${ids.length===1?'':'s'}`;
  const badge = document.getElementById('wishlistBadgeNav');
  if(badge) badge.textContent = ids.length;
  const wrap = document.getElementById('wishlistRows');
  if(ids.length === 0){
    wrap.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--grey);font-size:13px;">Nothing saved yet — tap the heart on any item to add it here.</div>`;
    return;
  }
  wrap.innerHTML = ids.map(id => {
    const p = productById(id);
    return `
    <div class="list-row">
      <button class="heart-btn filled heart-top-right" onclick="toggleWishlist('${p.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.4 8 2 4.5 5.4 4A5.4 5.4 0 0112 7a5.4 5.4 0 016.6-3c3.4.5 5 4 3.4 7.7C19.5 16.4 12 21 12 21z"/></svg>
      </button>
      ${thumbHtml(coverImg(p), p.icon || ICONS.product, p.name)}
      <div class="info">
        <div class="kicker">${productKickerLabel(p)}</div>
        <h3>${p.name}<br><span style="font-weight:400;color:var(--grey);font-size:11.5px;">${p.sub}</span></h3>
        <div class="price">${nairaFmt(p.price)}</div>
        <div class="stock">${stockLabel(p.stock)}</div>
        <div class="row-actions">
          <button class="btn-black" onclick="addToCart('${p.id}')">Add to Cart</button>
          <div class="icon-square" onclick="toggleWishlist('${p.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12"/></svg>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ---------------- Cart ---------------- */
const GUEST_CART_KEY = 'viva_cart';
function loadGuestCart(){
  cart = [];
  try{
    const raw = localStorage.getItem(GUEST_CART_KEY);
    if(raw) cart = JSON.parse(raw);
  } catch(e){ /* corrupt/unavailable storage — start empty, harmless */ }
}
function persistCart(){
  if(auth.currentUser){
    db.collection('users').doc(auth.currentUser.uid).set({ cart }, { merge: true })
      .catch(err => console.error('Failed to save cart:', err));
  } else {
    try{ localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart)); } catch(e){ /* storage unavailable — ignore */ }
  }
}
/* Adds guest-cart quantities onto the saved cart rather than
   overwriting, so merging never silently drops or doubles items. */
function mergeCarts(savedCart, guestCart){
  const merged = savedCart.map(c => ({ ...c }));
  guestCart.forEach(gc => {
    const existing = merged.find(m => m.id === gc.id);
    if(existing){ existing.qty += gc.qty; } else { merged.push({ ...gc }); }
  });
  return merged;
}
function addToCart(id){
  const existing = cart.find(c => c.id === id);
  if(existing){ existing.qty += 1; } else { cart.push({ id, qty:1 }); }
  persistCart();
  renderCart();
  showScreen('cart');
}
function changeQty(id, delta){
  const item = cart.find(c => c.id === id);
  if(!item) return;
  item.qty += delta;
  if(item.qty <= 0){ cart = cart.filter(c => c.id !== id); }
  persistCart();
  renderCart();
}
function removeFromCart(id){
  cart = cart.filter(c => c.id !== id);
  persistCart();
  renderCart();
}
function cartTotals(){
  const subtotal = cart.reduce((sum, c) => { const p = productById(c.id); return p ? sum + p.price * c.qty : sum; }, 0);
  const delivery = subtotal === 0 ? 0 : (subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE);
  return { subtotal, delivery, total: subtotal + delivery };
}
function renderCart(){
  cart = cart.filter(c => productById(c.id));
  const count = cart.reduce((s,c)=>s+c.qty, 0);
  document.getElementById('cartTitle').textContent = `Your Cart (${cart.length})`;
  document.getElementById('cartBadgeTop').textContent = count;
  document.getElementById('cartBadgeNav').textContent = count;

  const { subtotal, delivery, total } = cartTotals();
  const remaining = Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal);
  const pct = Math.min(100, (subtotal / FREE_DELIVERY_THRESHOLD) * 100);
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = remaining > 0
    ? `Add ${nairaFmt(remaining)} more to enjoy free delivery!`
    : `You've unlocked free delivery!`;

  const rowsWrap = document.getElementById('cartRows');
  if(cart.length === 0){
    rowsWrap.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--grey);font-size:13px;">Your cart is empty.</div>`;
  } else {
    rowsWrap.innerHTML = cart.map(c => {
      const p = productById(c.id);
      const name = c.nameOverride || p.name;
      const sub = c.subOverride || p.sub;
      return `
      <div class="cart-row">
        ${thumbHtml(coverImg(p), p.icon || ICONS.product, p.name)}
        <div class="info">
          <h3>${name}</h3>
          <div class="sub">${sub}</div>
          <div class="price">${nairaFmt(p.price)}</div>
        </div>
        <div class="qty-stepper">
          <button onclick="changeQty('${p.id}', -1)">&minus;</button>
          <span class="qty-val">${c.qty}</span>
          <button onclick="changeQty('${p.id}', 1)">+</button>
        </div>
        <button class="trash-btn" onclick="removeFromCart('${p.id}')">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  // Subtotal/Total summary block removed from the cart screen per request —
  // the full breakdown (with the real per-state delivery fee) still shows
  // at checkout (updateCheckoutSummary). cartTotals() above is still used
  // by the free-delivery progress bar, so it stays.
  const cartSummaryEl = document.getElementById('cartSummary');
  if(cartSummaryEl){
    cartSummaryEl.innerHTML = `
      <div class="summary-row"><span>Subtotal</span><span>${nairaFmt(subtotal)}</span></div>
      <div class="summary-row total"><span>Total</span><span>${nairaFmt(subtotal)}</span></div>
    `;
  }
}

/* ---------------- Checkout ---------------- */
let orderCounter = 1;
let selectedDeliveryMethod = 'delivery'; // 'delivery' | 'pickup'

function populateStates(){
  const sel = document.getElementById('ckState');
  sel.innerHTML = `<option value="" disabled selected>Select State</option>` +
    NIGERIAN_STATES.map(s => `<option value="${s}">${s}</option>`).join('') +
    `<option value="__other__">Other (not listed)</option>`;
  sel.addEventListener('change', () => {
    document.getElementById('ckStateOther').style.display = sel.value === '__other__' ? 'block' : 'none';
    renderCheckoutSummary();
  });
}
/* Returns the location to use for delivery-fee lookup and order storage:
   the dropdown value, or the typed-in text if "Other" was picked. */
function getEffectiveState(){
  const sel = document.getElementById('ckState');
  if(sel.value === '__other__') return document.getElementById('ckStateOther').value.trim();
  return sel.value;
}
function selectDeliveryMethod(method){
  selectedDeliveryMethod = method;
  document.getElementById('deliveryHomeOption').classList.toggle('selected', method === 'delivery');
  document.getElementById('deliveryPickupOption').classList.toggle('selected', method === 'pickup');
  document.getElementById('deliveryAddressFields').style.display = method === 'pickup' ? 'none' : '';
  document.getElementById('pickupNote').style.display = method === 'pickup' ? 'block' : 'none';
  renderCheckoutSummary();
}
function computeDeliveryFee(subtotal){
  if(selectedDeliveryMethod === 'pickup') return 0;
  return getDeliveryFee(getEffectiveState(), subtotal);
}
/* Autofills the checkout form from the customer's default saved
   address (or their most recent one if none is marked default) —
   previously the form was always blank even when addresses existed. */
function prefillCheckoutFromSavedAddress(){
  const note = document.getElementById('checkoutSavedAddrNote');
  if(auth.currentUser && auth.currentUser.email){
    document.getElementById('ckEmail').value = auth.currentUser.email;
  }
  if(!ADDRESSES.length){
    note.style.display = 'none';
    return;
  }
  const addr = ADDRESSES.find(a => a.isDefault) || ADDRESSES[0];
  document.getElementById('ckName').value = addr.name || '';
  document.getElementById('ckPhone').value = addr.phone || '';
  document.getElementById('ckAddress').value = addr.address || '';
  const stateSel = document.getElementById('ckState');
  if(addr.state && NIGERIAN_STATES.includes(addr.state)) stateSel.value = addr.state;

  note.style.display = 'block';
  note.innerHTML = `Filled in from your saved "${addr.label || 'address'}"${
    ADDRESSES.length > 1 ? ' — <span onclick="showScreen(\'addresses\')" style="text-decoration:underline;cursor:pointer;">use a different one</span>' : ''
  }.`;
}
function goToCheckout(){
  if(cart.length === 0){
    alert('Your cart is empty — add something first.');
    return;
  }
  selectDeliveryMethod('delivery');
  document.getElementById('ckStateOther').style.display = 'none';
  document.getElementById('ckStateOther').value = '';
  prefillCheckoutFromSavedAddress();
  renderCheckoutSummary();
  goToCheckoutStep1();
  showScreen('checkout');
}
/* ---------------- Checkout: two-step flow (Delivery Details -> Payment Method) ---------------- */
function checkoutBack(){
  const step2 = document.getElementById('checkoutStep2');
  if(step2 && step2.style.display !== 'none'){
    goToCheckoutStep1();
  } else {
    showScreen('cart');
  }
}
function goToCheckoutStep2(){
  const name = document.getElementById('ckName').value.trim();
  const phone = document.getElementById('ckPhone').value.trim();
  const email = document.getElementById('ckEmail').value.trim();
  if(!name || !phone){
    alert('Please fill in your name and phone number.');
    return;
  }
  if(!email || !/^\S+@\S+\.\S+$/.test(email)){
    alert('Please enter a valid email address — it\'s needed for your order confirmation and receipt.');
    return;
  }
  if(selectedDeliveryMethod !== 'pickup'){
    const state = getEffectiveState();
    const address = document.getElementById('ckAddress').value.trim();
    if(!state){
      alert('Please select your delivery state, or choose "Other" and type it in.');
      return;
    }
    if(!address){
      alert('Please fill in your delivery address.');
      return;
    }
  }
  document.getElementById('checkoutStep1').style.display = 'none';
  document.getElementById('checkoutStep1Continue').style.display = 'none';
  document.getElementById('checkoutStep2').style.display = 'block';
  document.getElementById('screen-checkout').scrollTop = 0;
}
function goToCheckoutStep1(){
  document.getElementById('checkoutStep2').style.display = 'none';
  document.getElementById('checkoutStep1').style.display = 'block';
  document.getElementById('checkoutStep1Continue').style.display = 'block';
  document.getElementById('screen-checkout').scrollTop = 0;
}
function renderCheckoutSummary(){
  const subtotal = cart.reduce((sum, c) => (productById(c.id) ? sum + productById(c.id).price * c.qty : sum), 0);
  const delivery = computeDeliveryFee(subtotal);
  const total = subtotal + delivery;
  const deliveryLabel = selectedDeliveryMethod === 'pickup' ? 'Pickup' : `Delivery to ${getEffectiveState() || 'selected state'}`;
  document.getElementById('checkoutSummary').innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>${nairaFmt(subtotal)}</span></div>
    <div class="summary-row"><span>${deliveryLabel}</span><span>${delivery === 0 ? 'Free' : nairaFmt(delivery)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${nairaFmt(total)}</span></div>
  `;
}
/* ---------------- Payment method selection (Bank Transfer / Paystack) ----------------
   Paystack keys are never hardcoded here. They live in Netlify environment
   variables (Site settings → Environment variables):
     PAYSTACK_PUBLIC_KEY — safe to expose to the browser; fetched at runtime
       below from the paystack-config Netlify Function.
     PAYSTACK_SECRET_KEY — never sent to the browser; used only inside
       netlify/functions/paystack-verify.js to confirm payment server-side.
   See netlify/functions/paystack-config.js and netlify/functions/paystack-verify.js. */
let selectedPaymentMethod = 'paystack'; // Paystack is now the only payment method — bank transfer removed
let paystackPublicKey = null;

async function getPaystackPublicKey(){
  if(paystackPublicKey) return paystackPublicKey;
  const res = await fetch('/.netlify/functions/paystack-config');
  if(!res.ok) throw new Error('Paystack is not configured yet.');
  const data = await res.json();
  if(!data.publicKey) throw new Error('Paystack is not configured yet.');
  paystackPublicKey = data.publicKey;
  return paystackPublicKey;
}
function placeOrder(){
  const name = document.getElementById('ckName').value.trim();
  const phone = document.getElementById('ckPhone').value.trim();
  const email = document.getElementById('ckEmail').value.trim();
  if(!name || !phone){
    alert('Please fill in your name and phone number.');
    return;
  }
  if(!email || !/^\S+@\S+\.\S+$/.test(email)){
    alert('Please enter a valid email address — it\'s needed for your order confirmation and receipt.');
    return;
  }

  let state = '';
  let address = '';
  if(selectedDeliveryMethod === 'pickup'){
    state = 'Pickup';
    address = 'Customer pickup — no delivery address needed';
  } else {
    state = getEffectiveState();
    address = document.getElementById('ckAddress').value.trim();
    if(!state){
      alert('Please select your delivery state, or choose "Other" and type it in.');
      return;
    }
    if(!address){
      alert('Please fill in your delivery address.');
      return;
    }
  }

  const subtotal = cart.reduce((sum, c) => (productById(c.id) ? sum + productById(c.id).price * c.qty : sum), 0);
  const delivery = computeDeliveryFee(subtotal);
  const total = subtotal + delivery;
  const items = cart.map(c => {
    const p = productById(c.id);
    return { id: c.id, name: c.nameOverride || p.name, qty: c.qty, price: p.price };
  });
  const baseOrder = {
    uid: auth.currentUser ? auth.currentUser.uid : null,
    deliveryMethod: selectedDeliveryMethod,
    customer: { name, phone, state, address, email },
    items, subtotal, delivery, total,
    status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  payWithPaystack(baseOrder, total);
}
function saveOrder(order){
  const counterRef = db.collection('counters').doc('orders');
  const newOrderRef = db.collection('orders').doc();
  db.runTransaction(t => {
    return t.get(counterRef).then(counterDoc => {
      const nextNum = (counterDoc.exists ? (counterDoc.data().count || 0) : 0) + 1;
      const orderNumber = 'VL' + String(nextNum).padStart(3, '0');
      t.set(counterRef, { count: nextNum }, { merge: true });
      t.set(newOrderRef, { ...order, orderNumber });
      return orderNumber;
    });
  })
    .then(orderNumber => {
      if(order.status === 'processing'){
        // Paystack orders arrive already verified as paid — that verification
        // *is* the approval, so stock comes off right away (no separate
        // admin "Accept" step exists for these).
        deductStockForOrder(newOrderRef.id, order.items);
      }
      document.getElementById('orderIdText').textContent = `Order #${orderNumber}`;
      const deliveryLabel = order.deliveryMethod === 'pickup' ? 'Pickup' : `Delivery to ${order.customer.state}`;
      document.getElementById('orderConfirmSummary').innerHTML = `
        <div class="summary-row"><span>Subtotal</span><span>${nairaFmt(order.subtotal)}</span></div>
        <div class="summary-row"><span>${deliveryLabel}</span><span>${order.delivery === 0 ? 'Free' : nairaFmt(order.delivery)}</span></div>
        <div class="summary-row total"><span>Total</span><span>${nairaFmt(order.total)}</span></div>
      `;
      cart = [];
      persistCart();
      renderCart();
      showScreen('order-confirm');
    })
    .catch(err => {
      alert('Could not place your order: ' + err.message);
    });
}
async function payWithPaystack(baseOrder, total){
  const btn = document.querySelector('.checkout-wrap .btn-black');
  try{
    if(btn){ btn.disabled = true; btn.style.opacity = '0.6'; }
    const key = await getPaystackPublicKey();
    const reference = 'VL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const handler = PaystackPop.setup({
      key,
      email: baseOrder.customer.email,
      amount: Math.round(total * 100), // Paystack expects kobo
      currency: 'NGN',
      ref: reference,
      metadata: { name: baseOrder.customer.name, phone: baseOrder.customer.phone },
      callback: function(response){
        verifyAndSavePaystackOrder(baseOrder, response.reference, btn);
      },
      onClose: function(){
        if(btn){ btn.disabled = false; btn.style.opacity = ''; }
      }
    });
    handler.openIframe();
  } catch(err){
    if(btn){ btn.disabled = false; btn.style.opacity = ''; }
    alert('Could not start Paystack checkout: ' + err.message);
  }
}
function verifyAndSavePaystackOrder(baseOrder, reference, btn){
  fetch('/.netlify/functions/paystack-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference })
  })
    .then(res => res.json())
    .then(result => {
      if(btn){ btn.disabled = false; btn.style.opacity = ''; }
      if(!result.verified){
        alert('We could not verify your Paystack payment. If you were charged, please contact us with reference ' + reference + '.');
        return;
      }
      saveOrder({
        ...baseOrder,
        status: 'processing', // Paystack already verified payment server-side, so skip the manual "pending → accept" step admin does for bank transfer
        paymentMethod: 'Paystack',
        paystackReference: result.reference
      });
    })
    .catch(() => {
      if(btn){ btn.disabled = false; btn.style.opacity = ''; }
      alert('We could not confirm your Paystack payment. If you were charged, please contact us with reference ' + reference + '.');
    });
}
function finishOrder(){
  document.getElementById('ckName').value = '';
  document.getElementById('ckPhone').value = '';
  document.getElementById('ckEmail').value = '';
  document.getElementById('ckAddress').value = '';
  document.getElementById('ckStateOther').value = '';
  document.getElementById('ckStateOther').style.display = 'none';
  selectDeliveryMethod('delivery');
  showScreen('home');
}

/* ---------------- Auth: login / signup / logout ---------------- */
let isLoggedIn = false;
let authMode = 'login'; // 'login' | 'signup'
let addressesUnsub = null;
let postLoginRedirect = null; // e.g. 'checkout' — where to send the user right after they log in

function goAccountOrLogin(){
  showScreen(isLoggedIn ? 'account' : 'login');
}

function switchAuthMode(mode){
  authMode = mode;
  document.getElementById('loginNameRow').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('authTitle').textContent = mode === 'signup' ? 'Create account' : 'Welcome back';
  document.getElementById('authSubmitBtn').firstChild.textContent = mode === 'signup' ? 'Sign Up ' : 'Log In ';
  document.getElementById('authToggleHint').innerHTML = mode === 'signup'
    ? `Already have an account? <span onclick="switchAuthMode('login')">Log In</span>`
    : `Don't have an account? <span onclick="switchAuthMode('signup')">Sign Up</span>`;
  document.getElementById('loginForgotRow').style.display = mode === 'signup' ? 'none' : 'block';
}

function forgotPassword(){
  const emailInput = document.getElementById('loginEmail');
  let email = emailInput.value.trim();
  if(!email){
    email = (prompt('Enter your account email to receive a reset link:') || '').trim();
    if(!email) return;
  }
  const link = document.getElementById('loginForgotRow');
  const originalText = link.textContent;
  link.textContent = 'Sending...';
  auth.sendPasswordResetEmail(email)
    .then(() => {
      alert(`If an account exists for ${email}, a password reset link has been sent.`);
      link.textContent = originalText;
    })
    .catch(err => {
      link.textContent = originalText;
      if(err.code === 'auth/invalid-email'){
        alert('Please enter a valid email address.');
      } else if(err.code === 'auth/user-not-found'){
        // Don't reveal whether the email exists, to avoid account enumeration.
        alert(`If an account exists for ${email}, a password reset link has been sent.`);
      } else {
        alert('Could not send reset email: ' + err.message);
      }
    });
}

function authSubmit(){
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value.trim();
  const name = document.getElementById('loginName').value.trim();
  if(!email || !pass){
    alert('Please enter your email and password.');
    return;
  }
  if(authMode === 'signup' && !name){
    alert('Please enter your full name.');
    return;
  }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;

  const done = () => {
    btn.disabled = false;
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginName').value = '';
  };

  const goAfterLogin = () => {
    if(postLoginRedirect === 'checkout'){
      postLoginRedirect = null;
      goToCheckout();
    } else {
      showScreen('account');
    }
  };

  if(authMode === 'signup'){
    auth.createUserWithEmailAndPassword(email, pass)
      .then(cred => cred.user.updateProfile({ displayName: name }))
      .then(() => { done(); goAfterLogin(); })
      .catch(err => { done(); alert(err.message); });
  } else {
    auth.signInWithEmailAndPassword(email, pass)
      .then(() => { done(); goAfterLogin(); })
      .catch(err => { done(); alert(err.message); });
  }
}

function logOut(){
  auth.signOut().then(() => showScreen('login'));
}

function renderAccountProfile(user){
  const initials = (user.displayName || user.email || '?')
    .split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('accountInitials').textContent = initials;
  document.getElementById('accountName').textContent = user.displayName || 'Your Account';
  document.getElementById('accountEmail').textContent = user.email || '';
}

/* Guarded: this is a top-level statement that runs the instant the
   script loads, before anything else below it. If `auth` isn't ready
   yet (Firebase still loading on a slow connection), an unguarded
   call here would throw and silently cancel every line after it in
   this file — including the whole init block at the bottom. */
if(typeof auth !== 'undefined'){
  auth.onAuthStateChanged(user => {
    isLoggedIn = !!user;

    // Track whether `cart` currently holds a genuine guest cart (no
    // account yet involved) vs. a previous account's cart, so a
    // switch between two different accounts doesn't merge A's items
    // into B — only a true pre-login guest cart gets merged in.
    const previousUid = cartOwnerUid;
    const newUid = user ? user.uid : null;
    const cameFromGuest = previousUid === null || previousUid === undefined;
    cartOwnerUid = newUid;

    if(addressesUnsub){ addressesUnsub(); addressesUnsub = null; }
    if(ordersUnsub){ ordersUnsub(); ordersUnsub = null; }
    if(adminOrdersUnsub){ adminOrdersUnsub(); adminOrdersUnsub = null; }
    if(user){
      renderAccountProfile(user);
      addressesUnsub = db.collection('users').doc(user.uid).collection('addresses')
        .onSnapshot(snap => {
          ADDRESSES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          renderAddresses();
        }, err => console.error('Failed to load addresses:', err));
      ordersUnsub = db.collection('orders').where('uid', '==', user.uid)
        .onSnapshot(snap => {
          ORDERS = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
          renderOrderCounts();
          if(document.getElementById('screen-order-list')?.classList.contains('active')) renderOrderList();
        }, err => console.error('Failed to load orders:', err));
      toggleAdminAccess(ADMIN_EMAILS.includes(user.email));

      // Merge whatever was saved as a guest (localStorage) into this
      // account's Firestore wishlist, so logging in never loses items.
      const guestIds = Array.from(wishlist);
      db.collection('users').doc(user.uid).get()
        .then(doc => {
          const savedIds = (doc.exists && doc.data().wishlist) || [];
          wishlist = new Set([...savedIds, ...guestIds]);
          renderWishlist();
          if(guestIds.length){
            persistWishlist();
            try{ localStorage.removeItem(GUEST_WISHLIST_KEY); } catch(e){ /* ignore */ }
          }
        })
        .catch(err => console.error('Failed to load wishlist:', err));

      // Same idea for cart: pull this account's saved Firestore cart
      // (so it follows them across devices/browsers), and only fold
      // in the current in-memory cart if it was a genuine guest cart
      // — not another account's leftovers.
      const guestCart = cameFromGuest ? cart.map(c => ({ ...c })) : [];
      db.collection('users').doc(user.uid).get()
        .then(doc => {
          const savedCart = (doc.exists && doc.data().cart) || [];
          cart = mergeCarts(savedCart, guestCart);
          renderCart();
          if(guestCart.length){
            persistCart();
            try{ localStorage.removeItem(GUEST_CART_KEY); } catch(e){ /* ignore */ }
          }
        })
        .catch(err => console.error('Failed to load cart:', err));
    } else {
      ADDRESSES = [];
      ORDERS = [];
      renderAddresses();
      renderOrderCounts();
      toggleAdminAccess(false);
      loadGuestWishlist();
      renderWishlist();
      loadGuestCart();
      renderCart();
    }
  });
} else {
  console.error('Firebase Auth not ready — check your connection and reload.');
}

/* ---------------- Addresses (Firestore-backed) ---------------- */
function renderAddresses(){
  const wrap = document.getElementById('addressRows');
  if(!wrap) return;
  wrap.innerHTML = ADDRESSES.length ? ADDRESSES.map(a => `
    <div class="address-card">
      <div class="address-card-head">
        <span class="address-label">${a.label}</span>
        ${a.isDefault ? '<span class="address-default-badge">Default</span>' : ''}
      </div>
      <p class="address-text">${a.name} · ${a.phone}<br>${a.address}, ${a.state}</p>
      <div class="address-actions">
        ${a.isDefault ? '' : `<span class="set-default" onclick="setDefaultAddress('${a.id}')">Set Default</span>`}
        <span class="remove" onclick="removeAddress('${a.id}')">Remove</span>
      </div>
    </div>
  `).join('') : `<div class="empty-state">No saved addresses yet.</div>`;
}
function setDefaultAddress(id){
  const uid = auth.currentUser?.uid;
  if(!uid) return;
  const batch = db.batch();
  const col = db.collection('users').doc(uid).collection('addresses');
  ADDRESSES.forEach(a => batch.update(col.doc(a.id), { isDefault: a.id === id }));
  batch.commit().catch(err => alert('Could not update default address: ' + err.message));
}
function removeAddress(id){
  const uid = auth.currentUser?.uid;
  if(!uid) return;
  const wasDefault = ADDRESSES.find(a => a.id === id)?.isDefault;
  db.collection('users').doc(uid).collection('addresses').doc(id).delete()
    .then(() => {
      if(wasDefault){
        const next = ADDRESSES.find(a => a.id !== id);
        if(next) setDefaultAddress(next.id);
      }
    })
    .catch(err => alert('Could not remove address: ' + err.message));
}

/* ---------------- Orders (Firestore-backed) ----------------
   Status flow: pending -> (admin accepts) processing -> shipped -> delivered
   or: pending -> (admin rejects) rejected
   Every step below is a real Firestore write from the admin panel;
   the customer's Account screen updates live via the onSnapshot
   listener set up in onAuthStateChanged. */
const ORDER_STATUS_LABELS = {
  pending: 'Pending', processing: 'Processing', shipped: 'Shipped',
  delivered: 'Delivered', rejected: 'Rejected'
};
function renderOrderCounts(){
  const counts = { pending:0, processing:0, shipped:0, delivered:0 };
  ORDERS.forEach(o => { if(counts[o.status] !== undefined) counts[o.status]++; });
  const setBadge = (id, n) => {
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = n;
    el.style.display = n > 0 ? '' : 'none';
  };
  setBadge('badge-pending', counts.pending);
  setBadge('badge-processing', counts.processing);
}
function openOrderList(status){
  orderListStatus = status;
  document.getElementById('orderListTitle').textContent = ORDER_STATUS_LABELS[status] || 'Orders';
  renderOrderList();
  showScreen('order-list');
}
function openOrderHistory(){
  orderListStatus = 'all';
  document.getElementById('orderListTitle').textContent = 'Order History';
  renderOrderList();
  showScreen('order-list');
}
function orderItemsSummary(order){
  return order.items.map(i => `${i.name} ×${i.qty}`).join(', ');
}
function renderOrderList(){
  const wrap = document.getElementById('orderListBody');
  if(!wrap) return;
  const list = orderListStatus === 'all' ? ORDERS : ORDERS.filter(o => o.status === orderListStatus);
  wrap.innerHTML = list.length ? list.map(o => `
    <div class="address-card">
      <div class="address-card-head">
        <span class="address-label">#${o.id.slice(-6).toUpperCase()}</span>
        <span class="address-default-badge">${ORDER_STATUS_LABELS[o.status] || o.status}</span>
      </div>
      <p class="address-text">${orderItemsSummary(o)}<br>${nairaFmt(o.total)} · ${o.customer?.state || ''}</p>
    </div>
  `).join('') : `<div class="empty-state">No orders here yet.</div>`;
}

/* ---------------- Admin panel (orders only) ----------------
   Gated by ADMIN_EMAILS near the top of this file — update that
   list to the real admin login email(s) before going live. */
function toggleAdminAccess(isAdmin){
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
  if(isAdmin && !adminOrdersUnsub){
    adminOrdersUnsub = db.collection('orders').onSnapshot(snap => {
      ADMIN_ORDERS = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
      renderAdminOrders();
    }, err => console.error('Failed to load admin orders:', err));
  } else if(!isAdmin && adminOrdersUnsub){
    adminOrdersUnsub(); adminOrdersUnsub = null;
  }
}
let ADMIN_ORDERS = [];
function renderAdminOrders(){
  const wrap = document.getElementById('adminOrdersBody');
  if(!wrap) return;
  wrap.innerHTML = ADMIN_ORDERS.length ? ADMIN_ORDERS.map(o => {
    let actions = '';
    if(o.status === 'pending'){
      actions = `<button class="btn-black" style="padding:8px 14px;font-size:11px;" onclick="adminSetOrderStatus('${o.id}','processing')">Accept</button>
                 <button class="btn-hero-secondary" style="padding:8px 14px;font-size:11px;" onclick="adminSetOrderStatus('${o.id}','rejected')">Reject</button>`;
    } else if(o.status === 'processing'){
      actions = `<button class="btn-black" style="padding:8px 14px;font-size:11px;" onclick="adminSetOrderStatus('${o.id}','shipped')">Mark Shipped</button>`;
    } else if(o.status === 'shipped'){
      actions = `<button class="btn-black" style="padding:8px 14px;font-size:11px;" onclick="adminSetOrderStatus('${o.id}','delivered')">Mark Delivered</button>`;
    }
    return `
    <div class="address-card">
      <div class="address-card-head">
        <span class="address-label">#${o.id.slice(-6).toUpperCase()} — ${ORDER_STATUS_LABELS[o.status] || o.status}</span>
      </div>
      <p class="address-text">${o.customer?.name || ''} · ${o.customer?.phone || ''}<br>${orderItemsSummary(o)}<br>${nairaFmt(o.total)} · ${o.customer?.state || ''}</p>
      <div class="address-actions" style="gap:8px;">${actions}</div>
    </div>`;
  }).join('') : `<div class="empty-state">No orders yet.</div>`;
}
function adminSetOrderStatus(orderId, status){
  db.collection('orders').doc(orderId).update({ status })
    .catch(err => alert('Could not update order: ' + err.message));
}

function openAddAddressSheet(){
  document.getElementById('sheetContent').innerHTML = `
    <h3 style="font-size:15px;font-weight:600;margin-bottom:14px;">Add New Address</h3>
    <input class="form-input" id="newAddrLabel" type="text" placeholder="Label (e.g. Home, Office)">
    <input class="form-input" id="newAddrName" type="text" placeholder="Full Name">
    <input class="form-input" id="newAddrPhone" type="tel" placeholder="Phone Number">
    <select class="form-input" id="newAddrState"></select>
    <input class="form-input" id="newAddrAddress" type="text" placeholder="Delivery Address">
    <button class="btn-black sheet-apply" id="saveAddressBtn" onclick="submitNewAddress()" style="width:100%;justify-content:center;">Save Address</button>
  `;
  const sel = document.getElementById('newAddrState');
  sel.innerHTML = `<option value="">Select State</option>` + NIGERIAN_STATES.map(s => `<option value="${s}">${s}</option>`).join('');
  openSheet();
}
function submitNewAddress(){
  const uid = auth.currentUser?.uid;
  if(!uid){ alert('Please log in first.'); return; }
  const label = document.getElementById('newAddrLabel').value.trim();
  const name = document.getElementById('newAddrName').value.trim();
  const phone = document.getElementById('newAddrPhone').value.trim();
  const state = document.getElementById('newAddrState').value;
  const address = document.getElementById('newAddrAddress').value.trim();
  if(!label || !name || !phone || !state || !address){
    alert('Please fill in every field.');
    return;
  }
  const btn = document.getElementById('saveAddressBtn');
  btn.disabled = true;
  db.collection('users').doc(uid).collection('addresses').add({
    label, name, phone, state, address,
    isDefault: ADDRESSES.length === 0
  })
    .then(() => closeSheet())
    .catch(err => alert('Could not save address: ' + err.message))
    .finally(() => { btn.disabled = false; });
}

/* ---------------- Help & Support ---------------- */
let openFaqId = null;
function renderFaqs(){
  const wrap = document.getElementById('faqList');
  if(!wrap) return;
  wrap.innerHTML = HELP_FAQS.map((f, i) => `
    <div class="faq-item ${openFaqId===i?'open':''}">
      <div class="faq-q" onclick="toggleFaq(${i})">
        <span>${f.q}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="faq-a"><p>${f.a}</p></div>
    </div>
  `).join('');
}
function toggleFaq(i){
  openFaqId = (openFaqId === i) ? null : i;
  renderFaqs();
}
function contactSupportWhatsApp(){
  const message = encodeURIComponent(WHATSAPP_SUPPORT_MSG);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
}
/* Same idea as contactSupportWhatsApp() above, but for the floating
   button that's visible on every screen — kept as its own function
   in case the two ever need different default messages. */
function openWhatsAppFloat(){
  const message = encodeURIComponent(WHATSAPP_FLOAT_MSG);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
}

/* ---------------- Reviews (home page) ---------------- */
/* ---------------- Settings ---------------- */
/* ---------------- Settings ---------------- */
/* Persisted locally per-device via localStorage. Push/Order-update/
   Promo toggles are UI preferences only — there's no push notification
   backend wired up, so this stores intent, not delivery. */
function toggleSetting(key, el){
  const isOn = el.classList.toggle('on');
  localStorage.setItem('setting_' + key, isOn ? '1' : '0');
}
function loadSettingsToggles(){
  ['push','orders','promos'].forEach(key => {
    const el = document.getElementById('toggle-' + key);
    if(!el) return;
    const saved = localStorage.getItem('setting_' + key);
    if(saved === null) return; // keep the HTML default (push/orders on, promos off)
    el.classList.toggle('on', saved === '1');
  });
}

function changePassword(){
  const user = auth.currentUser;
  if(!user || !user.email){
    alert('Please log in first.');
    return;
  }
  if(!confirm(`Send a password reset link to ${user.email}?`)) return;
  auth.sendPasswordResetEmail(user.email)
    .then(() => alert('Password reset email sent — check your inbox.'))
    .catch(err => alert('Could not send reset email: ' + err.message));
}

function deleteAccount(){
  const user = auth.currentUser;
  if(!user){
    alert('Please log in first.');
    return;
  }
  if(!confirm('This will permanently delete your account. This cannot be undone. Continue?')) return;
  user.delete()
    .then(() => {
      alert('Your account has been deleted.');
      showScreen('home');
    })
    .catch(err => {
      if(err.code === 'auth/requires-recent-login'){
        alert('For security, please log out and log back in, then try deleting your account again.');
      } else {
        alert('Could not delete account: ' + err.message);
      }
    });
}

function editProfileName(){
  const user = auth.currentUser;
  if(!user){
    alert('Please log in first.');
    return;
  }
  const name = prompt('Update your name:', user.displayName || '');
  if(name === null || !name.trim()) return;
  user.updateProfile({ displayName: name.trim() })
    .then(() => renderAccountProfile(user))
    .catch(err => alert('Could not update name: ' + err.message));
}

/* ---------------- More drawer (bottom nav "More") ---------------- */
function openMoreMenu(){
  document.getElementById('moreDrawer').classList.add('open');
  document.getElementById('moreOverlay').classList.add('open');
}
function closeMoreMenu(){
  document.getElementById('moreDrawer').classList.remove('open');
  document.getElementById('moreOverlay').classList.remove('open');
}

/* ---------------- Init ---------------- */
/* Each step runs in isolation: if one throws (e.g. Firebase hasn't
   finished loading yet on a slow connection), it's logged and
   skipped instead of silently cancelling every step after it —
   that's how a single failed Firestore call used to take down
   category chips, products, wishlist, cart, everything downstream. */
function safeInit(label, fn){
  try{ fn(); }
  catch(err){ console.error(`Init step failed (${label}):`, err); }
}

/* Purely local, no Firestore needed — these must always work. */
safeInit('category tiles', renderCategoryTiles);
safeInit('collection tabs', renderCollectionTabs);
safeInit('shop category chips', renderShopCategoryChips);
safeInit('why us', renderWhyUs);
safeInit('wishlist', renderWishlist);
safeInit('cart', renderCart);
safeInit('states dropdown', populateStates);
safeInit('settings toggles', loadSettingsToggles);
safeInit('faqs', renderFaqs);
safeInit('show home', () => showScreen('home'));

/* renderCollections() stays off the homepage until the client
   approves that section's copy — see COLLECTIONS in data.js. */

/* Firestore-dependent — run after, and isolated from each other too. */
safeInit('watch products', watchProducts);
safeInit('watch site settings', watchSiteSettings);
safeInit('watch reviews', watchReviews);
safeInit('addresses', renderAddresses);
