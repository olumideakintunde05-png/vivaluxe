/* ===========================================================
   VIVA LUXE — content data

   Product photos are managed entirely from the admin panel
   (admin.html) and stored in Firestore/Cloudinary — nothing here
   is a hardcoded filename. CATEGORIES below defines the official
   10-category taxonomy; every product's `category` field must
   match one of these keys exactly (enforced in the admin form).
   =========================================================== */

const ICONS = {
  ring: `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="15" r="6"/><path d="M9 9l3-6 3 6"/></svg>`,
  necklace: `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 4c0 7 4 11 8 11s8-4 8-11"/><circle cx="12" cy="17" r="2.6"/></svg>`,
  bracelet: `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><ellipse cx="12" cy="12" rx="8" ry="5"/><path d="M4 12a8 5 0 0016 0"/></svg>`,
  earrings: `<svg width="46%" height="46%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="6" r="2"/><path d="M7 8v5a2 2 0 104 0"/><circle cx="17" cy="6" r="2"/><path d="M17 8v5a2 2 0 11-4 0"/></svg>`,
  anklet: `<svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><ellipse cx="12" cy="9" rx="7" ry="4"/><path d="M9 12.5l1.2 7M15 12.5l-1.2 7"/><circle cx="12" cy="20.5" r="1.3"/></svg>`,
  jewelrySet: `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 9h16M12 9v11"/><path d="M8 9c-2 0-3-1.4-3-3s1.5-2.5 3-1.5S12 9 12 9M16 9c2 0 3-1.4 3-3s-1.5-2.5-3-1.5S12 9 12 9"/></svg>`,
  stacks: `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><ellipse cx="12" cy="6.5" rx="6.2" ry="2.4"/><ellipse cx="12" cy="12" rx="6.2" ry="2.4"/><ellipse cx="12" cy="17.5" rx="6.2" ry="2.4"/></svg>`,
  sunglasses: `<svg width="54%" height="54%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6.5" cy="13" r="3.5"/><circle cx="17.5" cy="13" r="3.5"/><path d="M10 12h4M3 12l1.5-5h3M21 12l-1.5-5h-3"/></svg>`,
  watch: `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="6.5"/><path d="M12 9v3l2 2"/><path d="M9 4h6l-1 3H10zM9 20h6l-1-3H10z"/></svg>`,
  product: `<svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M20 12v7a1 1 0 01-1 1H5a1 1 0 01-1-1v-7"/><path d="M3.5 8l1-4h15l1 4"/><path d="M3.5 8h17M12 8v3"/></svg>`
};

/* The client's starting set of product categories. `key` is the exact
   value stored on each product's `category` field in Firestore —
   never rename a key without updating existing product docs.
   `icon` points at a local image (pro1.jpg ... pro10.jpg) shown in
   the round "Shop by Category" tiles on the home page.
   This list is no longer fixed — new categories added from the admin
   panel are merged in at runtime (see applySiteSettings in script.js,
   `data.customCategories`) and don't need an icon to work everywhere
   except the curated round tile row on the home page. */
const CATEGORIES = [
  { key:'necklaces',     label:'Necklaces',     icon:'pro1.jpg'  },
  { key:'earrings',      label:'Earrings',      icon:'pro2.jpg'  },
  { key:'bracelets',     label:'Bracelets',     icon:'pro3.jpg'  },
  { key:'rings',         label:'Rings',         icon:'pro4.jpg'  },
  { key:'anklets',       label:'Anklets',       icon:'pro5.jpg'  },
  { key:'jewelry-sets',  label:'Jewelry Sets',  icon:'pro6.jpg'  },
  { key:'stacks',        label:'Stacks',        icon:'pro7.jpg'  },
  { key:'mens-watches',  label:"Men's Watches", icon:'pro8.jpg'  },
  { key:'sunglasses',    label:'Sunglasses',    icon:'pro9.jpg'  },
  { key:'wristwatches',  label:'Wristwatches',  icon:'pro10.jpg' },
];

const COLLECTIONS = [
  { name:"Best Sellers",     icon:ICONS.ring,     img:'pro5.jpg' },
];

