const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME_IN_PRODUCTION";

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "gamevault.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 trust REAL NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 game TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT DEFAULT '',
 price REAL NOT NULL,
 level TEXT DEFAULT '',
 region TEXT DEFAULT 'Global',
 status TEXT NOT NULL DEFAULT 'active',
 views INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS offers(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 listing_id INTEGER NOT NULL,
 buyer_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 note TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS favorites(
 user_id INTEGER NOT NULL,
 listing_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, listing_id)
);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL,
 receiver_id INTEGER NOT NULL,
 listing_id INTEGER,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 seller_id INTEGER NOT NULL,
 buyer_id INTEGER NOT NULL,
 rating INTEGER NOT NULL,
 comment TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 action TEXT NOT NULL,
 meta TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

function ensureAdmin(){
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(ADMIN_EMAIL);
  if(!existing){
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
    db.prepare("INSERT INTO users(name,email,password_hash,role,trust) VALUES(?,?,?,?,?)")
      .run("GameVault Admin", ADMIN_EMAIL, hash, "admin", 100);
  }
}
ensureAdmin();

function tokenFor(user){ return jwt.sign({id:user.id, role:user.role, email:user.email}, JWT_SECRET, {expiresIn:"7d"}); }
function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Giriş gerekli"});
  try { req.user=jwt.verify(h.slice(7),JWT_SECRET); next(); }
  catch { return res.status(401).json({error:"Oturum geçersiz"}); }
}
function admin(req,res,next){ if(req.user?.role!=="admin") return res.status(403).json({error:"Yetki gerekli"}); next(); }
function log(userId, action, meta=""){ db.prepare("INSERT INTO audit_logs(user_id,action,meta) VALUES(?,?,?)").run(userId||null,action,meta); }

app.get("/api/health",(req,res)=>res.json({ok:true,service:"gamevault",time:new Date().toISOString()}));

app.post("/api/register",(req,res)=>{
  const {name,email,password}=req.body||{};
  if(!name||!email||!password||password.length<8) return res.status(400).json({error:"Ad, e-posta ve en az 8 karakter şifre gerekli"});
  const exists=db.prepare("SELECT id FROM users WHERE email=?").get(email.toLowerCase().trim());
  if(exists) return res.status(409).json({error:"Bu e-posta zaten kayıtlı"});
  const hash=bcrypt.hashSync(password,12);
  const info=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name.trim(),email.toLowerCase().trim(),hash);
  const user=db.prepare("SELECT id,name,email,role,trust FROM users WHERE id=?").get(info.lastInsertRowid);
  log(user.id,"register");
  res.json({user,token:tokenFor(user)});
});

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body||{};
  const user=db.prepare("SELECT * FROM users WHERE email=?").get((email||"").toLowerCase().trim());
  if(!user||!bcrypt.compareSync(password||"",user.password_hash)) return res.status(401).json({error:"E-posta veya şifre hatalı"});
  const safe={id:user.id,name:user.name,email:user.email,role:user.role,trust:user.trust};
  log(user.id,"login");
  res.json({user:safe,token:tokenFor(user)});
});

app.get("/api/me",auth,(req,res)=>{
  const u=db.prepare("SELECT id,name,email,role,trust,created_at FROM users WHERE id=?").get(req.user.id);
  res.json({user:u});
});

app.get("/api/listings",(req,res)=>{
  const {q="",game="",region="",sort="new"}=req.query;
  let sql=`SELECT l.*,u.name seller,u.trust FROM listings l JOIN users u ON u.id=l.user_id WHERE l.status='active'`;
  const args=[];
  if(q){sql+=" AND (l.title LIKE ? OR l.description LIKE ? OR l.game LIKE ?)"; const x="%"+q+"%"; args.push(x,x,x);}
  if(game){sql+=" AND l.game=?";args.push(game);}
  if(region){sql+=" AND l.region=?";args.push(region);}
  sql += sort==="price_asc"?" ORDER BY l.price ASC":sort==="price_desc"?" ORDER BY l.price DESC":" ORDER BY l.created_at DESC";
  res.json({listings:db.prepare(sql).all(...args)});
});

app.get("/api/listings/:id",(req,res)=>{
  const item=db.prepare(`SELECT l.*,u.name seller,u.trust FROM listings l JOIN users u ON u.id=l.user_id WHERE l.id=?`).get(req.params.id);
  if(!item) return res.status(404).json({error:"İlan bulunamadı"});
  db.prepare("UPDATE listings SET views=views+1 WHERE id=?").run(req.params.id);
  res.json({listing:item});
});

app.post("/api/listings",auth,(req,res)=>{
  const {game,title,description,price,level,region}=req.body||{};
  if(!game||!title||!Number.isFinite(Number(price))||Number(price)<=0) return res.status(400).json({error:"Oyun, başlık ve geçerli fiyat gerekli"});
  const info=db.prepare(`INSERT INTO listings(user_id,game,title,description,price,level,region) VALUES(?,?,?,?,?,?,?)`)
    .run(req.user.id,game,title,description||"",Number(price),level||"",region||"Global");
  log(req.user.id,"listing_created",`listing=${info.lastInsertRowid}`);
  res.json({id:info.lastInsertRowid});
});

