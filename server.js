require("dotenv").config();
const express=require("express"), path=require("path"), crypto=require("crypto");
const bcrypt=require("bcryptjs"), jwt=require("jsonwebtoken"), helmet=require("helmet");
const rateLimit=require("express-rate-limit"), Database=require("better-sqlite3");
const Razorpay=require("razorpay");
const app=express(), db=new Database(process.env.DB_FILE||"quenic.sqlite");
const PORT=process.env.PORT||3000, JWT_SECRET=process.env.JWT_SECRET;
if(!JWT_SECRET || JWT_SECRET.length<32) { console.error("Set JWT_SECRET to a random string of at least 32 characters in .env"); process.exit(1); }
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"200kb"}));
app.use(express.static(path.join(__dirname,"public")));
app.use("/api/",rateLimit({windowMs:15*60*1000,max:250,standardHeaders:true,legacyHeaders:false}));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, password_hash TEXT, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT DEFAULT '', price INTEGER NOT NULL, image TEXT DEFAULT '', available INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, order_code TEXT UNIQUE NOT NULL, user_id INTEGER, customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, notes TEXT DEFAULT '', payment_method TEXT NOT NULL, payment_status TEXT DEFAULT 'pending', status TEXT DEFAULT 'Pending', subtotal INTEGER NOT NULL, delivery_fee INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, total INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER, product_name TEXT NOT NULL, unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS coupons(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, percent INTEGER NOT NULL, active INTEGER DEFAULT 1, min_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
`);
// Optional one-time admin provisioning through Render environment variables.
// Set ADMIN_NAME, ADMIN_PHONE and ADMIN_PASSWORD in Render; never hard-code credentials.
(async()=>{
 const adminName=String(process.env.ADMIN_NAME||"").trim();
 const adminPhone=String(process.env.ADMIN_PHONE||"").replace(/\D/g,"");
 const adminPassword=String(process.env.ADMIN_PASSWORD||"");
 if(adminName||adminPhone||adminPassword){
  if(!adminName||adminPhone.length!==10||adminPassword.length<12){
   console.error("Admin setup skipped: set ADMIN_NAME, a 10-digit ADMIN_PHONE, and ADMIN_PASSWORD (12+ characters) together.");
  } else {
   const passwordHash=await bcrypt.hash(adminPassword,12);
   db.prepare(`INSERT INTO users(name,phone,password_hash,role) VALUES(?,?,?,'admin')
    ON CONFLICT(phone) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,role='admin'`)
    .run(adminName,adminPhone,passwordHash);
   console.log("Admin account provisioned from environment variables.");
  }
 }
})();
try{db.exec("ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT")}catch(e){if(!String(e.message).includes("duplicate column"))throw e}
const count=db.prepare("SELECT COUNT(*) n FROM products").get().n;
if(!count){
 const ins=db.prepare("INSERT INTO products(name,category,description,price,image) VALUES(?,?,?,?,?)");
 [
 ["Classic Burger","Burgers","A juicy classic burger.",9900,"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=700"],
 ["Cheese Burger","Burgers","Burger with a cheesy twist.",12900,"https://images.unsplash.com/photo-1553979459-d2229ba7433a?w=700"],
 ["Margherita Pizza","Pizza","Cheese, tomato and crisp base.",17900,"https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=700"],
 ["Farmhouse Pizza","Pizza","Veggie toppings on a delicious base.",22900,"https://images.unsplash.com/photo-1513104890138-7c749659a591?w=700"],
 ["French Fries","Sides","Golden and crispy.",7900,"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=700"],
 ["Veg Sandwich","Sandwiches","Fresh vegetables and toasted bread.",8900,"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=700"],
 ["Cold Coffee","Drinks","Chilled coffee.",9900,"https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=700"],
 ["Chocolate Shake","Drinks","Creamy chocolate shake.",11900,"https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=700"]
 ].forEach(x=>ins.run(...x));
}
db.prepare("INSERT OR IGNORE INTO coupons(code,percent,min_order) VALUES('WELCOME10',10,0)").run();
function tokenFor(u){return jwt.sign({id:u.id,role:u.role,name:u.name},JWT_SECRET,{expiresIn:"12h"});}
function auth(req,res,next){
 const h=req.headers.authorization||"", t=h.startsWith("Bearer ")?h.slice(7):"";
 try{req.user=jwt.verify(t,JWT_SECRET);next()}catch{return res.status(401).json({error:"Please log in again."})}
}
function roles(...allowed){return (req,res,next)=>{if(!allowed.includes(req.user.role))return res.status(403).json({error:"Not allowed"});next()}}
const cleanPhone=s=>String(s||"").replace(/\D/g,"");
app.get("/api/health",(req,res)=>res.json({ok:true,service:"Quenic Fast Food API"}));
const defaultSettings={store_name:"Quenic Fast Food",phone:"",address:"Rath, Hamirpur, Uttar Pradesh, India",hours:"",delivery_fee_paise:String(Number(process.env.DELIVERY_FEE_PAISE||0)),delivery_note:""};
function getSettings(){const rows=db.prepare("SELECT key,value FROM settings").all();return {...defaultSettings,...Object.fromEntries(rows.map(x=>[x.key,x.value]))};}
app.get("/api/settings",(req,res)=>res.json({...getSettings(),razorpay_enabled:!!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)}));
app.patch("/api/admin/settings",auth,roles("admin"),(req,res)=>{
 const allowed=["store_name","phone","address","hours","delivery_fee_paise","delivery_note"];
 const up=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 for(const k of allowed) if(req.body?.[k]!==undefined){const v=String(req.body[k]).trim();if(k==="delivery_fee_paise"&&(!/^\\d+$/.test(v)||Number(v)>1000000))return res.status(400).json({error:"Invalid delivery fee"});up.run(k,v.slice(0,300));}
 res.json(getSettings());
});
app.get("/api/products",(req,res)=>{
 const rows=db.prepare("SELECT id,name,category,description,price,image,available FROM products WHERE available=1 ORDER BY category,name").all();
 res.json(rows);
});
app.post("/api/auth/register",async(req,res)=>{
 const {name,phone,password}=req.body||{}, p=cleanPhone(phone);
 if(!name||p.length!==10||!password||password.length<8)return res.status(400).json({error:"Name, valid 10-digit phone and password (8+ chars) required."});
 try{
 const hash=await bcrypt.hash(password,12);
 const r=db.prepare("INSERT INTO users(name,phone,password_hash,role) VALUES(?,?,?,'customer')").run(String(name).slice(0,80),p,hash);
 const u=db.prepare("SELECT id,name,phone,role FROM users WHERE id=?").get(r.lastInsertRowid);
 res.status(201).json({token:tokenFor(u),user:u});
 }catch(e){res.status(409).json({error:"This phone number may already be registered."})}
});
app.post("/api/auth/login",async(req,res)=>{
 const p=cleanPhone(req.body?.phone), u=db.prepare("SELECT * FROM users WHERE phone=?").get(p);
 if(!u||!u.password_hash||!(await bcrypt.compare(String(req.body?.password||""),u.password_hash)))return res.status(401).json({error:"Invalid phone or password."});
 res.json({token:tokenFor(u),user:{id:u.id,name:u.name,phone:u.phone,role:u.role}});
});
app.get("/api/me",auth,(req,res)=>res.json(req.user));
app.post("/api/orders",auth,roles("customer"),(req,res)=>{
 const {items,address,notes,paymentMethod,couponCode}=req.body||{};
 if(!Array.isArray(items)||!items.length||items.length>30||!address||String(address).length<8)return res.status(400).json({error:"Cart and complete delivery address are required."});
 const normalized=[];
 for(const item of items){
  const id=Number(item.productId),qty=Number(item.quantity),p=db.prepare("SELECT id,name,price,available FROM products WHERE id=?").get(id);
  if(!p||!p.available||!Number.isInteger(qty)||qty<1||qty>20)return res.status(400).json({error:"One of the selected items is unavailable or has an invalid quantity."});
  normalized.push({p,qty});
 }
 const subtotal=normalized.reduce((s,x)=>s+x.p.price*x.qty,0);
 const coupon=db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(String(couponCode||"").toUpperCase());
 const discount=coupon&&subtotal>=coupon.min_order?Math.floor(subtotal*coupon.percent/100):0;
 const deliveryFee=Number(getSettings().delivery_fee_paise||process.env.DELIVERY_FEE_PAISE||0),total=subtotal-discount+deliveryFee;
 const method=paymentMethod==="online"?"online":"cod";
 const code="QF"+Date.now().toString().slice(-8)+crypto.randomBytes(2).toString("hex").toUpperCase();
 const tx=db.transaction(()=>{
  const r=db.prepare(`INSERT INTO orders(order_code,user_id,customer_name,phone,address,notes,payment_method,subtotal,delivery_fee,discount,total)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(code,req.user.id,req.user.name,db.prepare("SELECT phone FROM users WHERE id=?").get(req.user.id).phone,String(address).slice(0,500),String(notes||"").slice(0,300),method,subtotal,deliveryFee,discount,total);
  const ins=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity) VALUES(?,?,?,?,?)");
  normalized.forEach(x=>ins.run(r.lastInsertRowid,x.p.id,x.p.name,x.p.price,x.qty));
  return r.lastInsertRowid;
 });
 const id=tx();
 res.status(201).json({id,orderCode:code,total,paymentMethod:method,paymentStatus:"pending",message:"Order created. Store will confirm it shortly."});
});
app.get("/api/orders/mine",auth,roles("customer"),(req,res)=>{
 const rows=db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50").all(req.user.id);
 res.json(rows.map(o=>({...o,items:db.prepare("SELECT product_name,unit_price,quantity FROM order_items WHERE order_id=?").all(o.id)})));
});
app.get("/api/orders/:code",auth,(req,res)=>{
 const o=db.prepare("SELECT * FROM orders WHERE order_code=?").get(req.params.code);
 if(!o || (req.user.role==="customer"&&o.user_id!==req.user.id))return res.status(404).json({error:"Order not found"});
 res.json({...o,items:db.prepare("SELECT product_name,unit_price,quantity FROM order_items WHERE order_id=?").all(o.id)});
});
app.post("/api/payments/create-order",auth,roles("customer"),async(req,res)=>{
 if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:"Online payments are not configured yet. Please choose Cash on Delivery."});
 const {orderCode}=req.body||{},o=db.prepare("SELECT * FROM orders WHERE order_code=? AND user_id=?").get(orderCode,req.user.id);
 if(!o||o.payment_method!=="online")return res.status(404).json({error:"Online payment order not found."});
 const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
 try{const payment=await rz.orders.create({amount:o.total,currency:"INR",receipt:o.order_code});db.prepare("UPDATE orders SET razorpay_order_id=? WHERE id=?").run(payment.id,o.id);res.json({id:payment.id,amount:payment.amount,currency:payment.currency,keyId:process.env.RAZORPAY_KEY_ID})}
 catch(e){res.status(502).json({error:"Could not start payment. Try COD or contact the store."})}
});
app.post("/api/payments/verify",auth,roles("customer"),async(req,res)=>{
 const {orderCode,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body||{};
 if(!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:"Payment gateway not configured."});
 const o=db.prepare("SELECT * FROM orders WHERE order_code=? AND user_id=?").get(orderCode,req.user.id);
 if(!o||o.payment_method!=="online"||!o.razorpay_order_id||o.razorpay_order_id!==razorpay_order_id)return res.status(404).json({error:"Matching online order not found."});
 const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
 const received=String(razorpay_signature||"");
 if(received.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(received)))return res.status(400).json({error:"Payment verification failed."});
 try{
  const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
  const payment=await rz.payments.fetch(razorpay_payment_id);
  if(payment.order_id!==o.razorpay_order_id||payment.amount!==o.total||payment.currency!=="INR"||payment.status!=="captured")return res.status(400).json({error:"Payment is not captured for the exact order amount."});
  db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(o.id);
  res.json({ok:true,paymentStatus:"paid"});
 }catch(e){res.status(502).json({error:"Could not confirm payment with gateway. Contact the store before retrying."})}
});
app.get("/api/admin/summary",auth,roles("admin","kitchen","delivery"),(req,res)=>{
 const orders=db.prepare("SELECT COUNT(*) count,COALESCE(SUM(total),0) sales FROM orders").get();
 const pending=db.prepare("SELECT COUNT(*) count FROM orders WHERE status IN ('Pending','Accepted','Preparing','Ready','Out for Delivery')").get();
 res.json({orders:orders.count,sales:orders.sales,pending:pending.count,products:db.prepare("SELECT COUNT(*) count FROM products").get().count});
});
app.get("/api/admin/orders",auth,roles("admin","kitchen","delivery"),(req,res)=>{
 let rows=db.prepare("SELECT * FROM orders "+(req.user.role==="kitchen"?"WHERE status IN ('Accepted','Preparing','Ready')":req.user.role==="delivery"?"WHERE status IN ('Ready','Out for Delivery')":"")+" ORDER BY id DESC LIMIT 200").all();
 res.json(rows.map(o=>({...o,items:db.prepare("SELECT product_name,unit_price,quantity FROM order_items WHERE order_id=?").all(o.id)})));
});
app.patch("/api/admin/orders/:id/status",auth,roles("admin","kitchen","delivery"),(req,res)=>{
 const allowed={admin:["Accepted","Preparing","Ready","Out for Delivery","Delivered","Cancelled"],kitchen:["Preparing","Ready"],delivery:["Out for Delivery","Delivered"]}[req.user.role];
 if(!allowed.includes(req.body?.status))return res.status(400).json({error:"Status is not permitted for this role."});
 const r=db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,Number(req.params.id));
 res.json({ok:r.changes>0});
});
app.get("/api/admin/products",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all()));
app.post("/api/admin/products",auth,roles("admin"),(req,res)=>{
 const {name,category,description,price,image}=req.body||{};
 if(!name||!category||!Number.isInteger(Number(price))||Number(price)<1)return res.status(400).json({error:"Name, category and price in paise are required."});
 const r=db.prepare("INSERT INTO products(name,category,description,price,image) VALUES(?,?,?,?,?)").run(String(name).slice(0,100),String(category).slice(0,60),String(description||"").slice(0,300),Number(price),String(image||"").slice(0,1000));
 res.status(201).json({id:r.lastInsertRowid});
});
app.patch("/api/admin/products/:id",auth,roles("admin"),(req,res)=>{
 const {available,price}=req.body||{};
 if(available!==undefined)db.prepare("UPDATE products SET available=? WHERE id=?").run(available?1:0,Number(req.params.id));
 if(price!==undefined&&Number.isInteger(Number(price))&&Number(price)>0)db.prepare("UPDATE products SET price=? WHERE id=?").run(Number(price),Number(req.params.id));
 res.json({ok:true});
});
app.delete("/api/admin/products/:id",auth,roles("admin"),(req,res)=>{db.prepare("DELETE FROM products WHERE id=?").run(Number(req.params.id));res.json({ok:true})});
app.post("/api/admin/coupons",auth,roles("admin"),(req,res)=>{
 const {code,percent,minOrder=0}=req.body||{};
 if(!code||!Number.isInteger(Number(percent))||percent<1||percent>80)return res.status(400).json({error:"Enter a coupon code and discount between 1 and 80%."});
 try{db.prepare("INSERT INTO coupons(code,percent,min_order) VALUES(?,?,?)").run(String(code).toUpperCase(),Number(percent),Number(minOrder));res.status(201).json({ok:true})}catch{res.status(409).json({error:"Coupon already exists."})}
});
app.get("/api/admin/coupons",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT * FROM coupons").all()));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Quenic Fast Food running on http://localhost:${PORT}`));