/* Tabs on the "Explore Collections" screen. The 3 starting tabs are
   "built-in" — each is powered by an existing per-product flag/field
   (isNew, rating, onSale) rather than manual tagging. Any collection
   added later from admin is type:'tag' and pulls in whatever products
   have that collection's key in their `collectionTags` array — see
   renderCollectionGrid() in script.js. `key` must stay stable once
   products have been tagged with it. */
const COLLECTION_TABS = [
  { key:'new',  label:'New Arrivals', type:'built-in' },
  { key:'best', label:'Best Sellers', type:'built-in' },
  { key:'sale', label:'On Sale',      type:'built-in' },
];

/* PRODUCTS lives in Firestore (collection: "products") and is
   managed from the admin panel — see admin.html. This starts empty
   and gets populated by the real-time listener in script.js
   (watchProducts()). Each product doc looks like:
     { name, sub, category, price, stock, rating, count, images, highlight }
   "category" must be one of the CATEGORIES keys above — it's the
   ONLY field used for shop/category filtering.
   "id" is the Firestore document ID, attached when we read it. */
let PRODUCTS = [];

/* Wishlist/cart now start empty — real content comes from the
   logged-in user's activity instead of demo seed data. */
const WISHLIST_IDS = [];

const CART = [];

/* These four are defaults only — the admin panel's Settings tab
   overwrites them at runtime from Firestore (settings/site), via
   applySiteSettings() in script.js. Keep them as sensible fallbacks
   in case that document doesn't exist yet. */
let FREE_DELIVERY_THRESHOLD = 150000;
let DELIVERY_FEE = 5000;

/* Content below (WHY_US, HELP_FAQS) is placeholder copy — kept
   deliberately generic and easy to edit. Do not treat these as
   confirmed business policies (return windows, delivery times,
   etc.) until the client has explicitly approved the wording. */
const WHY_US = [
  { title:'Quality Materials', text:'Our pieces are carefully selected for their quality, durability and tarnish-resistant finish. We’re intentional about what we offer and committed to making every customer feel valued.',
    icon:`<svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>` },
  { title:'Free Delivery', text:'Free delivery nationwide on orders over ₦150,000.',
    icon:`<svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/></svg>` },
  { title:'Secure Ordering', text:'A simple, secure checkout process from start to finish.',
    icon:`<svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>` },
  { title:'Customer Support', text:"We're here to help with any questions about your order.",
    icon:`<svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4v6h6"/><path d="M4.5 15a8 8 0 1 0 2-8.4L4 10"/></svg>` },
  { title:'WhatsApp Support', text:'Reach us directly on WhatsApp for help with your order.',
    icon:`<svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 11.5a8.5 8.5 0 01-12.3 7.6L3 20l1-5.6A8.5 8.5 0 1121 11.5z"/></svg>` },
];

const NIGERIAN_STATES = [
  'Lagos','Benue (Makurdi)','Nasarawa','Lafia','Warri','Port Harcourt',
  'Owerri','Calabar','Benin','Auchi','Asaba','Enugu','Ibadan'
];

/* ===========================================================
   DELIVERY LOCATIONS & FEES
   -----------------------------------------------------------
   This is the exact, complete list of locations delivered to —
   not a full state-by-state list. Fixed flat fee per location,
   confirmed by the client. Orders at/above FREE_DELIVERY_THRESHOLD
   always ship free, regardless of location.
   =========================================================== */
let STATE_DELIVERY_FEES = {
  'Lagos': 6000,
  'Benue (Makurdi)': 3500,
  'Nasarawa': 3000,
  'Lafia': 3000,
  'Warri': 6000,
  'Port Harcourt': 6000,
  'Owerri': 6000,
  'Calabar': 5500,
  'Benin': 5500,
  'Auchi': 5500,
  'Asaba': 5500,
  'Enugu': 5000,
  'Ibadan': 6000,
};
function getDeliveryFee(state, subtotal){
  if(subtotal === 0) return 0;
  if(subtotal >= FREE_DELIVERY_THRESHOLD) return 0;
  return STATE_DELIVERY_FEES[state] ?? DELIVERY_FEE;
}

/* Default WhatsApp number and contact email — editable live from the
   admin panel's Settings tab (Firestore settings/site), same as the
   delivery fees above. */
let WHATSAPP_NUMBER = '2349013643713';
let CONTACT_EMAIL = 'vivaluxebyvivian@gmail.com';

