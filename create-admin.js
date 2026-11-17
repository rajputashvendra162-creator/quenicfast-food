require("dotenv").config();
const Database=require("better-sqlite3"),bcrypt=require("bcryptjs"),readline=require("readline");
const db=new Database(process.env.DB_FILE||"quenic.sqlite");
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,password_hash TEXT,role TEXT NOT NULL DEFAULT 'customer',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(r=>rl.question(q,r));
(async()=>{
 const name=await ask("Admin name: "),phone=(await ask("Admin 10-digit phone: ")).replace(/\D/g,""),pass=await ask("Strong admin password (12+ chars): ");
 if(phone.length!==10||pass.length<12){console.log("Invalid phone or password too short.");rl.close();process.exit(1)}
 const hash=await bcrypt.hash(pass,12);
 try{db.prepare("INSERT INTO users(name,phone,password_hash,role) VALUES(?,?,?,'admin')").run(name,phone,hash);console.log("Admin account created. Keep the password private.");}
 catch{console.log("That phone is already registered. Use a different phone or update its role securely in the database.");}
 rl.close();db.close();
})();
