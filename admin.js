/* ===========================================================
   VIVA PERFUMERY — Admin panel logic
   =========================================================== */

/* TODO: fill these in from your Cloudinary dashboard.
   Cloud Name: shown top-left of the Cloudinary console.
   Upload Preset: Settings > Upload > Upload presets — create one
   with Signing Mode set to "Unsigned" so the browser can upload
   directly without exposing your API secret. */
const CLOUDINARY_CLOUD_NAME = 'brzahvf1';
const CLOUDINARY_UPLOAD_PRESET = 'vivaperf';

let adminProducts = [];
let editingProductId = null;
let selectedImageFiles = [null, null, null];
let existingImageUrls = [null, null, null];
let productsUnsub = null;
let productCategoryFilter = 'all';

/* The client's official 10 categories — must stay in sync with
   CATEGORIES in data.js (the customer site). Category is REQUIRED
   on every product; it's the only field used for shop filtering. */
const ADMIN_CATEGORIES = [
  { key:'necklaces',    label:'Necklaces' },
  { key:'earrings',     label:'Earrings' },
  { key:'bracelets',    label:'Bracelets' },
  { key:'rings',        label:'Rings' },
  { key:'anklets',      label:'Anklets' },
  { key:'jewelry-sets', label:'Jewelry Sets' },
  { key:'stacks',       label:'Stacks' },
  { key:'mens-watches', label:"Men's Watches" },
  { key:'sunglasses',   label:'Sunglasses' },
  { key:'wristwatches', label:'Wristwatches' },
];
function categoryLabel(key){
  return ADMIN_CATEGORIES.find(c => c.key === key)?.label || key || '—';
}
/* Mirrors script.js's fallback: some products were created before the
   `category` field existed and only have the old `kicker` text. */
const KICKER_TO_CATEGORY = {
  'Necklace':'necklaces', 'Earrings':'earrings', 'Bracelet':'bracelets',
  'Ring':'rings', 'Anklet':'anklets', 'Watch':'mens-watches', 'Sunglasses':'sunglasses',
};
function productCategory(p){
  return p.category || KICKER_TO_CATEGORY[p.kicker] || null;
}

/* ---------------- Auth gate ---------------- */
/* Guarded the same way as the customer site's script.js: this is a
   top-level statement that runs immediately on load. If Firebase
   hasn't finished loading yet (slow connection), an unguarded call
   here would throw and silently stop the rest of this file from
   running — leaving a blank admin page with no error shown. */
if(typeof auth !== 'undefined'){
  let adminAppInitialized = false;
  auth.onAuthStateChanged(user => {
    if(!user){
      adminAppInitialized = false;
      showAdminLogin();
      return;
    }
    // Verify this user is on the admins allowlist before showing anything.
    db.collection('admins').doc(user.uid).get()
      .then(doc => {
        if(doc.exists){
          // onAuthStateChanged can re-fire for an already-signed-in user
          // (token refresh, tab regaining focus/visibility on mobile,
          // reconnecting after a network blip). Re-running showAdminApp
          // each time re-fetches settings from Firestore and wipes out
          // any in-progress edits, or races a save that just went out.
          // Only run the full setup once per real sign-in.
          if(!adminAppInitialized){
            adminAppInitialized = true;
            showAdminApp(user);
          } else {
            document.getElementById('adminEmailLabel').textContent = user.email;
          }
        } else {
          showLoginError('This account is not authorized for the admin panel.');
          auth.signOut();
        }
      })
      .catch(() => {
        showLoginError('Could not verify admin access. Check your connection.');
        auth.signOut();
      });
  });
} else {
  console.error('Firebase Auth not ready — check your connection and reload.');
  document.addEventListener('DOMContentLoaded', () => {
    const err = document.getElementById('adminLoginError');
    if(err){ err.textContent = "Couldn't connect — check your connection and reload the page."; err.classList.add('show'); }
  });
}