/* Pre-filled messages that load inside WhatsApp when each button is
   tapped — editable live from the admin panel's Settings tab (Store
   Contact card), same mechanism as WHATSAPP_NUMBER above. */
let WHATSAPP_PERFUME_MSG = "Hi, I’d like to place an order for a perfume..";
let WHATSAPP_SUPPORT_MSG = "Hi! I need help with something.";
let WHATSAPP_FLOAT_MSG = "Hi! I have a question about VIVA LUXE.";

/* Bank transfer details shown at checkout — editable live from the
   admin panel's Settings tab (Firestore settings/site). These are
   fallback defaults only. */
let BANK_NAME = 'Zenith Bank';
let BANK_ACCOUNT_NUMBER = '2195254046';
let BANK_ACCOUNT_NAME = 'Vivian Torkwase Nombor';

/* Social media links shown in the footer — editable live from the
   admin panel's Settings tab (Firestore settings/site). Empty by
   default, in which case the icon shows a "coming soon" message. */
let SOCIAL_INSTAGRAM = '';
let SOCIAL_FACEBOOK = '';
let SOCIAL_TIKTOK = '';

/* ADDRESSES now lives per-user in Firestore under users/{uid}/addresses
/*  JESUS IS LORD 
   and is populated by the onAuthStateChanged listener in script.js.
   Starts empty until someone logs in. */
let ADDRESSES = [];

/* ===========================================================
   INFO PAGES — About Us, Shipping & Delivery, Returns & Exchanges,
   Terms & Conditions, Privacy Policy, Contact Us.
   This is the client's approved write-up — shown via showInfo()
   from the footer. Edit the HTML strings below to update copy.
   =========================================================== */
