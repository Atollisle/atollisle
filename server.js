// Atoll Isle API
// Express backend storing its data in Postgres (built for Neon, but any
// Postgres works). Storage lives behind two functions — dbRead()/dbWrite() —
// as a single JSONB document for now; see the README for the exact deploy
// steps (GitHub + Render + Neon) and notes on moving to normalized tables
// later, the same evolution SeaFare already went through.
//
// Local setup:
//   npm install
//   DATABASE_URL=postgres://...  ADMIN_PASSCODE=choose-a-real-passcode  node server.js
//
// Optional (for real Google-sourced listings):
//   GOOGLE_PLACES_API_KEY=your-key  node server.js
//   Requires the Places API enabled and billing set up on your Google Cloud project.
//   Without this key, Google-sourced listings simply aren't synced — nothing breaks.

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = process.env.PORT || 8787;
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "change-me-admin";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

if(!DATABASE_URL){
  console.error("DATABASE_URL is not set. Set it to your Neon connection string and restart.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Neon requires SSL; this matches the setting SeaFare's Neon connection already uses
});

const BIZ_FREE_LIMIT = 1;
const BIZ_PRO_LIMIT = 10;
const BIZ_PRO_DAYS = 30;

// Seed data only — once the database has its own `atolls` field (below), this
// constant is never read again. Renaming an island happens through the admin
// endpoint instead of editing this list and redeploying.
const SEED_ATOLLS = [
  {atoll:"Haa Alif Atoll", islands:["Baarah","Dhiddhoo","Filladhoo","Hoarafushi","Ihavandhoo","Kelaa","Maarandhoo","Mulhadhoo","Muraidhoo","Thakandhoo","Thuraakunu","Utheemu","Vashafaru","Uligan"]},
  {atoll:"Haa Dhaalu Atoll", islands:["Finey","Hirilandhoo","Hanimaadhoo","Kattakuredhoo","Kulhudhuffushi","Kumundhoo","Kurinbi","Makunudhoo","Navaidhoo","Nellaidhoo","Neykurendhoo","Nolhivaram","Nolhivaranfaru","Vaikaradhoo"]},
  {atoll:"Shaviyani Atoll", islands:["Bileffahi","Feevah","Feydhoo","Foakaidhoo","Funadhoo","Goidhoo","Kanditheemu","Komandoo","Lhaimagu","Maaungoodhoo","Narudhoo","Noomaraa","Milandhoo","Maroshi"]},
  {atoll:"Noonu Atoll", islands:["Foddhoo","Henbadhoo","Holhudhoo","Kendhikulhudhoo","Kudafari","Landhoo","Lhohi","Maalhendhoo","Magoodhoo","Manadhoo","Miladhoo","Velidhoo"]},
  {atoll:"Raa Atoll", islands:["Alifushi","Angolhitheemu","Fainu","Hulhudhuffaaru","Inguraidhoo","Innamaadhoo","Dhuvaafaru","Kandholhudhoo","Kinnolhas","Maakurathu","Maduvvari","Meedhoo","Rasgetheemu","Rasmadhoo","Ungoofaaru","Vaadhoo"]},
  {atoll:"Baa Atoll", islands:["Dharavandhoo","Dhonfanu","Eydafushi","Fehendhoo","Fulhadhoo","Goidhoo","Hitheadhoo","Kamadhoo","Kendhoo","Kihaadhoo","Kudarikilu","Maalhos","Thulhaadhoo"]},
  {atoll:"Lhaviyani Atoll", islands:["Hinnavaru","Kurendhoo","Maafilaafushi","Naifaru","Olhuvelifushi"]},
  {atoll:"Kaafu Atoll & Malé", islands:["Malé","Villingili","Hulhumalé","Hulhulé","Dhiffushi","Gaafaru","Gulhi","Guraidhoo","Himmafushi","Huraa","Kaashidhoo","Maafushi","Thulusdhoo"]},
  {atoll:"Alif Alif Atoll", islands:["Bodufolhudhoo","Feridhoo","Himandhoo","Mathiveri","Rasdhoo","Thoddoo","Ukulhas","Maalhos"]},
  {atoll:"Alif Dhaal Atoll", islands:["Dhigurah","Fenfushi","Hangnaameedhoo","Kunburudhoo","Maamigili","Mahibadhoo","Mandhoo","Omadhoo","Dhangethi","Dhidhdhoo"]},
  {atoll:"Vaavu Atoll", islands:["Felidhoo","Fulidhoo","Keyodhoo","Rakeedhoo","Thinadhoo"]},
  {atoll:"Meemu Atoll", islands:["Dhiggaru","Kolhufushi","Maduvvaree","Mulah","Muli","Naalaafushi","Raimmandhoo","Veyvah"]},
  {atoll:"Faafu Atoll", islands:["Feeali","Bileddhoo","Dharanboodhoo","Magoodhoo","Nilandhoo"]},
  {atoll:"Dhaalu Atoll", islands:["Bandidhoo","Gemendhoo","Huluhedheli","Kudahuvadhoo","Maaenboodhoo","Meedhoo","Rinbudhoo"]},
  {atoll:"Thaa Atoll", islands:["Buruni","Dhiyamigili","Gaadhiffushi","Guraidhoo","Hirilandhoo","Kandoodhoo","Kinbidhoo","Madifushi","Omadhoo","Thimarafushi","Vandhoo","Veimandoo","Vilufushi"]},
  {atoll:"Laamu Atoll", islands:["Dhanbidhoo","Fonadhoo","Gaadhoo","Gan","Isdhoo","Kalaidhoo","Kunahandhoo","Maabaidhoo","Maamendhoo","Maavah","Mundoo"]},
  {atoll:"Gaafu Alifu Atoll", islands:["Dhaandhoo","Dhevvadhoo","Gemanafushi","Kanduhulhudhoo","Kolamaafushi","Kondey","Maamendhoo","Nilandhoo","Villingili"]},
  {atoll:"Gaafu Dhaalu Atoll", islands:["Fares-Maathoda","Fiyoari","Gaddhoo","Hoandeddhoo","Nadella","Rathafandhoo","Thinadhoo","Vaadhoo","Madaveli"]},
  {atoll:"Gnaviyani Atoll", islands:["Fuvahmulah"]},
  {atoll:"Seenu Atoll", islands:["Feydhoo","Hithadhoo","Hulhudhoo","Meedhoo","Maradhoo","Maradhoo-Feydhoo"]}
];
function flattenIslands(atolls){ return atolls.reduce((acc,a)=>acc.concat(a.islands), []); }
const CATEGORIES = ["Guesthouses","Hotels & Resorts","Cafés & Restaurants","Excursions & Dive","Shops & Rentals","Attractions & Activities"];
const CATEGORY_QUERY = {
  "Guesthouses": "guesthouses",
  "Hotels & Resorts": "hotels and resorts",
  "Cafés & Restaurants": "cafes and restaurants",
  "Excursions & Dive": "dive centers and excursions",
  "Shops & Rentals": "shops and rentals",
  "Attractions & Activities": "tourist attractions and things to do"
};