function adminLogin(){
  const email = document.getElementById('adminEmail').value.trim();
  const pass = document.getElementById('adminPassword').value.trim();
  if(!email || !pass){
    showLoginError('Enter your email and password.');
    return;
  }
  const btn = document.getElementById('adminLoginBtn');
  btn.disabled = true;
  hideLoginError();
  auth.signInWithEmailAndPassword(email, pass)
    .catch(err => showLoginError(err.message))
    .finally(() => { btn.disabled = false; });
}
function adminLogout(){
  auth.signOut();
}
function showLoginError(msg){
  const el = document.getElementById('adminLoginError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideLoginError(){
  document.getElementById('adminLoginError').classList.remove('show');
}
function showAdminLogin(){
  document.getElementById('adminLogin').style.display = 'block';
  document.getElementById('adminApp').style.display = 'none';
  if(productsUnsub){ productsUnsub(); productsUnsub = null; }
  if(ordersUnsub){ ordersUnsub(); ordersUnsub = null; }
}
function showAdminApp(user){
  document.getElementById('adminLogin').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
  document.getElementById('adminEmailLabel').textContent = user.email;
  document.getElementById('adminPassword').value = '';
  hideLoginError();
  watchAdminProducts();
  watchAdminOrders();
  loadSettingsIntoForm();
  renderDashboard();
}

/* ---------------- Tabs ---------------- */
function switchAdminTab(tab){
  ['dashboard', 'products', 'orders', 'sitetext', 'pages', 'settings'].forEach(t => {
    document.getElementById('tabPanel-' + t).style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if(tab === 'dashboard') renderDashboard();
  closeAdminSidebar();
}

/* ---------------- Mobile sidebar drawer ---------------- */
function toggleAdminSidebar(){
  document.getElementById('adminSidebar').classList.toggle('open');
  document.getElementById('adminSidebarOverlay').classList.toggle('open');
}
function closeAdminSidebar(){
  document.getElementById('adminSidebar').classList.remove('open');
  document.getElementById('adminSidebarOverlay').classList.remove('open');
}

/* ---------------- Dashboard ---------------- */
// Most recent Monday 00:00:00 local time — "this week" runs Mon → now.
function getWeekStart(){
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - diffToMonday);
  return monday;
}
function renderDashboard(){
  const revenueEl = document.getElementById('dashRevenue');
  if(!revenueEl) return; // dashboard not in DOM yet

  // Revenue this week — confirmed orders (not rejected) created since Monday.
  const weekStart = getWeekStart().getTime() / 1000;
  const thisWeekOrders = adminOrders.filter(o =>
    (o.createdAt?.seconds || 0) >= weekStart && o.status !== 'rejected'
  );
  const revenue = thisWeekOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  revenueEl.textContent = nairaFmt(revenue);
  document.getElementById('dashRevenueSub').textContent =
    `${thisWeekOrders.length} order${thisWeekOrders.length === 1 ? '' : 's'} since Monday`;

  // Order counts by status
  const counts = { pending: 0, processing: 0, shipped: 0, delivered: 0, rejected: 0 };
  adminOrders.forEach(o => { const s = o.status || 'pending'; if(s in counts) counts[s]++; });
  document.getElementById('dashCountPending').textContent = counts.pending;
  document.getElementById('dashCountProcessing').textContent = counts.processing;
  document.getElementById('dashCountShipped').textContent = counts.shipped;
  document.getElementById('dashCountDelivered').textContent = counts.delivered;
  document.getElementById('dashCountRejected').textContent = counts.rejected;

  // Best sellers — aggregate item quantities across non-rejected orders
  const soldQty = {};
  adminOrders.filter(o => o.status !== 'rejected').forEach(o => {
    (o.items || []).forEach(i => {
      soldQty[i.name] = (soldQty[i.name] || 0) + (i.qty || 0);
    });
  });
  const bestSellers = Object.entries(soldQty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const bestSellersEl = document.getElementById('dashBestSellers');
  if(bestSellers.length === 0){
    bestSellersEl.innerHTML = `<div class="admin-empty" style="padding:20px;">No sales yet.</div>`;
  } else {
    bestSellersEl.innerHTML = bestSellers.map(([name, qty], i) => `
      <div class="dash-list-row">
        <span class="dash-list-rank">${i + 1}</span>
        <span class="dash-list-name">${name}</span>
        <span class="dash-list-qty">${qty} sold</span>
      </div>
    `).join('');
  }
}

/* ---------------- Product list ---------------- */
function watchAdminProducts(){
  if(productsUnsub) productsUnsub();
  productsUnsub = db.collection('products').orderBy('name').onSnapshot(snap => {
    adminProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminProducts();
    renderDashboard();
  }, err => {
    document.getElementById('adminProductRows').innerHTML =
      `<div class="admin-empty">Couldn't load products: ${err.message}</div>`;
  });
}
function renderProductCategoryFilters(){
  const select = document.getElementById('productCategoryFilterSelect');
  if(!select) return;
  const counts = {};
  adminProducts.forEach(p => { const c = productCategory(p); counts[c] = (counts[c] || 0) + 1; });
  const chips = [{ key:'all', label:'All' }, ...ADMIN_CATEGORIES];
  select.innerHTML = chips.map(c => {
    const count = c.key === 'all' ? adminProducts.length : (counts[c.key] || 0);
    return `<option value="${c.key}">${c.label} (${count})</option>`;
  }).join('');
  select.value = productCategoryFilter;
}
function setProductCategoryFilter(cat){
  productCategoryFilter = cat;
  renderAdminProducts();
}
function renderAdminProducts(){
  const wrap = document.getElementById('adminProductRows');
  renderProductCategoryFilters();
  const list = productCategoryFilter === 'all'
    ? adminProducts
    : adminProducts.filter(p => productCategory(p) === productCategoryFilter);
  if(list.length === 0){
    wrap.innerHTML = `<div class="admin-empty">${adminProducts.length === 0 ? 'No products yet — click "Add Product" to create your first one.' : 'No products in this category yet.'}</div>`;
    return;
  }
  wrap.innerHTML = list.map(p => `
    <div class="admin-row">
      <div class="admin-thumb">
        <img src="${(p.images && p.images[0]) || p.img || ''}" alt="${p.name}" onerror="this.style.opacity=0">
      </div>
      <div>
        <div class="name">${p.name}</div>
        <div class="sub">${p.sub || ''}</div>
      </div>
      <span class="col-tab">${categoryLabel(productCategory(p))}</span>
      <span class="col-rating">${nairaFmt ? nairaFmt(p.price || 0) : '₦' + (p.price || 0)}</span>
      <span>${p.stock ?? '—'}</span>
      <div class="admin-row-actions">
        <span class="edit" onclick="editProduct('${p.id}')">Edit</span>
        <span class="del" onclick="deleteProduct('${p.id}')">Delete</span>
      </div>
    </div>
  `).join('');
}

/* ---------------- Orders & payments ---------------- */
const ADMIN_ORDER_STATUS_LABELS = {
  pending: 'Pending', processing: 'Processing', shipped: 'Shipped',
  delivered: 'Delivered', rejected: 'Rejected'
};
let adminOrders = [];
let ordersUnsub = null;
let orderFilter = 'all';
// Notes typed but not yet saved — keeps them from being wiped out if a
// Firestore snapshot re-renders the order list while the admin is typing.
let unsavedNotes = {};

function watchAdminOrders(){
  if(ordersUnsub) ordersUnsub();
  ordersUnsub = db.collection('orders').onSnapshot(snap => {
    adminOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderAdminOrders();
    renderDashboard();
  }, err => {
    document.getElementById('adminOrdersWrap').innerHTML =
      `<div class="admin-empty">Couldn't load orders: ${err.message}</div>`;
  });
}
function setOrderFilter(status){
  orderFilter = status;
  const select = document.getElementById('orderStatusFilterSelect');
  if(select) select.value = status;
  renderAdminOrders();
}
function orderItemsSummary(order){
  return (order.items || []).map(i => `${i.name} ×${i.qty}`).join(', ');
}
function renderAdminOrders(){
  const wrap = document.getElementById('adminOrdersWrap');
  const pendingCount = adminOrders.filter(o => o.status === 'pending').length;
  const badge = document.getElementById('pendingOrdersBadge');
  badge.textContent = pendingCount;
  badge.style.display = pendingCount > 0 ? 'inline-flex' : 'none';

  let list = orderFilter === 'all' ? adminOrders : adminOrders.filter(o => o.status === orderFilter);

  const searchInput = document.getElementById('orderSearchInput');
  const query = (searchInput?.value || '').trim().toLowerCase();
  if(query){
    list = list.filter(o => {
      const name = (o.customer?.name || '').toLowerCase();
      const phone = (o.customer?.phone || '').toLowerCase();
      const shortId = o.id.slice(-6).toLowerCase();
      return name.includes(query) || phone.includes(query) || shortId.includes(query) || o.id.toLowerCase().includes(query);
    });
  }

  if(list.length === 0){
    wrap.innerHTML = `<div class="admin-empty">${query ? 'No orders match your search.' : 'No orders here yet.'}</div>`;
    return;
  }
  wrap.innerHTML = list.map(o => {
    const status = o.status || 'pending';
    let actions = '';
    if(status === 'pending'){
      actions = `<button class="btn-black" onclick="adminSetOrderStatus('${o.id}','processing')">Accept</button>
                 <button class="btn-danger-outline" onclick="adminSetOrderStatus('${o.id}','rejected')">Reject</button>`;
    } else if(status === 'processing'){
      actions = `<button class="btn-black" onclick="adminSetOrderStatus('${o.id}','shipped')">Mark Processing → Shipped</button>`;
    } else if(status === 'shipped'){
      actions = `<button class="btn-black" onclick="adminSetOrderStatus('${o.id}','delivered')">Mark Delivered</button>`;
    }
    const noteValue = unsavedNotes[o.id] ?? o.adminNote ?? '';
    return `
    <div class="admin-order-card">
      <div class="order-top">
        <span class="order-id">#${o.id.slice(-6).toUpperCase()}</span>
        <span class="admin-order-status ${status}">${ADMIN_ORDER_STATUS_LABELS[status] || status}</span>
      </div>
      <div class="order-customer">${o.customer?.name || 'Guest'} · ${o.customer?.phone || ''} · ${o.deliveryMethod === 'pickup' ? 'Pickup' : (o.customer?.state || '')}${o.customer?.email ? ' · ' + o.customer.email : ''}</div>
      <div class="order-account-tag" style="font-size:10.5px;color:var(--grey);">${o.uid ? 'Registered account' : 'Guest checkout'}</div>
      <div class="order-items">${orderItemsSummary(o)}</div>
      <div class="order-total">${nairaFmt(o.total || 0)} <span style="font-weight:400;color:var(--grey);font-size:11px;">via ${o.paymentMethod || 'Bank Transfer'}${o.paystackReference ? ' · ref ' + o.paystackReference : ''}</span></div>
      <div class="admin-order-actions">${actions}</div>
      <div class="admin-order-note">
        <textarea class="form-input order-note-input" placeholder="Private note (only visible to you) — e.g. customer asked to change address"
          oninput="unsavedNotes['${o.id}'] = this.value" id="note-${o.id}">${noteValue}</textarea>
        <div class="order-note-row">
          <button class="btn-outline" onclick="saveOrderNote('${o.id}')">Save Note</button>
          <span class="admin-settings-status" id="noteStatus-${o.id}"></span>
        </div>
      </div>
    </div>`;
  }).join('');
}
function saveOrderNote(orderId){
  const textarea = document.getElementById('note-' + orderId);
  const adminNote = textarea ? textarea.value : '';
  db.collection('orders').doc(orderId).update({ adminNote })
    .then(() => {
      delete unsavedNotes[orderId];
      const status = document.getElementById('noteStatus-' + orderId);
      if(status){
        status.textContent = 'Saved';
        status.className = 'admin-settings-status ok';
        setTimeout(() => { status.textContent = ''; status.className = 'admin-settings-status'; }, 2500);
      }
    })
    .catch(err => alert('Could not save note: ' + err.message));
}
function adminSetOrderStatus(orderId, status){
  if(status === 'rejected' && !confirm('Reject this order? The customer will see it marked as rejected.')) return;
  db.collection('orders').doc(orderId).update({ status })
    .catch(err => alert('Could not update order: ' + err.message));
}

/* ---------------- Bulk import (starter product list) ---------------- */
function importStarterProducts(){
  const existingNames = new Set(adminProducts.map(p => p.name));
  const toAdd = SEED_PRODUCTS.filter(p => !existingNames.has(p.name));
  if(toAdd.length === 0){
    alert('All starter products are already in Firestore — nothing new to import.');
    return;
  }
  if(!confirm(`Import ${toAdd.length} product(s)? No photos yet — you'll add those by editing each product afterward.`)) return;

  const btn = document.getElementById('importSeedBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  const batch = db.batch();
  const col = db.collection('products');
  toAdd.forEach(p => {
    const ref = col.doc();
    batch.set(ref, { ...p, rating: 0, count: 0, highlight: false, isNew: false, onSale: false, images: [], img: '' });
  });

  batch.commit()
    .then(() => alert(`Imported ${toAdd.length} product(s). Open each one to add photos.`))
    .catch(err => alert('Import failed: ' + err.message))
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Import Starter Products';
    });
}

/* ---------------- Add / edit modal ---------------- */
function openProductModal(product){
  editingProductId = product ? product.id : null;
  selectedImageFiles = [null, null, null];
  document.getElementById('productModalTitle').textContent = product ? 'Edit Product' : 'Add Product';
  document.getElementById('pName').value = product?.name || '';
  document.getElementById('pSub').value = product?.sub || '';
  document.getElementById('pKicker').value = product?.kicker || '';
  const catSelect = document.getElementById('pCategory');
  catSelect.innerHTML = ADMIN_CATEGORIES.map(c => `<option value="${c.key}">${c.label}</option>`).join('');
  catSelect.value = product?.category || ADMIN_CATEGORIES[0].key;
  document.getElementById('pPrice').value = product?.price ?? '';
  document.getElementById('pStock').value = product?.stock ?? '';
  document.getElementById('pRating').value = product?.rating ?? '';
  document.getElementById('pCount').value = product?.count ?? '';
  document.getElementById('pHighlight').checked = !!product?.highlight;
  document.getElementById('pIsNew').checked = !!product?.isNew;
  document.getElementById('pOnSale').checked = !!product?.onSale;
  if(typeof renderProductCollectionCheckboxes === 'function') renderProductCollectionCheckboxes(product);

  // Existing photos (supports old single-`img` products too, in slot 0)
  const existing = product?.images && product.images.length
    ? product.images
    : (product?.img ? [product.img] : []);
  existingImageUrls = [existing[0] || null, existing[1] || null, existing[2] || null];

  for(let i = 0; i < 3; i++){
    document.getElementById('productImageFile' + i).value = '';
    const preview = document.getElementById('uploadPreview' + i);
    preview.innerHTML = existingImageUrls[i] ? `<img src="${existingImageUrls[i]}">` : `Photo ${i+1}`;
  }

  document.getElementById('productModalOverlay').classList.add('open');
}
function closeProductModal(){
  document.getElementById('productModalOverlay').classList.remove('open');
}
function editProduct(id){
  const p = adminProducts.find(p => p.id === id);
  if(p) openProductModal(p);
}
function deleteProduct(id){
  if(!confirm('Delete this product? This cannot be undone.')) return;
  db.collection('products').doc(id).delete()
    .catch(err => alert('Could not delete product: ' + err.message));
}
function handleImageSelect(e, slot){
  const file = e.target.files[0];
  if(!file) return;
  selectedImageFiles[slot] = file;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('uploadPreview' + slot).innerHTML = `<img src="${reader.result}">`;
  };
  reader.readAsDataURL(file);
}

/* ---------------- Cloudinary upload ---------------- */
function uploadToCloudinary(file){
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  return fetch(url, { method: 'POST', body: formData })
    .then(res => {
      if(!res.ok) throw new Error('Cloudinary upload failed — check your cloud name and upload preset.');
      return res.json();
    })
    .then(data => data.secure_url);
}

/* ---------------- Save product ---------------- */
function saveProduct(){
  const name = document.getElementById('pName').value.trim();
  const sub = document.getElementById('pSub').value.trim();
  const category = document.getElementById('pCategory').value;
  const kicker = document.getElementById('pKicker').value.trim();
  const price = Number(document.getElementById('pPrice').value);
  const stock = Number(document.getElementById('pStock').value) || 0;
  const rating = Number(document.getElementById('pRating').value) || 0;
  const count = Number(document.getElementById('pCount').value) || 0;
  const highlight = document.getElementById('pHighlight').checked;
  const isNew = document.getElementById('pIsNew').checked;
  const onSale = document.getElementById('pOnSale').checked;
  const collectionTags = Array.from(document.querySelectorAll('#pCustomCollections input[data-coll-tag]:checked'))
    .map(input => input.dataset.collTag);

  if(!name || !category || !price){
    alert('Please fill in name, category, and price.');
    return;
  }
  const hasNewFiles = selectedImageFiles.some(f => f);
  if(CLOUDINARY_CLOUD_NAME === 'YOUR_CLOUD_NAME' && hasNewFiles){
    alert('Set your real CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in admin.js before uploading photos.');
    return;
  }

  const btn = document.getElementById('saveProductBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  // For each of the 3 slots: upload a newly selected file, or keep
  // whatever URL was already there, or drop it if the slot is empty.
  const slotPromises = [0, 1, 2].map(i =>
    selectedImageFiles[i]
      ? uploadToCloudinary(selectedImageFiles[i])
      : Promise.resolve(existingImageUrls[i])
  );

  Promise.all(slotPromises)
    .then(urls => {
      const images = urls.filter(Boolean);
      const data = { name, sub, category, kicker: kicker || categoryLabel(category), price, stock, rating, count, highlight, isNew, onSale, collectionTags, images, img: images[0] || '' };
      if(editingProductId){
        return db.collection('products').doc(editingProductId).update(data);
      }
      return db.collection('products').add(data);
    })
    .then(() => {
      closeProductModal();
    })
    .catch(err => alert('Could not save product: ' + err.message))
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Save Product';
    });
}

