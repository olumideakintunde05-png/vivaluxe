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

/* ---------------- Auth gate ---------------- */
/* Guarded the same way as the customer site's script.js: this is a
   top-level statement that runs immediately on load. If Firebase
   hasn't finished loading yet (slow connection), an unguarded call
   here would throw and silently stop the rest of this file from
   running — leaving a blank admin page with no error shown. */
if(typeof auth !== 'undefined'){
  auth.onAuthStateChanged(user => {
    if(!user){
      showAdminLogin();
      return;
    }
    // Verify this user is on the admins allowlist before showing anything.
    db.collection('admins').doc(user.uid).get()
      .then(doc => {
        if(doc.exists){
          showAdminApp(user);
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
  ['dashboard', 'products', 'orders', 'sitetext', 'settings'].forEach(t => {
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
  adminProducts.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
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
    : adminProducts.filter(p => p.category === productCategoryFilter);
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
      <span class="col-tab">${categoryLabel(p.category)}</span>
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
function clearAllOrders(){
  if(adminOrders.length === 0){
    alert('There are no orders to clear.');
    return;
  }
  const first = confirm(
    `This will permanently delete all ${adminOrders.length} order(s) from your store — ` +
    `including anything real, not just tests. This cannot be undone.\n\nContinue?`
  );
  if(!first) return;
  const second = confirm('Are you absolutely sure? This is your last chance to cancel.');
  if(!second) return;

  const btn = document.getElementById('clearOrdersBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Clearing…'; }

  db.collection('orders').get()
    .then(snap => {
      const batches = [];
      let batch = db.batch();
      let count = 0;
      snap.docs.forEach(doc => {
        batch.delete(doc.ref);
        count++;
        if(count % 400 === 0){ batches.push(batch.commit()); batch = db.batch(); }
      });
      batches.push(batch.commit());
      return Promise.all(batches);
    })
    .then(() => {
      alert('All orders cleared. Your dashboard is back to zero.');
    })
    .catch(err => {
      alert('Could not clear orders: ' + err.message);
    })
    .finally(() => {
      if(btn){ btn.disabled = false; btn.textContent = 'Clear All Orders'; }
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
      <div class="order-customer">${o.customer?.name || 'Guest'} · ${o.customer?.phone || ''} · ${o.customer?.state || ''}</div>
      <div class="order-items">${orderItemsSummary(o)}</div>
      <div class="order-total">${nairaFmt(o.total || 0)} <span style="font-weight:400;color:var(--grey);font-size:11px;">via ${o.paymentMethod || 'Bank Transfer'}</span></div>
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
      const data = { name, sub, category, kicker: kicker || categoryLabel(category), price, stock, rating, count, highlight, isNew, onSale, images, img: images[0] || '' };
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
};
function loadSettingsIntoForm(){
  db.collection('settings').doc('site').get()
    .then(doc => {
      currentSiteSettings = doc.exists ? doc.data() : {};
      document.getElementById('setWhatsapp').value = currentSiteSettings.whatsappNumber || WHATSAPP_NUMBER || '';
      document.getElementById('setEmail').value = currentSiteSettings.contactEmail || CONTACT_EMAIL || '';
      document.getElementById('setFreeThreshold').value = currentSiteSettings.freeDeliveryThreshold ?? FREE_DELIVERY_THRESHOLD ?? '';
      document.getElementById('setDefaultFee').value = currentSiteSettings.defaultDeliveryFee ?? DELIVERY_FEE ?? '';
      renderStateFeeRows({ ...STATE_DELIVERY_FEES, ...(currentSiteSettings.stateDeliveryFees || {}) });
      const siteText = { ...SITE_TEXT_DEFAULTS, ...(currentSiteSettings.siteText || {}) };
      Object.keys(SITE_TEXT_KEYS).forEach(inputId => {
        document.getElementById(inputId).value = siteText[SITE_TEXT_KEYS[inputId]] || '';
      });
      renderDashboard();
    })
    .catch(err => {
      // No doc yet, or a read error — fall back to the storefront defaults
      // from data.js so the form still shows sensible values.
      document.getElementById('setWhatsapp').value = WHATSAPP_NUMBER || '';
      document.getElementById('setEmail').value = CONTACT_EMAIL || '';
      document.getElementById('setFreeThreshold').value = FREE_DELIVERY_THRESHOLD ?? '';
      document.getElementById('setDefaultFee').value = DELIVERY_FEE ?? '';
      renderStateFeeRows(STATE_DELIVERY_FEES);
      Object.keys(SITE_TEXT_KEYS).forEach(inputId => {
        document.getElementById(inputId).value = SITE_TEXT_DEFAULTS[SITE_TEXT_KEYS[inputId]] || '';
      });
      console.error('Could not load settings:', err);
    });
}
function saveSiteTextSettings(){
  const siteText = {};
  Object.keys(SITE_TEXT_KEYS).forEach(inputId => {
    const val = document.getElementById(inputId).value.trim();
    if(val) siteText[SITE_TEXT_KEYS[inputId]] = val;
  });
  const btn = document.getElementById('saveSiteTextBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ siteText }, { merge: true })
    .then(() => showSettingsStatus('siteTextSaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('siteTextSaveStatus', 'Could not save: ' + err.message, false))
    .finally(() => { btn.disabled = false; });
}
function renderStateFeeRows(fees){
  const wrap = document.getElementById('stateFeeRows');
  wrap.innerHTML = (typeof NIGERIAN_STATES !== 'undefined' ? NIGERIAN_STATES : Object.keys(fees)).map(state => `
    <div class="admin-state-fee-row">
      <span>${state}</span>
      <input class="form-input" type="number" min="0" data-state="${state}" value="${fees[state] ?? ''}">
    </div>
  `).join('');
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
  if(!whatsappNumber || !contactEmail){
    showSettingsStatus('contactSaveStatus', 'Please fill in both fields.', false);
    return;
  }
  const btn = document.getElementById('saveContactBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ whatsappNumber, contactEmail }, { merge: true })
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
  const stateDeliveryFees = {};
  document.querySelectorAll('#stateFeeRows input[data-state]').forEach(input => {
    const v = Number(input.value);
    if(Number.isFinite(v) && input.value !== '') stateDeliveryFees[input.dataset.state] = v;
  });
  const btn = document.getElementById('saveDeliveryBtn');
  btn.disabled = true;
  db.collection('settings').doc('site').set({ freeDeliveryThreshold, defaultDeliveryFee, stateDeliveryFees }, { merge: true })
    .then(() => showSettingsStatus('deliverySaveStatus', 'Saved — live on the site now.', true))
    .catch(err => showSettingsStatus('deliverySaveStatus', 'Could not save: ' + err.message, false))
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
