/* ===========================================================
   SEED_PRODUCTS — the client's WhatsApp product list, cleaned
   up and structured. Used ONLY by the "Import Starter Products"
   button in admin.html — never loaded by the customer site.

   Photos are intentionally left empty (images: []) — after
   importing, open each product in the admin panel and add its
   photo(s) from there.
   =========================================================== */

const SEED_PRODUCTS = [
  // ---------------- Necklaces ----------------
  { name:'Arya Necklace',        sub:'Titanium Steel, Non-fading',                    kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:'Daphne Necklace',      sub:'Stainless Steel, 18k Gold Plated',              kicker:'Necklace', category:'necklaces', price:14000, stock:2 },
  { name:'Delia Necklace',       sub:'Stainless Steel, Non-Tarnish',                  kicker:'Necklace', category:'necklaces', price:9500,  stock:5 },
  { name:'Eden Necklace',        sub:'Titanium Steel, Non-Fading',                    kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:'Eloise Necklace',      sub:'Stainless Steel, Non-Tarnish',                  kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:'Halo Necklace',        sub:'Stainless Steel, 18k Gold Plated',              kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:'Noelle Necklace',      sub:'Stainless Steel, Non-Tarnish',                  kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:'Nova Necklace',        sub:'Stainless Steel, 18k Gold Plated',              kicker:'Necklace', category:'necklaces', price:12000, stock:3 },
  { name:'Nyla Necklace',        sub:'Titanium Steel, Non-Fading',                    kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:"Penelope's Necklace",  sub:'Stainless Steel, Gold Plated',                  kicker:'Necklace', category:'necklaces', price:12000, stock:2 },
  { name:'Luxe Necklace',        sub:'Titanium Steel, Non-Fading',                    kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:'Ariel Necklace',       sub:'Titanium Steel, Non-fading',                    kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },
  { name:'The Eliana Necklace',  sub:'Stainless Steel, 18k Gold Plated',              kicker:'Necklace', category:'necklaces', price:9500,  stock:2 },

  // ---------------- Bracelets ----------------
  { name:'Hollow Clover Bracelet',    sub:'Non-Tarnish, 18k Gold Plated',                          kicker:'Bracelet', category:'bracelets', price:14000, stock:2 },
  { name:'6mm Nova Bracelet',         sub:'Stainless Steel, 18k Gold Finish',                      kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'8mm Diamond Bracelet',      sub:'Stainless Steel, Non-Tarnish',                          kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'5mm Love Zircon Bracelet',  sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'4mm Poka Bracelet',         sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  /* JESUS IS LORD*/
  { name:'8mm Bloom Bracelet',        sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'6mm Minimalist Bracelet',   sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'5mm Glossy Bracelet',       sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'Twin Line Bracelet',        sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'5mm Vee Bracelet',          sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:2 },
  { name:'LuXe Bracelet Gold',        sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:1 },
  { name:'LuXe Bracelet Silver',      sub:'Stainless Steel, 18k Gold Plated, Tarnish Resistant',   kicker:'Bracelet', category:'bracelets', price:10000, stock:1 },
  { name:'Flower Bracelet Gold',      sub:'Titanium Steel, Tarnish Resistant',                     kicker:'Bracelet', category:'bracelets', price:6500,  stock:2 },
  { name:'Multilayer Bracelet',       sub:'',                                                      kicker:'Bracelet', category:'bracelets', price:8000,  stock:2 },
  { name:'Petite Girl Bracelet',      sub:'Non-Tarnish',                                           kicker:'Bracelet', category:'bracelets', price:6500,  stock:2 },

  // ---------------- Sunglasses ----------------
  { name:'Oval Bloom Shades',         sub:'Brown UV Lens', kicker:'Sunglasses', category:'sunglasses', price:14000, stock:1 },
  { name:'Square Classic Shades 01',  sub:'Brown Lens',    kicker:'Sunglasses', category:'sunglasses', price:14000, stock:1 },
  { name:'Square Classic Shades 02',  sub:'Black Lens',    kicker:'Sunglasses', category:'sunglasses', price:14000, stock:3 },
  { name:'Square Classic Shades 03',  sub:'Black Lens',    kicker:'Sunglasses', category:'sunglasses', price:14000, stock:2 },
  { name:'Square Classic Shades 04',  sub:'Black Lens',    kicker:'Sunglasses', category:'sunglasses', price:14000, stock:1 },

  // ---------------- Watch ----------------
  { name:"Luminous Men's Watch", sub:'', kicker:'Watch', category:'mens-watches', price:35500, stock:2 },

  // ---------------- Earrings ----------------
  { name:'Statement Earring 01', sub:'Non-Tarnish', kicker:'Earrings', category:'earrings', price:6500, stock:1 },
  { name:'Statement Earring 02', sub:'Non-Tarnish', kicker:'Earrings', category:'earrings', price:6500, stock:3 },
  { name:'Statement Earring 03', sub:'Non-Tarnish', kicker:'Earrings', category:'earrings', price:6500, stock:2 },
  { name:'Vintage Earring 01',   sub:'Non-Tarnish', kicker:'Earrings', category:'earrings', price:8500, stock:2 },
  { name:'Vintage Earring 02',   sub:'Non-Tarnish', kicker:'Earrings', category:'earrings', price:8500, stock:2 },
  { name:'Pear Earring 01',      sub:'',            kicker:'Earrings', category:'earrings', price:4000, stock:2 },
  { name:'Pear Earring 02',      sub:'',            kicker:'Earrings', category:'earrings', price:4000, stock:2 },
  { name:'Pear Earring 03',      sub:'',            kicker:'Earrings', category:'earrings', price:4000, stock:2 },
  { name:'Pear Earring 04',      sub:'',            kicker:'Earrings', category:'earrings', price:4000, stock:2 },
  { name:'Pear Earring 05',      sub:'',            kicker:'Earrings', category:'earrings', price:4000, stock:2 },
  { name:'Sleek Earrings 01',    sub:'',            kicker:'Earrings', category:'earrings', price:4000, stock:2 },
];