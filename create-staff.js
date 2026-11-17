require("dotenv").config();
const Database=require("better-sqlite3"),bcrypt=require("bcryptjs"),readline=require("readline");
const db=new Database(process.env.DB_FILE||"quenic.sqlite");
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(resolve=>rl.question(q,resolve));
(async()=>{try{
 const name=await ask("Staff name: "),phone=(await ask("10-digit phone: ")).replace(/\\D/g,"");
 const role=(await ask("Role (kitchen/delivery): ")).trim().toLowerCase();
 const pass=await ask("Password (12+ chars): ");
 if(phone.length!==10||!["kitchen","delivery"].includes(role)||pass.length<12)throw Error("Invalid phone, role, or password.");
 const hash=await bcrypt.hash(pass,12);
 db.prepare("INSERT INTO users(name,phone,password_hash,role) VALUES(?,?,?,?)").run(name.slice(0,80),phone,hash,role);
 console.log(role+" account created. Keep credentials private.");
}catch(e){console.error(e.message)}finally{rl.close();db.close()}})();