const INFO_PAGES = {
  payment: {
    title: 'Payment Methods',
    body: `
      <h4>How You Can Pay</h4>
      <p><strong>Bank Transfer</strong> — Transfer directly to our account. Details are shown at checkout; your order is confirmed once payment is verified.</p>
      <p><strong>Paystack</strong> — Pay securely by card, bank transfer, or USSD through Paystack's checkout.</p>
    `
  },
  about: {
    title: 'About Us',
    body: `
      <h4>Our Story</h4>
      <p>VIVA LUXE began with a genuine love for jewelry and the way it elevates every moment. We believe in the beauty of pieces that complete an outfit, complement your individuality, and add confidence to the way you show up.</p>
      <p>That love grew into a vision for a modern lifestyle brand built around timeless style, quality, and pieces worth reaching for again and again.</p>
      <p>Today, VIVA LUXE brings together jewelry and accessories designed to complement your personal style, from everyday essentials to pieces that make a statement.</p>
      <h4>Our Mission</h4>
      <p>Our mission is to curate high-end, non-tarnish jewelry and accessories that complement different styles, occasions, and everyday moments, while delivering quality and exceptional customer service.</p>
      <h4>Our Values</h4>
      <p><strong>Quality</strong> — Every piece is selected with attention to quality, finish, durability, and value.</p>
      <p><strong>Intentionality</strong> — We are intentional about what we offer and how we serve you. Every detail matters.</p>
      <p><strong>Individuality</strong> — Style is personal. We offer pieces that allow you to keep it simple, express yourself, or make a statement.</p>
      <p><strong>Customer Experience</strong> — We genuinely value our customers. From choosing your pieces to receiving your order, we are committed to providing attentive service and a thoughtful experience.</p>
      <h4>What to Expect</h4>
      <ul>
        <li>Beautiful, high-quality, non-tarnish jewelry made to last.</li>
        <li>Timeless styles alongside pieces that make a statement.</li>
        <li>Carefully selected accessories that complement your personal style.</li>
        <li>Exceptional customer service with genuine care and attention to detail.</li>
        <li>A brand that genuinely values you and your experience.</li>
      </ul>
      <p><strong>Elevate Every Moment.</strong></p>
    `
  },
  shipping: {
    title: 'Shipping & Delivery',
    body: `
      <h4>How long does delivery take?</h4>
      <p>Orders are processed within 24 hours. Delivery within Nigeria takes 2–5 days, while same-day delivery is available within Abuja, depending on your location.</p>
      <h4>Do you offer free delivery?</h4>
      <p>Yes, we offer complimentary delivery on orders of ₦150,000 and above.</p>
    `
  },
  returns: {
    title: 'Refund & Return Policy',
    body: `
      <p>At VIVA LUXE, every order is carefully inspected and packaged to ensure it reaches you in perfect condition.</p>
      <p>If you receive a damaged or incorrect item, please contact us within 24 hours of delivery with your order details and clear photos of the item.</p>
      <p>Once verified, we may offer:</p>
      <ul>
        <li>An exchange for the correct item, subject to availability.</li>
        <li>Store credit or a refund, depending on the circumstances.</li>
      </ul>
      <p>Approved refunds are processed within 2–3 working days after confirmation.</p>
      <h4>Please Note</h4>
      <ul>
        <li>We do not accept returns or exchanges due to a change of mind.</li>
        <li>Worn, used, altered, or damaged items are not eligible for return or exchange.</li>
        <li>Items must be returned in their original condition and packaging where applicable.</li>
        <li>Claims made after 24 hours of delivery may not be accepted.</li>
      </ul>
      <p>For any concerns, please contact us promptly. We're happy to assist.</p>
    `
  },
  terms: {
    title: 'Terms & Conditions',
    body: `
      <p>By shopping with VIVA LUXE, you agree to the following terms:</p>
      <h4>Orders & Payments</h4>
      <p>All orders must be fully paid before processing. Payments are securely accepted through Paystack and Moniepoint.</p>
      <h4>Delivery</h4>
      <p>Orders are processed within 24 hours. Delivery times vary depending on your location.</p>
      <h4>Returns & Exchanges</h4>
      <p>Returns or exchanges are only accepted for damaged or incorrect items. Please notify us within 24 hours of delivery. See our Refund & Return Policy for details.</p>
      <h4>Product Information</h4>
      <p>We provide accurate product descriptions and images. Slight variations in colour or appearance may occur due to lighting or screen settings.</p>
      <h4>Intellectual Property</h4>
      <p>All VIVA LUXE content, including images, product descriptions, logos, and designs, belongs to VIVA LUXE. Unauthorized use is prohibited.</p>
      <h4>Privacy</h4>
      <p>Your personal information is handled in accordance with our Privacy Policy and is used only for purposes related to your orders, communication, delivery, and customer service.</p>
    `
  },
  privacy: {
    title: 'Privacy Policy',
    body: `
      <p>At VIVA LUXE, protecting your personal information is a priority.</p>
      <p>We collect only the information required to process your orders, communicate with you, provide customer support, and improve your shopping experience.</p>
      <p>All payments are processed securely through Paystack, a trusted payment gateway. We do not store or share your card details.</p>
      <p>Your personal information is kept secure and is never sold or used for third-party marketing.</p>
      <p>If you subscribe to our updates or newsletters, you can unsubscribe at any time.</p>
      <p>For questions regarding your personal information or privacy, contact us at <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>
    `
  },
  contact: {
    title: 'Contact Us',
    body: `
      <h4>Hotline</h4>
      <p>0901 364 3713</p>
      <h4>Email</h4>
      <p><a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a></p>
      <h4>Instagram</h4>
      <p>@_vivaluxe.co</p>
      <h4>TikTok</h4>
      <p>@_vivaluxe.co</p>
      <h4>Location</h4>
      <p>Abuja, Nigeria</p>
      <h4>Customer Service Hours</h4>
      <p>24-Hour (Monday – Sunday)</p>
    `
  }
};

const HELP_FAQS = [
  { q:'How do I check my order?', a:'Go to Account to see your order details. Contact us on WhatsApp any time if you have questions about where things stand.' },
  { q:'What payment methods do you accept?', a:'Payment details are shown at checkout. If you have questions before ordering, reach out on WhatsApp.' },
  { q:'How long does delivery take?', a:"Delivery time depends on your location. We'll confirm an estimate with you after you place your order." },
  { q:'Can I return or exchange an item?', a:'Contact us on WhatsApp about your order and we\'ll help sort out a return or exchange.' },
  { q:'How do I request a perfume?', a:'Perfumes are available exclusively through our concierge service — tap "Perfume Concierge" on the home screen or in the menu to chat with us directly.' },
];

function nairaFmt(n){ return '₦' + n.toLocaleString('en-NG'); }
function productById(id){ return PRODUCTS.find(p=>p.id===id); }