function nairaFmt(n){ return '₦' + Number(n).toLocaleString('en-NG'); }

/* ---------------- Settings (contact info, delivery fees, password) ----------------
   Everything here reads/writes a single Firestore doc: settings/site.
   The storefront (script.js) listens to that same doc live, so a save
   here shows up on the site immediately — no redeploy needed. */
let currentSiteSettings = {};

const SITE_TEXT_KEYS = {
  txtShopPageTitle: 'shopPageTitle',
  txtShopByCategory: 'shopByCategory',
  txtProductCategories: 'productCategories',
  txtOurProducts: 'ourProducts',
  txtPerfumeHeading: 'perfumeHeading',
  txtWhyUs: 'whyUs',
  txtEmailUpdates: 'emailUpdates',
  txtReviews: 'reviews',
  txtFaq: 'faq',
  txtHeroEyebrow: 'heroEyebrow',
  txtHeroTitle: 'heroTitle',
  txtTopBanner: 'topBanner',
  txtWhatsappBtn: 'whatsappBtnText',
};
const SITE_TEXT_DEFAULTS = {
  shopPageTitle: 'Shop',
  shopByCategory: 'Shop by Category',
  productCategories: 'Product Categories',
  ourProducts: 'Our Products',
  perfumeHeading: 'Need a perfume?',
  whyUs: 'Why Us',
  emailUpdates: 'Get e-mail updates',
  reviews: 'Reviews',
  faq: 'Frequently Asked',
  heroEyebrow: 'Non-Tarnish Jewellery • Minimal • Timeless • Statement Pieces',
  heroTitle: 'Elevate Every Moment',
  topBanner: 'Free delivery on orders over ₦150,000',
  whatsappBtnText: 'Chat on WhatsApp',
};
function loadSettingsIntoForm(){
  db.collection('settings').doc('site').get()
    .then(doc => {
      currentSiteSettings = doc.exists ? doc.data() : {};
      document.getElementById('setWhatsapp').value = currentSiteSettings.whatsappNumber || WHATSAPP_NUMBER || '';
      document.getElementById('setEmail').value = currentSiteSettings.contactEmail || CONTACT_EMAIL || '';
      document.getElementById('setWhatsappPerfumeMsg').value = currentSiteSettings.whatsappPerfumeMsg || WHATSAPP_PERFUME_MSG || '';
      document.getElementById('setWhatsappSupportMsg').value = currentSiteSettings.whatsappSupportMsg || WHATSAPP_SUPPORT_MSG || '';
      document.getElementById('setWhatsappFloatMsg').value = currentSiteSettings.whatsappFloatMsg || WHATSAPP_FLOAT_MSG || '';
      document.getElementById('setFreeThreshold').value = currentSiteSettings.freeDeliveryThreshold ?? FREE_DELIVERY_THRESHOLD ?? '';
      document.getElementById('setDefaultFee').value = currentSiteSettings.defaultDeliveryFee ?? DELIVERY_FEE ?? '';
      const states = (Array.isArray(currentSiteSettings.deliveryStates) && currentSiteSettings.deliveryStates.length)
        ? currentSiteSettings.deliveryStates
        : (typeof NIGERIAN_STATES !== 'undefined' ? NIGERIAN_STATES : []);
      const fees = currentSiteSettings.stateDeliveryFees || STATE_DELIVERY_FEES;
      renderStateFeeRows(states, fees);
      const siteText = { ...SITE_TEXT_DEFAULTS, ...(currentSiteSettings.siteText || {}) };
      Object.keys(SITE_TEXT_KEYS).forEach(inputId => {
        document.getElementById(inputId).value = siteText[SITE_TEXT_KEYS[inputId]] || '';
      });
      document.getElementById('setBankName').value = currentSiteSettings.bankName || BANK_NAME || '';
      document.getElementById('setBankAccountNumber').value = currentSiteSettings.bankAccountNumber || BANK_ACCOUNT_NUMBER || '';
      document.getElementById('setBankAccountName').value = currentSiteSettings.bankAccountName || BANK_ACCOUNT_NAME || '';
      const social = currentSiteSettings.socialLinks || {};
      document.getElementById('setInstagram').value = social.instagram || SOCIAL_INSTAGRAM || '';
      document.getElementById('setFacebook').value = social.facebook || SOCIAL_FACEBOOK || '';
      document.getElementById('setTiktok').value = social.tiktok || SOCIAL_TIKTOK || '';
      const faqs = (Array.isArray(currentSiteSettings.faqs) && currentSiteSettings.faqs.length)
        ? currentSiteSettings.faqs
        : (typeof HELP_FAQS !== 'undefined' ? HELP_FAQS : []);
      renderFaqRows(faqs);
      const whyUsItems = (Array.isArray(currentSiteSettings.whyUsItems) && currentSiteSettings.whyUsItems.length)
        ? currentSiteSettings.whyUsItems
        : (typeof WHY_US !== 'undefined' ? WHY_US : []);
      renderWhyUsRows(whyUsItems);
      document.getElementById('txtBestSellers').value = currentSiteSettings.bestSellersName || (typeof COLLECTIONS !== 'undefined' ? COLLECTIONS[0]?.name : '') || '';
      // Merge in any categories added from admin before this session
      // (stored separately from renames, since a rename only touches
      // an existing entry and can't create a new one).
      const customCategories = Array.isArray(currentSiteSettings.customCategories) ? currentSiteSettings.customCategories : [];
      customCategories.forEach(nc => {
        if(nc && nc.key && !ADMIN_CATEGORIES.find(c => c.key === nc.key)){
          ADMIN_CATEGORIES.push({ key: nc.key, label: nc.label || nc.key });
        }
      });
      const categoryLabels = currentSiteSettings.categoryLabels || {};
      renderCategoryLabelRows(categoryLabels);
      Object.keys(categoryLabels).forEach(key => {
        const c = ADMIN_CATEGORIES.find(x => x.key === key);
        if(c) c.label = categoryLabels[key];
      });
      if(typeof renderProductCategoryFilters === 'function') renderProductCategoryFilters();
      // Same merge pattern for Explore Collections tabs.
      const customCollections = Array.isArray(currentSiteSettings.customCollections) ? currentSiteSettings.customCollections : [];
      customCollections.forEach(nc => {
        if(nc && nc.key && !COLLECTION_TABS.find(c => c.key === nc.key)){
          COLLECTION_TABS.push({ key: nc.key, label: nc.label || nc.key, type: 'tag' });
        }
      });
      const collectionLabels = currentSiteSettings.collectionLabels || {};
      renderCollectionLabelRows(collectionLabels);
      Object.keys(collectionLabels).forEach(key => {
        const c = COLLECTION_TABS.find(x => x.key === key);
        if(c) c.label = collectionLabels[key];
      });
      const siteImages = currentSiteSettings.siteImages || {};
      renderSiteImagePreview('logoHeader', siteImages.logoHeader);
      renderSiteImagePreview('logoFooter', siteImages.logoFooter);
      renderSiteImagePreview('heroBg', siteImages.heroBg);
      renderInfoPages(currentSiteSettings.infoPages || {});
      renderDashboard();
    })
    .catch(err => {
      // No doc yet, or a read error — fall back to the storefront defaults
      // from data.js so the form still shows sensible values.
      document.getElementById('setWhatsapp').value = WHATSAPP_NUMBER || '';
      document.getElementById('setEmail').value = CONTACT_EMAIL || '';
      document.getElementById('setWhatsappPerfumeMsg').value = WHATSAPP_PERFUME_MSG || '';
      document.getElementById('setWhatsappSupportMsg').value = WHATSAPP_SUPPORT_MSG || '';
      document.getElementById('setWhatsappFloatMsg').value = WHATSAPP_FLOAT_MSG || '';
      document.getElementById('setFreeThreshold').value = FREE_DELIVERY_THRESHOLD ?? '';
      document.getElementById('setDefaultFee').value = DELIVERY_FEE ?? '';
      renderStateFeeRows(NIGERIAN_STATES, STATE_DELIVERY_FEES);
      Object.keys(SITE_TEXT_KEYS).forEach(inputId => {
        document.getElementById(inputId).value = SITE_TEXT_DEFAULTS[SITE_TEXT_KEYS[inputId]] || '';
      });
      document.getElementById('setBankName').value = BANK_NAME || '';
      document.getElementById('setBankAccountNumber').value = BANK_ACCOUNT_NUMBER || '';
      document.getElementById('setBankAccountName').value = BANK_ACCOUNT_NAME || '';
      document.getElementById('setInstagram').value = SOCIAL_INSTAGRAM || '';
      document.getElementById('setFacebook').value = SOCIAL_FACEBOOK || '';
      document.getElementById('setTiktok').value = SOCIAL_TIKTOK || '';
      renderFaqRows(typeof HELP_FAQS !== 'undefined' ? HELP_FAQS : []);
      renderWhyUsRows(typeof WHY_US !== 'undefined' ? WHY_US : []);
      document.getElementById('txtBestSellers').value = (typeof COLLECTIONS !== 'undefined' ? COLLECTIONS[0]?.name : '') || '';
      renderCategoryLabelRows({});
      renderCollectionLabelRows({});
      renderSiteImagePreview('logoHeader', null);
      renderSiteImagePreview('logoFooter', null);
      renderSiteImagePreview('heroBg', null);
      renderInfoPages({});
      console.error('Could not load settings:', err);
    });
}
function saveSiteTextSettings(){
  const siteText = {};
  Object.keys(SITE_TEXT_KEYS).forEach(inputId => {
    const val = document.getElementById(inputId).value.trim();
    if(val) siteText[SITE_TEXT_KEYS[inputId]] = val;
  });
  const bestSellersName = document.getElementById('txtBestSellers').value.trim();
  const btn = document.getElementById('saveSiteTextBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ siteText, bestSellersName }, { merge: true })
    .then(() => showSettingsStatus('siteTextSaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('siteTextSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
function renderStateFeeRows(states, fees){
  const wrap = document.getElementById('stateFeeRows');
  const list = (states && states.length) ? states : Object.keys(fees || {});
  wrap.innerHTML = list.map(state => `
    <div class="admin-state-fee-row" data-state="${state}">
      <span>${state}</span>
      <input class="form-input" type="number" min="0" data-state-fee value="${fees[state] ?? ''}">
      <button type="button" class="remove-state-btn" onclick="removeStateFeeRow(this)" aria-label="Remove ${state}">&times;</button>
    </div>
  `).join('');
}
function addStateFeeRow(){
  const nameInput = document.getElementById('newStateName');
  const feeInput = document.getElementById('newStateFee');
  const name = nameInput.value.trim();
  const fee = feeInput.value.trim();
  if(!name){
    showSettingsStatus('deliverySaveStatus', 'Enter a location name first.', false);
    return;
  }
  const existing = Array.from(document.querySelectorAll('#stateFeeRows .admin-state-fee-row')).map(r => r.dataset.state.toLowerCase());
  if(existing.includes(name.toLowerCase())){
    showSettingsStatus('deliverySaveStatus', 'That location is already in the list.', false);
    return;
  }
  const wrap = document.getElementById('stateFeeRows');
  const row = document.createElement('div');
  row.className = 'admin-state-fee-row';
  row.dataset.state = name;
  row.innerHTML = `
    <span>${name}</span>
    <input class="form-input" type="number" min="0" data-state-fee value="${fee}">
    <button type="button" class="remove-state-btn" onclick="removeStateFeeRow(this)" aria-label="Remove ${name}">&times;</button>
  `;
  wrap.appendChild(row);
  nameInput.value = '';
  feeInput.value = '';
}
function removeStateFeeRow(btn){
  btn.closest('.admin-state-fee-row').remove();
}
function showSettingsStatus(id, message, ok){
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = 'admin-settings-status ' + (ok ? 'ok' : 'err');
  if(ok) setTimeout(() => { el.textContent = ''; el.className = 'admin-settings-status'; }, 3000);
}
function saveContactSettings(){
  const whatsappNumber = document.getElementById('setWhatsapp').value.trim();
  const contactEmail = document.getElementById('setEmail').value.trim();
  const whatsappPerfumeMsg = document.getElementById('setWhatsappPerfumeMsg').value.trim();
  const whatsappSupportMsg = document.getElementById('setWhatsappSupportMsg').value.trim();
  const whatsappFloatMsg = document.getElementById('setWhatsappFloatMsg').value.trim();
  if(!whatsappNumber || !contactEmail){
    showSettingsStatus('contactSaveStatus', 'Please fill in both fields.', false);
    return;
  }
  const btn = document.getElementById('saveContactBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({
    whatsappNumber, contactEmail,
    whatsappPerfumeMsg, whatsappSupportMsg, whatsappFloatMsg
  }, { merge: true })
    .then(() => showSettingsStatus('contactSaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('contactSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
function saveDeliverySettings(){
  const freeDeliveryThreshold = Number(document.getElementById('setFreeThreshold').value);
  const defaultDeliveryFee = Number(document.getElementById('setDefaultFee').value);
  if(!Number.isFinite(freeDeliveryThreshold) || !Number.isFinite(defaultDeliveryFee)){
    showSettingsStatus('deliverySaveStatus', 'Please enter valid numbers.', false);
    return;
  }
  const deliveryStates = [];
  const stateDeliveryFees = {};
  document.querySelectorAll('#stateFeeRows .admin-state-fee-row').forEach(row => {
    const state = row.dataset.state;
    if(!state) return;
    deliveryStates.push(state);
    const input = row.querySelector('input[data-state-fee]');
    const v = Number(input.value);
    if(Number.isFinite(v) && input.value !== '') stateDeliveryFees[state] = v;
  });
  if(!deliveryStates.length){
    showSettingsStatus('deliverySaveStatus', 'Add at least one delivery location.', false);
    return;
  }
  const btn = document.getElementById('saveDeliveryBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ freeDeliveryThreshold, defaultDeliveryFee, deliveryStates, stateDeliveryFees }, { merge: true })
    .then(() => showSettingsStatus('deliverySaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('deliverySaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
function saveBankSettings(){
  const bankName = document.getElementById('setBankName').value.trim();
  const bankAccountNumber = document.getElementById('setBankAccountNumber').value.trim();
  const bankAccountName = document.getElementById('setBankAccountName').value.trim();
  if(!bankName || !bankAccountNumber || !bankAccountName){
    showSettingsStatus('bankSaveStatus', 'Please fill in all three fields.', false);
    return;
  }
  const btn = document.getElementById('saveBankBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ bankName, bankAccountNumber, bankAccountName }, { merge: true })
    .then(() => showSettingsStatus('bankSaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('bankSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
function saveSocialSettings(){
  const instagram = document.getElementById('setInstagram').value.trim();
  const facebook = document.getElementById('setFacebook').value.trim();
  const tiktok = document.getElementById('setTiktok').value.trim();
  const btn = document.getElementById('saveSocialBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ socialLinks: { instagram, facebook, tiktok } }, { merge: true })
    .then(() => showSettingsStatus('socialSaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('socialSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
function renderFaqRows(faqs){
  const wrap = document.getElementById('faqRows');
  wrap.innerHTML = (faqs || []).map((f, i) => `
    <div class="admin-faq-row">
      <button type="button" class="remove-faq-btn" onclick="removeFaqRow(this)" aria-label="Remove question">&times;</button>
      <label>Question</label>
      <input class="form-input" type="text" data-faq-q placeholder="Question" value="${(f.q || '').replace(/"/g, '&quot;')}">
      <label>Answer</label>
      <textarea data-faq-a placeholder="Answer">${f.a || ''}</textarea>
    </div>
  `).join('');
}
function addFaqRow(){
  const wrap = document.getElementById('faqRows');
  const row = document.createElement('div');
  row.className = 'admin-faq-row';
  row.innerHTML = `
    <button type="button" class="remove-faq-btn" onclick="removeFaqRow(this)" aria-label="Remove question">&times;</button>
    <label>Question</label>
    <input class="form-input" type="text" data-faq-q placeholder="Question">
    <label>Answer</label>
    <textarea data-faq-a placeholder="Answer"></textarea>
  `;
  wrap.appendChild(row);
  row.querySelector('input[data-faq-q]').focus();
}
function removeFaqRow(btn){
  btn.closest('.admin-faq-row').remove();
}
function saveFaqSettings(){
  const faqs = [];
  document.querySelectorAll('#faqRows .admin-faq-row').forEach(row => {
    const q = row.querySelector('input[data-faq-q]').value.trim();
    const a = row.querySelector('textarea[data-faq-a]').value.trim();
    if(q && a) faqs.push({ q, a });
  });
  if(!faqs.length){
    showSettingsStatus('faqSaveStatus', 'Add at least one question with an answer.', false);
    return;
  }
  const btn = document.getElementById('saveFaqBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ faqs }, { merge: true })
    .then(() => showSettingsStatus('faqSaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('faqSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
function renderWhyUsRows(items){
  const wrap = document.getElementById('whyUsRows');
  wrap.innerHTML = (items || []).map((w, i) => `
    <div class="admin-faq-row" data-why-index="${i}">
      <label>Title</label>
      <input class="form-input" type="text" data-why-title placeholder="Title" value="${(w.title || '').replace(/"/g, '&quot;')}">
      <label>Text</label>
      <textarea data-why-text placeholder="Text">${w.text || ''}</textarea>
    </div>
  `).join('');
}
function saveWhyUsSettings(){
  const whyUsItems = [];
  const defaults = typeof WHY_US !== 'undefined' ? WHY_US : [];
  document.querySelectorAll('#whyUsRows .admin-faq-row').forEach((row, i) => {
    const title = row.querySelector('input[data-why-title]').value.trim();
    const text = row.querySelector('textarea[data-why-text]').value.trim();
    if(title && text) whyUsItems.push({ title, text, icon: defaults[i]?.icon || '' });
  });
  if(!whyUsItems.length){
    showSettingsStatus('whyUsSaveStatus', 'Please fill in each card.', false);
    return;
  }
  const btn = document.getElementById('saveWhyUsBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ whyUsItems }, { merge: true })
    .then(() => showSettingsStatus('whyUsSaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('whyUsSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}

/* ---------------- Category names ---------------- */
function renderCategoryLabelRows(labels){
  const wrap = document.getElementById('categoryLabelRows');
  const base = typeof CATEGORIES !== 'undefined' ? CATEGORIES : [];
  // ADMIN_CATEGORIES may include categories added this session that
  // aren't in the base CATEGORIES list from data.js yet — show those too.
  const extra = ADMIN_CATEGORIES.filter(c => !base.find(b => b.key === c.key));
  wrap.innerHTML = [...base, ...extra].map(c => `
    <div style="margin-bottom:10px;">
      <label style="margin-top:0;">${c.key}</label>
      <input class="form-input" type="text" data-cat-key="${c.key}" value="${(labels[c.key] || c.label || '').replace(/"/g, '&quot;')}">
    </div>
  `).join('');
}
/* Turns a typed label into a Firestore-safe, URL-safe key, e.g.
   "Hair Accessories" -> "hair-accessories". */
function slugifyCategoryKey(label){
  return label.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}
function addNewCategory(){
  const input = document.getElementById('newCategoryName');
  const label = input.value.trim();
  if(!label){
    showSettingsStatus('categoryLabelsSaveStatus', 'Enter a category name first.', false);
    return;
  }
  const key = slugifyCategoryKey(label);
  if(!key){
    showSettingsStatus('categoryLabelsSaveStatus', 'That name isn\'t usable — try letters or numbers.', false);
    return;
  }
  if(ADMIN_CATEGORIES.find(c => c.key === key)){
    showSettingsStatus('categoryLabelsSaveStatus', 'A category with that name already exists.', false);
    return;
  }
  ADMIN_CATEGORIES.push({ key, label });
  input.value = '';
  renderCategoryLabelRows(Object.fromEntries(
    Array.from(document.querySelectorAll('#categoryLabelRows input[data-cat-key]')).map(i => [i.dataset.catKey, i.value])
  ));
  if(typeof renderProductCategoryFilters === 'function') renderProductCategoryFilters();
  showSettingsStatus('categoryLabelsSaveStatus', `Added "${label}" — click Save Category Names to make it live.`, true);
}
function saveCategoryLabels(){
  const categoryLabels = {};
  document.querySelectorAll('#categoryLabelRows input[data-cat-key]').forEach(input => {
    const val = input.value.trim();
    if(val) categoryLabels[input.dataset.catKey] = val;
  });
  // Persist every category ADMIN_CATEGORIES knows about that isn't one
  // of the original defaults from data.js — that's the full "add new
  // category" record the storefront (script.js) merges into CATEGORIES.
  const baseKeys = new Set((typeof CATEGORIES !== 'undefined' ? CATEGORIES : []).map(c => c.key));
  const customCategories = ADMIN_CATEGORIES
    .filter(c => !baseKeys.has(c.key))
    .map(c => ({ key: c.key, label: categoryLabels[c.key] || c.label }));
  const btn = document.getElementById('saveCategoryLabelsBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ categoryLabels, customCategories }, { merge: true })
    .then(() => {
      showSettingsStatus('categoryLabelsSaveStatus', 'Saved — live on the site now.', true);
      // Keep the admin panel's own category chips/labels in sync immediately.
      Object.keys(categoryLabels).forEach(key => {
        const c = ADMIN_CATEGORIES.find(x => x.key === key);
        if(c) c.label = categoryLabels[key];
      });
      if(typeof renderProductCategoryFilters === 'function') renderProductCategoryFilters();
    })
    .catch(err => showSettingsStatus('categoryLabelsSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}

/* ---------------- Explore Collections (New Arrivals / Best Sellers / On Sale + custom) ----------------
   Mirrors the category-names pattern above. The 3 starting tabs are
   "built-in" (COLLECTION_TABS[i].type === 'built-in') — their filter
   logic on the site is hardcoded (isNew / rating / onSale), so they
   can be renamed but not removed here. Anything added is type:'tag'
   and only shows products a user has checked that collection for in
   the product form (see renderProductCollectionCheckboxes below). */
function renderCollectionLabelRows(labels){
  const wrap = document.getElementById('collectionLabelRows');
  if(!wrap) return;
  wrap.innerHTML = COLLECTION_TABS.map(c => `
    <div style="margin-bottom:10px;">
      <label style="margin-top:0;">${c.key}${c.type === 'tag' ? ' (custom)' : ''}</label>
      <input class="form-input" type="text" data-coll-key="${c.key}" value="${(labels[c.key] || c.label || '').replace(/"/g, '&quot;')}">
    </div>
  `).join('');
}
function addNewCollection(){
  const input = document.getElementById('newCollectionName');
  const label = input.value.trim();
  if(!label){
    showSettingsStatus('collectionLabelsSaveStatus', 'Enter a collection name first.', false);
    return;
  }
  const key = slugifyCategoryKey(label);
  if(!key){
    showSettingsStatus('collectionLabelsSaveStatus', 'That name isn\'t usable — try letters or numbers.', false);
    return;
  }
  if(COLLECTION_TABS.find(c => c.key === key)){
    showSettingsStatus('collectionLabelsSaveStatus', 'A collection with that name already exists.', false);
    return;
  }
  COLLECTION_TABS.push({ key, label, type: 'tag' });
  input.value = '';
  renderCollectionLabelRows(Object.fromEntries(
    Array.from(document.querySelectorAll('#collectionLabelRows input[data-coll-key]')).map(i => [i.dataset.collKey, i.value])
  ));
  if(typeof renderProductCollectionCheckboxes === 'function') renderProductCollectionCheckboxes(editingProductId ? adminProducts.find(p => p.id === editingProductId) : null);
  showSettingsStatus('collectionLabelsSaveStatus', `Added "${label}" — click Save Collections to make it live. Then tag products into it from the product form.`, true);
}
function saveCollectionLabels(){
  const collectionLabels = {};
  document.querySelectorAll('#collectionLabelRows input[data-coll-key]').forEach(input => {
    const val = input.value.trim();
    if(val) collectionLabels[input.dataset.collKey] = val;
  });
  const builtInKeys = new Set(['new', 'best', 'sale']);
  const customCollections = COLLECTION_TABS
    .filter(c => !builtInKeys.has(c.key))
    .map(c => ({ key: c.key, label: collectionLabels[c.key] || c.label }));
  const btn = document.getElementById('saveCollectionLabelsBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ collectionLabels, customCollections }, { merge: true })
    .then(() => {
      showSettingsStatus('collectionLabelsSaveStatus', 'Saved — live on the site now.', true);
      Object.keys(collectionLabels).forEach(key => {
        const c = COLLECTION_TABS.find(x => x.key === key);
        if(c) c.label = collectionLabels[key];
      });
    })
    .catch(err => showSettingsStatus('collectionLabelsSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
/* Renders a checkbox per custom (type:'tag') collection in the product
   modal, so a product can be tagged into any number of them. Built-in
   collections aren't listed here — they already have their own
   checkboxes (pIsNew / pOnSale) tied to dedicated product fields. */
function renderProductCollectionCheckboxes(product){
  const wrap = document.getElementById('pCustomCollections');
  if(!wrap) return;
  const tagCollections = COLLECTION_TABS.filter(c => c.type === 'tag');
  const current = new Set(product?.collectionTags || []);
  wrap.innerHTML = tagCollections.map(c => `
    <div class="admin-check-row">
      <input type="checkbox" id="pColl-${c.key}" data-coll-tag="${c.key}" ${current.has(c.key) ? 'checked' : ''}>
      <label for="pColl-${c.key}">Show in "${c.label}" collection</label>
    </div>
  `).join('');
}

/* ---------------- Site images (logos, hero background) ---------------- */
let selectedSiteImageFiles = {};
function handleSiteImageSelect(e, slot){
  const file = e.target.files[0];
  if(!file) return;
  selectedSiteImageFiles[slot] = file;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('siteImgPreview-' + slot).innerHTML = `<img src="${reader.result}">`;
  };
  reader.readAsDataURL(file);
}
function renderSiteImagePreview(slot, url){
  const el = document.getElementById('siteImgPreview-' + slot);
  if(!el) return;
  el.innerHTML = url ? `<img src="${url}">` : 'No image set';
}
function saveSiteImages(){
  const btn = document.getElementById('saveSiteImagesBtn');
  btn.disabled = true;
  const slots = ['logoHeader', 'logoFooter', 'heroBg'];
  const uploads = slots.map(slot => {
    const file = selectedSiteImageFiles[slot];
    if(!file) return Promise.resolve(null);
    return uploadToCloudinary(file);
  });
  Promise.all(uploads)
    .then(urls => {
      const siteImages = { ...(currentSiteSettings.siteImages || {}) };
      slots.forEach((slot, i) => { if(urls[i]) siteImages[slot] = urls[i]; });
      return db.collection('settings').doc('site').set({ siteImages }, { merge: true });
    })
    .then(() => {
      showSettingsStatus('siteImagesSaveStatus', 'Saved — live on the site now.', true);
      selectedSiteImageFiles = {};
    })
    .catch(err => showSettingsStatus('siteImagesSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}

/* ---------------- Info / legal pages (About, Shipping, Returns, Terms, Privacy, Payment, Contact) ----------------
   Body text is edited as plain lines: "## " starts a subheading, "- "
   starts a bullet, and a blank line separates paragraphs — converted
   to/from the HTML stored in INFO_PAGES / Firestore. */
const INFO_PAGE_ORDER = ['about', 'shipping', 'returns', 'terms', 'privacy', 'payment', 'contact'];
function infoHtmlToText(html){
  let s = html || '';
  s = s.replace(/<h4>([\s\S]*?)<\/h4>/gi, '## $1\n');
  s = s.replace(/<ul>([\s\S]*?)<\/ul>/gi, (m, inner) => {
    const items = [...inner.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(x => '- ' + x[1].trim());
    return items.join('\n') + '\n';
  });
  s = s.replace(/<p>([\s\S]*?)<\/p>/gi, '$1\n\n');
  s = s.replace(/<a href="mailto:\{\{CONTACT_EMAIL\}\}">\{\{CONTACT_EMAIL\}\}<\/a>/gi, '{{CONTACT_EMAIL}}');
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/gi, '$1');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&amp;/g, '&');
  return s.trim();
}
function infoTextToHtml(text){
  const lines = (text || '').split('\n');
  let html = '';
  let listBuffer = [];
  let paraBuffer = [];
  function flushList(){ if(listBuffer.length){ html += '<ul>' + listBuffer.map(li => `<li>${li}</li>`).join('') + '</ul>'; listBuffer = []; } }
  function flushPara(){ if(paraBuffer.length){ html += `<p>${paraBuffer.join(' ')}</p>`; paraBuffer = []; } }
  lines.forEach(line => {
    const t = line.trim();
    if(!t){ flushPara(); flushList(); return; }
    if(t.startsWith('## ')){ flushPara(); flushList(); html += `<h4>${t.slice(3)}</h4>`; return; }
    if(t.startsWith('- ')){ flushPara(); listBuffer.push(t.slice(2)); return; }
    flushList();
    paraBuffer.push(t);
  });
  flushPara(); flushList();
  return html;
}
function renderInfoPages(overrides){
  const wrap = document.getElementById('infoPagesGrid');
  const defaults = typeof INFO_PAGES !== 'undefined' ? INFO_PAGES : {};
  wrap.innerHTML = INFO_PAGE_ORDER.map(key => {
    const page = overrides[key] || defaults[key] || { title: key, body: '' };
    return `
    <div class="admin-settings-card">
      <h3>${defaults[key]?.title || key}</h3>
      <label>Page title</label>
      <input class="form-input" data-page-title value="${(page.title || '').replace(/"/g, '&quot;')}">
      <label>Page content</label>
      <textarea data-page-body style="width:100%;min-height:220px;resize:vertical;font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:8px;margin-top:4px;">${infoHtmlToText(page.body)}</textarea>
      <button class="btn-black" data-save-page="${key}" onclick="saveInfoPage('${key}')">Save ${defaults[key]?.title || key}</button>
      <p class="admin-settings-status" data-page-status="${key}"></p>
    </div>`;
  }).join('');
}
function saveInfoPage(key){
  const card = document.querySelector(`[data-save-page="${key}"]`).closest('.admin-settings-card');
  const title = card.querySelector('[data-page-title]').value.trim();
  const bodyText = card.querySelector('[data-page-body]').value;
  const statusEl = card.querySelector('[data-page-status]');
  if(!title){
    statusEl.textContent = 'Please enter a page title.';
    statusEl.className = 'admin-settings-status err';
    return;
  }
  const body = infoTextToHtml(bodyText);
  const btn = card.querySelector(`[data-save-page="${key}"]`);
  btn.disabled = true;
  const infoPages = { ...(currentSiteSettings.infoPages || {}) };
  infoPages[key] = { title, body };
  db.collection('settings').doc('site').set({ infoPages }, { merge: true })
    .then(() => {
      currentSiteSettings.infoPages = infoPages;
      statusEl.textContent = 'Saved — live on the site now.';
      statusEl.className = 'admin-settings-status ok';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'admin-settings-status'; }, 3000);
    })
    .catch(err => {
      statusEl.textContent = 'Could not save: ' + err.message;
      statusEl.className = 'admin-settings-status err';
    })
    .finally(() => { btn.disabled = false; });
}
function changeAdminPassword(){
  const user = auth.currentUser;
  if(!user){ showSettingsStatus('pwSaveStatus', 'Please log in again.', false); return; }
  const currentPassword = document.getElementById('pwCurrent').value;
  const newPassword = document.getElementById('pwNew').value;
  const confirmPassword = document.getElementById('pwConfirm').value;
  if(!currentPassword || !newPassword || !confirmPassword){
    showSettingsStatus('pwSaveStatus', 'Fill in all three fields.', false);
    return;
  }
  if(newPassword.length < 6){
    showSettingsStatus('pwSaveStatus', 'New password must be at least 6 characters.', false);
    return;
  }
  if(newPassword !== confirmPassword){
    showSettingsStatus('pwSaveStatus', 'New password and confirmation don\u2019t match.', false);
    return;
  }
  const btn = document.getElementById('changePwBtn');
  btn.disabled = true;
  const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
  user.reauthenticateWithCredential(cred)
    .then(() => user.updatePassword(newPassword))
    .then(() => {
      showSettingsStatus('pwSaveStatus', 'Password updated.', true);
      document.getElementById('pwCurrent').value = '';
      document.getElementById('pwNew').value = '';
      document.getElementById('pwConfirm').value = '';
    })
    .catch(err => {
      const msg = err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : err.message;
      showSettingsStatus('pwSaveStatus', 'Could not update password: ' + msg, false);
    })
    .finally(() => { btn.disabled = false; });
}