function seedState(){
  return {
    atolls: SEED_ATOLLS,
    businesses: [
      {id:"b1", name:"Ocean Breeze Guesthouse", category:"Guesthouses", island:"Maafushi", desc:"Ten minutes from bikini beach, family-run, free bike loan.", price:"$28–40/night", contact:"+960 771 2233", ownerEmail:"demo@atollisle.mv", verified:true, source:"owner"},
      {id:"b2", name:"Salt & Line Café", category:"Cafés & Restaurants", island:"Maafushi", desc:"Fresh tuna, slow coffee, sunset seating on the jetty.", price:"$4–12/plate", contact:"+960 795 1010", ownerEmail:"demo@atollisle.mv", verified:false, source:"owner"},
      {id:"g1", name:"Maafushi Beach Inn", category:"Guesthouses", island:"Maafushi", desc:"Public listing found on Google — not yet claimed by its owner.", price:"", contact:"", ownerEmail:null, verified:false, source:"google", googlePlaceId:"demo-g1"}
    ],
    events: [
      {id:"e1", title:"Full Moon Beach BBQ", island:"Maafushi", date:"Fri 21 Aug, 7pm", desc:"Grilled reef fish, bonfire, $10 entry.", businessOwner:"demo@atollisle.mv"}
    ],
    bizUsers: [],
    duplicateFlags: [],
    sessions: {},
    googleSyncCache: {},
    unmatchedGoogle: []
  };
}

