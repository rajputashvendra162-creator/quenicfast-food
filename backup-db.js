require("dotenv").config();
const Database=require("better-sqlite3"),fs=require("fs"),path=require("path");
const source=process.env.DB_FILE||"quenic.sqlite";
if(!fs.existsSync(source)){console.error("Database file not found:",source);process.exit(1)}
const db=new Database(source);
const dest=path.resolve("backups");fs.mkdirSync(dest,{recursive:true});
const name="quenic-"+new Date().toISOString().replace(/[:.]/g,"-")+".sqlite";
db.backup(path.join(dest,name)).then(()=>{console.log("Backup saved:",path.join(dest,name));db.close()}).catch(e=>{console.error(e);db.close();process.exit(1)});