app.post("/api/offers",auth,(req,res)=>{
  const {listingId,amount,note}=req.body||{};
  const listing=db.prepare("SELECT * FROM listings WHERE id=? AND status='active'").get(listingId);
  if(!listing) return res.status(404).json({error:"Aktif ilan bulunamadı"});
  if(listing.user_id===req.user.id) return res.status(400).json({error:"Kendi ilanına teklif veremezsin"});
  if(!Number.isFinite(Number(amount))||Number(amount)<=0) return res.status(400).json({error:"Geçerli teklif gir"});
  const info=db.prepare("INSERT INTO offers(listing_id,buyer_id,amount,note) VALUES(?,?,?,?)").run(listingId,req.user.id,Number(amount),note||"");
  log(req.user.id,"offer_created",`offer=${info.lastInsertRowid}`);
  res.json({id:info.lastInsertRowid});
});

app.get("/api/me/listings",auth,(req,res)=>res.json({listings:db.prepare("SELECT * FROM listings WHERE user_id=? ORDER BY created_at DESC").all(req.user.id)}));
app.get("/api/me/offers",auth,(req,res)=>res.json({offers:db.prepare(`SELECT o.*,l.title,l.game FROM offers o JOIN listings l ON l.id=o.listing_id WHERE o.buyer_id=? ORDER BY o.created_at DESC`).all(req.user.id)}));

app.post("/api/favorites/:listingId",auth,(req,res)=>{
  const id=Number(req.params.listingId);
  const exists=db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?").get(req.user.id,id);
  if(exists) db.prepare("DELETE FROM favorites WHERE user_id=? AND listing_id=?").run(req.user.id,id);
  else db.prepare("INSERT INTO favorites(user_id,listing_id) VALUES(?,?)").run(req.user.id,id);
  res.json({favorite:!exists});
});

app.get("/api/me/favorites",auth,(req,res)=>res.json({favorites:db.prepare(`SELECT l.*,u.name seller,u.trust FROM favorites f JOIN listings l ON l.id=f.listing_id JOIN users u ON u.id=l.user_id WHERE f.user_id=?`).all(req.user.id)}));

app.post("/api/messages",auth,(req,res)=>{
  const {receiverId,listingId,body}=req.body||{};
  if(!receiverId||!body?.trim()) return res.status(400).json({error:"Alıcı ve mesaj gerekli"});
  const info=db.prepare("INSERT INTO messages(sender_id,receiver_id,listing_id,body) VALUES(?,?,?,?)").run(req.user.id,receiverId,listingId||null,body.trim());
  res.json({id:info.lastInsertRowid});
});

app.get("/api/messages/:userId",auth,(req,res)=>{
  const other=Number(req.params.userId);
  const rows=db.prepare(`SELECT m.*,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE (m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?) ORDER BY m.created_at`).all(req.user.id,other,other,req.user.id);
  res.json({messages:rows});
});

app.post("/api/reviews",auth,(req,res)=>{
  const {sellerId,rating,comment}=req.body||{};
  if(!sellerId||!Number.isInteger(Number(rating))||rating<1||rating>5) return res.status(400).json({error:"1-5 arası puan gerekli"});
  db.prepare("INSERT INTO reviews(seller_id,buyer_id,rating,comment) VALUES(?,?,?,?)").run(sellerId,req.user.id,Number(rating),comment||"");
  const avg=db.prepare("SELECT AVG(rating) a FROM reviews WHERE seller_id=?").get(sellerId).a||0;
  db.prepare("UPDATE users SET trust=? WHERE id=?").run(Math.round(avg*20),sellerId);
  res.json({ok:true});
});

app.get("/api/admin/stats",auth,admin,(req,res)=>{
  const stats={
    users:db.prepare("SELECT COUNT(*) n FROM users").get().n,
    listings:db.prepare("SELECT COUNT(*) n FROM listings").get().n,
    activeListings:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active'").get().n,
    offers:db.prepare("SELECT COUNT(*) n FROM offers").get().n,
    messages:db.prepare("SELECT COUNT(*) n FROM messages").get().n,
    favorites:db.prepare("SELECT COUNT(*) n FROM favorites").get().n
  };
  res.json({stats});
});

app.get("/api/admin/listings",auth,admin,(req,res)=>res.json({listings:db.prepare(`SELECT l.*,u.email seller_email FROM listings l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 200`).all()}));
app.patch("/api/admin/listings/:id",auth,admin,(req,res)=>{
  const status=["active","paused","sold","rejected"].includes(req.body?.status)?req.body.status:null;
  if(!status) return res.status(400).json({error:"Geçersiz durum"});
  db.prepare("UPDATE listings SET status=? WHERE id=?").run(status,req.params.id);
  log(req.user.id,"admin_listing_status",`listing=${req.params.id};status=${status}`);
  res.json({ok:true});
});

app.get("/api/admin/logs",auth,admin,(req,res)=>res.json({logs:db.prepare("SELECT a.*,u.email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200").all()}));

app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT,()=>console.log(`GameVault running on http://localhost:${PORT}`));