// ---------- Postgres-backed "database" ----------
// Everything lives as one JSONB document (row id=1) for now — simple and safe
// for a single-writer app like this. If you outgrow it, split each top-level
// key (businesses, events, bizUsers, ...) into its own table; dbRead/dbWrite
// are the only two functions the rest of the file touches.
async function ensureTable(){
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id INT PRIMARY KEY, data JSONB NOT NULL)`);
  const { rows } = await pool.query("SELECT 1 FROM app_state WHERE id = 1");
  if(!rows.length){
    await pool.query("INSERT INTO app_state (id, data) VALUES (1, $1)", [JSON.stringify(seedState())]);
  }
}
async function dbRead(){
  const { rows } = await pool.query("SELECT data FROM app_state WHERE id = 1");
  const db = rows[0].data;
  // Backfill for databases created before islands moved into the DB.
  if(!db.atolls) db.atolls = SEED_ATOLLS;
  if(!db.unmatchedGoogle) db.unmatchedGoogle = [];
  return db;
}
async function dbWrite(db){
  await pool.query("UPDATE app_state SET data = $1 WHERE id = 1", [JSON.stringify(db)]);
}
function genId(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// ---------- password hashing (built-in crypto, no extra deps) ----------
function hashPassword(password, salt){
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, hash){
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

// wraps an async route handler/middleware so a thrown error becomes a 500 instead of hanging the request
function h(fn){
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
      console.error(err);
      res.status(500).json({ error: err.message || "Server error" });
    });
  };
}

// ---------- auth helpers ----------
const requireAuth = h(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const db = await dbRead();
  const email = db.sessions[token];
  if(!email) return res.status(401).json({error:"Not signed in"});
  req.bizEmail = email;
  req.db = db;
  next();
});
const requireAdmin = h(async (req, res, next) => {
  const passcode = req.headers["x-admin-passcode"];
  if(passcode !== ADMIN_PASSCODE) return res.status(401).json({error:"Bad admin passcode"});
  req.db = await dbRead();
  next();
});

function bizEffectivePro(rec){ return !!(rec && rec.isPro && rec.proExpiry && rec.proExpiry > Date.now()); }

// ---------- app ----------
const app = express();
app.use(cors());
app.use(express.json());

// -- public: businesses & events --
app.get("/api/atolls", h(async (req, res) => {
  const db = await dbRead();
  res.json(db.atolls);
}));

app.get("/api/businesses", h(async (req, res) => {
  const db = await dbRead();
  let list = db.businesses;
  if(req.query.island) list = list.filter(b => b.island === req.query.island);
  if(req.query.category && req.query.category !== "All") list = list.filter(b => b.category === req.query.category);
  res.json(list);
}));

app.get("/api/events", h(async (req, res) => {
  const db = await dbRead();
  let list = db.events;
  if(req.query.island) list = list.filter(e => e.island === req.query.island);
  res.json(list);
}));

app.post("/api/events", requireAuth, h(async (req, res) => {
  const db = req.db;
  const { title, island, date, desc } = req.body;
  if(!title || !island) return res.status(400).json({error:"title and island are required"});
  const entry = { id: genId("e"), title, island, date: date || "", desc: desc || "", businessOwner: req.bizEmail };
  db.events.push(entry);
  await dbWrite(db);
  res.json(entry);
}));

// Public (Google-sourced) listings nobody has claimed yet — shown to business
// owners in the portal so they can claim theirs instead of creating a duplicate.
app.get("/api/unclaimed", h(async (req, res) => {
  const db = await dbRead();
  let list = db.businesses.filter(b => b.source === "google" && !b.ownerEmail);
  if(req.query.island) list = list.filter(b => b.island === req.query.island);
  if(req.query.q){
    const q = req.query.q.toLowerCase();
    list = list.filter(b => b.name.toLowerCase().includes(q));
  }
  res.json(list);
}));

app.post("/api/my-listings/claim/:id", requireAuth, h(async (req, res) => {
  const db = req.db;
  const rec = db.bizUsers.find(u => u.email === req.bizEmail);
  const mine = db.businesses.filter(b => b.ownerEmail === req.bizEmail);
  const limit = bizEffectivePro(rec) ? BIZ_PRO_LIMIT : BIZ_FREE_LIMIT;
  if(mine.length >= limit) return res.status(403).json({error:"Listing limit reached", limit});
  const b = db.businesses.find(x => x.id === req.params.id);
  if(!b || b.source !== "google" || b.ownerEmail) return res.status(404).json({error:"That listing isn't available to claim"});
  b.ownerEmail = req.bizEmail;
  await dbWrite(db);
  res.json(b);
}));

// -- business auth --
app.post("/api/auth/signup", h(async (req, res) => {
  const db = await dbRead();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  if(!email.includes("@") || password.length < 4) return res.status(400).json({error:"Valid email and a password of 4+ characters required"});
  if(db.bizUsers.find(u => u.email === email)) return res.status(409).json({error:"An account already exists for this email"});
  const { salt, hash } = hashPassword(password);
  const rec = { email, salt, hash, createdAt: Date.now(), isPro:false, proExpiry:null };
  db.bizUsers.push(rec);
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = email;
  await dbWrite(db);
  res.json({ token, email });
}));

app.post("/api/auth/login", h(async (req, res) => {
  const db = await dbRead();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const rec = db.bizUsers.find(u => u.email === email);
  if(!rec || !verifyPassword(password, rec.salt, rec.hash)) return res.status(401).json({error:"No matching account and password found"});
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = email;
  await dbWrite(db);
  res.json({ token, email });
}));

app.post("/api/auth/logout", requireAuth, h(async (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  delete req.db.sessions[token];
  await dbWrite(req.db);
  res.json({ ok:true });
}));

// -- signed-in business account --
app.get("/api/account", requireAuth, h(async (req, res) => {
  const rec = req.db.bizUsers.find(u => u.email === req.bizEmail);
  const mine = req.db.businesses.filter(b => b.ownerEmail === req.bizEmail);
  const effPro = bizEffectivePro(rec);
  res.json({
    email: rec.email, isPro: effPro, proExpiry: rec.proExpiry,
    listingCount: mine.length, listingLimit: effPro ? BIZ_PRO_LIMIT : BIZ_FREE_LIMIT
  });
}));

// Demo checkout — flips the flag and extends 30 days. Swap for a real Stripe
// subscription webhook before charging anyone for real.
app.post("/api/account/upgrade", requireAuth, h(async (req, res) => {
  const db = req.db;
  const rec = db.bizUsers.find(u => u.email === req.bizEmail);
  const now = Date.now();
  const base = (rec.proExpiry && rec.proExpiry > now) ? rec.proExpiry : now;
  rec.isPro = true;
  rec.proExpiry = base + BIZ_PRO_DAYS * 86400000;
  await dbWrite(db);
  res.json({ isPro: true, proExpiry: rec.proExpiry });
}));

app.get("/api/my-listings", requireAuth, h(async (req, res) => {
  res.json(req.db.businesses.filter(b => b.ownerEmail === req.bizEmail));
}));

app.post("/api/my-listings", requireAuth, h(async (req, res) => {
  const db = req.db;
  const rec = db.bizUsers.find(u => u.email === req.bizEmail);
  const mine = db.businesses.filter(b => b.ownerEmail === req.bizEmail);
  const limit = bizEffectivePro(rec) ? BIZ_PRO_LIMIT : BIZ_FREE_LIMIT;
  if(mine.length >= limit) return res.status(403).json({error:"Listing limit reached", limit});
  const { name, category, island, desc, price, contact } = req.body;
  if(!name || !category || !island) return res.status(400).json({error:"name, category and island are required"});
  const entry = { id: genId("b"), name, category, island, desc: desc || "", price: price || "", contact: contact || "", ownerEmail: req.bizEmail, verified:false, source:"owner" };
  db.businesses.push(entry);

  // Notify the super admin if this name matches an unclaimed Google-sourced listing on the same island.
  const nameLower = name.trim().toLowerCase();
  const match = db.businesses.find(b => b.source === "google" && b.island === island &&
    (b.name.toLowerCase().includes(nameLower) || nameLower.includes(b.name.toLowerCase())));
  if(match){
    db.duplicateFlags.push({
      id: genId("d"), businessName: name, island, ownerEmail: req.bizEmail,
      matchedGoogleId: match.id, matchedGoogleName: match.name,
      createdAt: Date.now(), status: "pending"
    });
  }
  await dbWrite(db);
  res.json({ listing: entry, flagged: !!match });
}));

app.delete("/api/my-listings/:id", requireAuth, h(async (req, res) => {
  const db = req.db;
  const b = db.businesses.find(x => x.id === req.params.id);
  if(!b || b.ownerEmail !== req.bizEmail) return res.status(404).json({error:"Not found"});
  db.businesses = db.businesses.filter(x => x.id !== req.params.id);
  await dbWrite(db);
  res.json({ ok:true });
}));

// -- super admin --
app.post("/api/admin/login", (req, res) => {
  if(req.body.passcode !== ADMIN_PASSCODE) return res.status(401).json({error:"Bad passcode"});
  res.json({ ok:true });
});

app.get("/api/admin/duplicate-flags", requireAdmin, h(async (req, res) => {
  res.json(req.db.duplicateFlags);
}));

app.post("/api/admin/duplicate-flags/:id/resolve", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const flag = db.duplicateFlags.find(f => f.id === req.params.id);
  if(!flag) return res.status(404).json({error:"Not found"});
  if(req.body.action === "remove"){
    db.businesses = db.businesses.filter(b => b.id !== flag.matchedGoogleId);
    flag.status = "removed";
  } else {
    flag.status = "dismissed";
  }
  await dbWrite(db);
  res.json(flag);
}));

app.get("/api/admin/businesses", requireAdmin, h(async (req, res) => res.json(req.db.businesses)));

// Renames an island everywhere it's used: the atoll list itself, any
// businesses/events currently filed under the old name, and the Google sync
// cache. `atoll` disambiguates which island to rename, since a handful of
// island names repeat across different atolls in the Maldives.
app.post("/api/admin/islands/rename", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const { atoll, oldName, newName } = req.body;
  const newTrimmed = (newName || "").trim();
  if(!atoll || !oldName || !newTrimmed) return res.status(400).json({error:"atoll, oldName and newName are required"});
  const atollEntry = db.atolls.find(a => a.atoll === atoll);
  if(!atollEntry) return res.status(404).json({error:"Atoll not found"});
  const idx = atollEntry.islands.indexOf(oldName);
  if(idx === -1) return res.status(404).json({error:"Island not found in that atoll"});
  if(newTrimmed !== oldName && atollEntry.islands.includes(newTrimmed)){
    return res.status(409).json({error:"That atoll already has an island with this name"});
  }
  atollEntry.islands[idx] = newTrimmed;
  let renamedCount = 0;
  db.businesses.forEach(b => { if(b.island === oldName){ b.island = newTrimmed; renamedCount++; } });
  db.events.forEach(e => { if(e.island === oldName){ e.island = newTrimmed; renamedCount++; } });
  if(db.googleSyncCache && db.googleSyncCache[oldName] !== undefined){
    db.googleSyncCache[newTrimmed] = db.googleSyncCache[oldName];
    delete db.googleSyncCache[oldName];
  }
  await dbWrite(db);
  res.json({ atoll, oldName, newName: newTrimmed, renamedCount });
}));

// Replaces the whole island/atoll list with the current built-in SEED_ATOLLS
// (i.e. whatever's in this file right now). Use this after updating
// SEED_ATOLLS in code and redeploying, since a live database's `atolls` field
// is only backfilled once and otherwise doesn't pick up code changes on its
// own. Does NOT touch existing businesses/events — any of them filed under a
// name that no longer exists in the new list will keep showing that old
// name; use "Fix island" on each to reassign them to the corrected spelling.
app.post("/api/admin/islands/reset-to-latest", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const before = flattenIslands(db.atolls).length;
  db.atolls = SEED_ATOLLS;
  await dbWrite(db);
  res.json({ before, after: flattenIslands(db.atolls).length });
}));

app.delete("/api/admin/businesses/:id", requireAdmin, h(async (req, res) => {
  const db = req.db;
  db.businesses = db.businesses.filter(b => b.id !== req.params.id);
  await dbWrite(db);
  res.json({ ok:true });
}));

app.patch("/api/admin/businesses/:id", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const b = db.businesses.find(x => x.id === req.params.id);
  if(!b) return res.status(404).json({error:"Not found"});
  if(typeof req.body.verified === "boolean") b.verified = req.body.verified;
  if(typeof req.body.island === "string" && flattenIslands(db.atolls).includes(req.body.island)) b.island = req.body.island;
  if(typeof req.body.category === "string" && CATEGORIES.includes(req.body.category)) b.category = req.body.category;
  await dbWrite(db);
  res.json(b);
}));

app.get("/api/admin/accounts", requireAdmin, h(async (req, res) => {
  res.json(req.db.bizUsers.map(u => ({ email:u.email, createdAt:u.createdAt, isPro:u.isPro, proExpiry:u.proExpiry })));
}));

// Manual grant — same pattern SeaFare uses since there's no live billing webhook yet.
app.post("/api/admin/accounts/:email/grant-pro", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const rec = db.bizUsers.find(u => u.email === req.params.email);
  if(!rec) return res.status(404).json({error:"Not found"});
  const now = Date.now();
  const base = (rec.proExpiry && rec.proExpiry > now) ? rec.proExpiry : now;
  rec.isPro = true;
  rec.proExpiry = base + BIZ_PRO_DAYS * 86400000;
  await dbWrite(db);
  res.json(rec);
}));

app.post("/api/admin/accounts/:email/revoke-pro", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const rec = db.bizUsers.find(u => u.email === req.params.email);
  if(!rec) return res.status(404).json({error:"Not found"});
  rec.isPro = false;
  await dbWrite(db);
  res.json(rec);
}));

// Pulls public listings from Google Places for one island and merges any new
// ones in as source:"google". Requires GOOGLE_PLACES_API_KEY. Safe to call
// repeatedly — skips places already synced by place_id.
//
// Google's text search sometimes returns a place that isn't actually on the
// searched island (a nearby/similarly-matched result) — if the returned
// address doesn't mention the island we searched for, skip it rather than
// filing it under the wrong island.
function addressMentionsIsland(address, island){
  if(!address) return false;
  const norm = s => s.toLowerCase().replace(/['’]/g, "");
  return norm(address).includes(norm(island));
}

// A handful of island names repeat across different atolls (e.g. "Meedhoo"
// exists in three). The atoll name goes into the search query itself so
// Google is biased toward the right one, and the sync cache/results are
// keyed by "Atoll::Island" rather than island name alone, so syncing one
// "Meedhoo" never gets confused with — or skipped because of — another.
function syncKey(atoll, island){ return atoll + "::" + island; }

async function syncIslandGoogle(db, atoll, island){
  let added = 0;
  let skippedMismatch = 0;
  for(const category of CATEGORIES){
    const query = CATEGORY_QUERY[category] + " in " + island + ", " + atoll + ", Maldives";
    const results = await placesTextSearch(query);
    for(const place of results){
      const exists = db.businesses.find(b => b.googlePlaceId === place.id);
      if(exists) continue;
      if(!addressMentionsIsland(place.formattedAddress, island)){
        skippedMismatch++;
        // The same place often turns up as a mismatch for many different
        // island searches (e.g. a Malé business showing up while searching
        // every other island) — dedupe by place id so it's stored once for
        // review, not once per island it happened to surface under.
        const alreadyUnmatched = db.unmatchedGoogle.find(u => u.googlePlaceId === place.id);
        if(!alreadyUnmatched){
          db.unmatchedGoogle.push({
            id: genId("u"), name: (place.displayName && place.displayName.text) || "Unnamed place", category,
            desc: place.formattedAddress || "", contact: place.internationalPhoneNumber || place.nationalPhoneNumber || "",
            googlePlaceId: place.id, foundSearchingAtoll: atoll, foundSearchingIsland: island, createdAt: Date.now()
          });
        }
        continue;
      }
      db.businesses.push({
        id: genId("g"), name: (place.displayName && place.displayName.text) || "Unnamed place", category, island,
        desc: place.formattedAddress || "", price:"", contact: place.internationalPhoneNumber || place.nationalPhoneNumber || "", ownerEmail:null,
        verified:false, source:"google", googlePlaceId: place.id
      });
      added++;
    }
  }
  db.googleSyncCache[syncKey(atoll, island)] = Date.now();
  return { added, skippedMismatch };
}

app.post("/api/admin/sync-google/:island", requireAdmin, h(async (req, res) => {
  if(!GOOGLE_PLACES_API_KEY) return res.status(400).json({error:"GOOGLE_PLACES_API_KEY is not set on the server"});
  const island = req.params.island;
  const atoll = req.query.atoll;
  const db = req.db;
  if(!atoll) return res.status(400).json({error:"atoll is required — island names can repeat across atolls, so this disambiguates which one to sync"});
  const atollEntry = db.atolls.find(a => a.atoll === atoll);
  if(!atollEntry || !atollEntry.islands.includes(island)) return res.status(400).json({error:"Unknown island for that atoll"});
  const { added, skippedMismatch } = await syncIslandGoogle(db, atoll, island);
  await dbWrite(db);
  res.json({ added, skippedMismatch });
}));

// Syncs every island in one call — the comprehensive "list everything on the
// internet" pass. Takes longer (one Places call per island per category) and
// each call counts against your Google billing, so this is admin-triggered
// rather than automatic. Iterates atoll-by-atoll so same-named islands in
// different atolls each get their own correctly-scoped search.
app.post("/api/admin/sync-google-all", requireAdmin, h(async (req, res) => {
  if(!GOOGLE_PLACES_API_KEY) return res.status(400).json({error:"GOOGLE_PLACES_API_KEY is not set on the server"});
  const db = req.db;
  const perIsland = {};
  let totalSkippedMismatch = 0;
  for(const atollEntry of db.atolls){
    for(const island of atollEntry.islands){
      const r = await syncIslandGoogle(db, atollEntry.atoll, island);
      perIsland[syncKey(atollEntry.atoll, island)] = r.added;
      totalSkippedMismatch += r.skippedMismatch;
    }
  }
  await dbWrite(db);
  res.json({ perIsland, totalAdded: Object.values(perIsland).reduce((a,b)=>a+b,0), totalSkippedMismatch });
}));

// Removes every Google-sourced business and resets the sync cache/duplicate
// flags, so a fresh "Sync ALL islands" run starts clean — useful after the
// sync logic itself changes (like the atoll-disambiguation fix above), since
// old entries synced under the previous logic could be mis-attributed.
// Owner-listed businesses, business accounts, and events are never touched.
app.post("/api/admin/google-data/clear", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const before = db.businesses.length;
  db.businesses = db.businesses.filter(b => b.source !== "google");
  const removed = before - db.businesses.length;
  const unmatchedRemoved = db.unmatchedGoogle.length;
  db.googleSyncCache = {};
  db.duplicateFlags = [];
  db.unmatchedGoogle = [];
  await dbWrite(db);
  res.json({ removed, unmatchedRemoved });
}));

// Places the sync found but skipped because their real address didn't match
// the island being searched — kept here instead of discarded so an admin can
// either assign them to the island they actually belong to, or discard them.
app.get("/api/admin/unmatched", requireAdmin, h(async (req, res) => {
  res.json(req.db.unmatchedGoogle);
}));

app.post("/api/admin/unmatched/:id/assign", requireAdmin, h(async (req, res) => {
  const db = req.db;
  const island = req.body.island;
  const idx = db.unmatchedGoogle.findIndex(u => u.id === req.params.id);
  if(idx === -1) return res.status(404).json({error:"Not found"});
  if(!island || !flattenIslands(db.atolls).includes(island)) return res.status(400).json({error:"Unknown island"});
  const u = db.unmatchedGoogle[idx];
  const alreadyExists = db.businesses.find(b => b.googlePlaceId === u.googlePlaceId);
  if(!alreadyExists){
    db.businesses.push({
      id: genId("g"), name: u.name, category: u.category, island,
      desc: u.desc, price:"", contact: u.contact || "", ownerEmail:null,
      verified:false, source:"google", googlePlaceId: u.googlePlaceId
    });
  }
  db.unmatchedGoogle.splice(idx, 1);
  await dbWrite(db);
  res.json({ ok:true, alreadyExisted: !!alreadyExists });
}));

app.delete("/api/admin/unmatched/:id", requireAdmin, h(async (req, res) => {
  const db = req.db;
  db.unmatchedGoogle = db.unmatchedGoogle.filter(u => u.id !== req.params.id);
  await dbWrite(db);
  res.json({ ok:true });
}));

// Fetches one place's contact number directly, bypassing the text-search
// dedup that skips places already synced by place_id — needed to backfill
// phone numbers onto listings synced before the field mask included them.
async function placeContactDetails(placeId){
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "nationalPhoneNumber,internationalPhoneNumber"
    }
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    const msg = (data.error && data.error.message) || res.statusText;
    throw new Error(`Google Places returned ${res.status}: ${msg}`);
  }
  return data.internationalPhoneNumber || data.nationalPhoneNumber || "";
}

// Backfills contact numbers onto Google-sourced listings that don't have one
// yet (most commonly: everything synced before the field mask requested
// phone numbers). One Place Details call per listing, so this costs Google
// API usage proportional to how many are missing a number — the response
// tells you how many were actually updated vs. how many Google simply
// doesn't have a number for.
app.post("/api/admin/google-data/backfill-contacts", requireAdmin, h(async (req, res) => {
  if(!GOOGLE_PLACES_API_KEY) return res.status(400).json({error:"GOOGLE_PLACES_API_KEY is not set on the server"});
  const db = req.db;
  const targets = db.businesses.filter(b => b.source === "google" && b.googlePlaceId && !b.contact);
  let updated = 0, noNumberFound = 0, failed = 0;
  for(const b of targets){
    try{
      const phone = await placeContactDetails(b.googlePlaceId);
      if(phone){ b.contact = phone; updated++; } else { noNumberFound++; }
    }catch(e){ failed++; }
  }
  await dbWrite(db);
  res.json({ checked: targets.length, updated, noNumberFound, failed });
}));

// Uses Places API (New) — Google's current text search product, not the
// legacy "Places API". These are two separate things to enable/restrict in
// Google Cloud; this app only ever calls the New one.
//
// Field mask note: id/displayName/formattedAddress are Google's "Basic Data"
// tier; nationalPhoneNumber/internationalPhoneNumber are "Contact Data" —
// billed at a higher per-request rate by Google. Requesting them is what
// makes contact numbers actually show up on synced listings; check Google's
// current Places API pricing if sync volume grows, since this raises the
// cost of every search call, not just ones that end up with a phone number.
async function placesTextSearch(query){
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber"
    },
    body: JSON.stringify({ textQuery: query })
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    const msg = (data.error && data.error.message) || res.statusText;
    throw new Error(`Google Places returned ${res.status}: ${msg}`);
  }
  return data.places || [];
}

// health check — handy for Render, and for confirming the DB connection came up
app.get("/api/health", h(async (req, res) => {
  await dbRead();
  res.json({ ok:true });
}));

ensureTable()
  .then(() => app.listen(PORT, () => console.log("Atoll Isle API listening on " + PORT)))
  .catch(err => { console.error("Failed to connect to Postgres:", err); process.exit(1); });
