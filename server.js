require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const session = require('express-session');
const cron = require('node-cron');
const soap = require('soap');
const db = require('./services/db');
const authService = require('./services/auth-service');
const inventory = require('./services/inventory-service');
const orders = require('./services/order-service');
const notifications = require('./services/notification-service');
const aiService = require('./services/ai-service');
const paymentService = require('./services/payment-service');
const management = require('./services/management-service');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) { console.error('SESSION_SECRET must be set in production.'); process.exit(1); }
const app = express();
const PORT = Number(process.env.PORT || 3000);
app.set('trust proxy', 1);
app.use(cors({ origin:true, credentials:true }));
app.use(express.json({ limit:'5mb' }));
app.use(session({
  name:'makeup.sid', secret:process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave:false, saveUninitialized:false,
  cookie:{ httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:8*60*60*1000 }
}));
app.use(express.static(path.join(__dirname), { index:'index.html' }));

function requireLogin(req,res,next) { if (!req.session.user) return res.status(401).json({success:false,message:'Please sign in first.'}); next(); }
function requireAdmin(req,res,next) { if (!req.session.user) return res.status(401).json({success:false,message:'Please sign in first.'}); if(req.session.user.role!=='admin') return res.status(403).json({success:false,message:'Administrator role required.'}); next(); }
const ok = (res,data,message='Success') => res.json({success:true,message,data});
const fail = (res,e,status=400) => res.status(status).json({success:false,message:e.message || 'Request failed'});

// Authentication service module
app.post('/api/auth/login', async (req,res) => {
  try { const user=await authService.login(req.body.email,req.body.password); if(!user) return res.status(401).json({success:false,message:'Email or password is incorrect.'}); req.session.user=user; ok(res,user,'Signed in successfully.'); }
  catch(e){ console.error(e); fail(res,e,500); }
});
app.get('/api/auth/me',(req,res)=> req.session.user ? ok(res,req.session.user) : res.status(401).json({success:false,message:'Not signed in.'}));
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('makeup.sid');ok(res,null,'Signed out.');}));

// Product/inventory service module; public read endpoints keep the existing storefront compatible.
app.get('/api/products', async(req,res)=>{try{ok(res,await inventory.listProducts())}catch(e){fail(res,e,500)}});
app.get('/api/products/:id',async(req,res)=>{try{const p=await inventory.getProduct(req.params.id);p?ok(res,p):res.status(404).json({success:false,message:'Product not found'})}catch(e){fail(res,e,500)}});
app.post('/api/products',requireAdmin,async(req,res)=>{try{const {name,code,price,stock}=req.body;if(!name||!code||price===undefined)return res.status(400).json({success:false,message:'name, code and price are required'});ok(res,await inventory.createProduct(req.body),'Product added.')}catch(e){fail(res,e,[2601,2627].includes(Number(e.number))?409:400)}});
app.put('/api/products/:id',requireAdmin,async(req,res)=>{try{const p=await inventory.updateProduct(req.params.id,req.body);p?ok(res,p,'Product updated.'):res.status(404).json({success:false,message:'Product not found'})}catch(e){fail(res,e,[2601,2627].includes(Number(e.number))?409:400)}});
app.delete('/api/products/:id',requireAdmin,async(req,res)=>{try{const done=await inventory.deleteProduct(req.params.id);done?ok(res,null,'Product deleted.'):res.status(404).json({success:false,message:'Product not found'})}catch(e){fail(res,e,400)}});
app.post('/api/products/update-stock',requireAdmin,async(req,res)=>{try{const p=await inventory.updateProduct(req.body.productId,{stock:req.body.quantity});p?ok(res,p,'Stock updated.'):res.status(404).json({success:false,message:'Product not found'})}catch(e){fail(res,e)}});
app.get('/api/inventory/batches',requireLogin,async(req,res)=>{try{ok(res,await inventory.listBatches(req.query.productId))}catch(e){fail(res,e,500)}});
app.post('/api/inventory/batches',requireAdmin,async(req,res)=>{try{ok(res,await inventory.addBatch(req.body),'Inventory batch created.')}catch(e){fail(res,e)}});
app.get('/api/inventory/expiry-alerts',requireLogin,async(req,res)=>{try{ok(res,await notifications.getAlerts(req.query.days))}catch(e){fail(res,e,500)}});
app.post('/api/inventory/send-expiry-alerts',requireAdmin,async(req,res)=>{try{ok(res,await notifications.sendExpiryAlerts(req.body.days),'Expiry alert check completed.')}catch(e){fail(res,e,500)}});

// Management services: categories, brands, suppliers, customers and dashboard.
for (const resource of ['categories','brands','suppliers','customers']) {
  app.get(`/api/${resource}`, requireAdmin, async(req,res)=>{try{ok(res,await management.list(resource));}catch(e){fail(res,e,500);}});
  app.post(`/api/${resource}`, requireAdmin, async(req,res)=>{try{ok(res,await management.save(resource,null,req.body),'Created.');}catch(e){fail(res,e,400);}});
  app.put(`/api/${resource}/:id`, requireAdmin, async(req,res)=>{try{ok(res,await management.save(resource,req.params.id,req.body),'Updated.');}catch(e){fail(res,e,400);}});
  app.delete(`/api/${resource}/:id`, requireAdmin, async(req,res)=>{try{const removed=await management.remove(resource,req.params.id);removed?ok(res,null,'Deleted.'):res.status(404).json({success:false,message:'Record not found.'});}catch(e){fail(res,e,400);}});
}
app.get('/api/reports/dashboard',requireAdmin,async(req,res)=>{try{ok(res,await management.dashboard());}catch(e){fail(res,e,500);}});
app.get('/api/reports/revenue',requireAdmin,async(req,res)=>{try{
 const days=Math.min(365,Math.max(1,Number(req.query.days)||30));
 const [rows]=await db.query(`SELECT CAST(created_at AS date) AS [day],COUNT(*) AS orders,COALESCE(SUM(total),0) AS revenue FROM bills WHERE created_at>=DATEADD(day,-?,CAST(GETDATE() AS date)) GROUP BY CAST(created_at AS date) ORDER BY [day]`,[days]);ok(res,rows);
}catch(e){fail(res,e,500);}});

// AI recommendation service. Basic per-IP throttling limits accidental API-key abuse.
const aiRate=new Map();
function limitAi(req,res,next){const key=req.ip;const now=Date.now();const entry=aiRate.get(key)||{start:now,count:0};if(now-entry.start>60000){entry.start=now;entry.count=0;}entry.count++;aiRate.set(key,entry);if(aiRate.size>5000)for(const [k,v] of aiRate)if(now-v.start>120000)aiRate.delete(k);if(entry.count>12)return res.status(429).json({success:false,message:'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau một phút.'});next();}
app.post('/api/ai/recommend',limitAi,async(req,res)=>{try{ok(res,await aiService.recommend(req.body),'AI recommendations generated.');}catch(e){fail(res,e,e.message.includes('OPENAI')?503:400);}});

// MoMo checkout and signed asynchronous IPN callback.
app.post('/api/payments/momo/create',requireLogin,async(req,res)=>{try{ok(res,await paymentService.createPayment(req.body.billId,req.session.user),'MoMo payment created.');}catch(e){fail(res,e,400);}});
app.post('/api/payments/momo/ipn',async(req,res)=>{try{await paymentService.handleIpn(req.body);res.json({resultCode:0,message:'Confirm Success'});}catch(e){console.error('MoMo IPN:',e.message);res.status(400).json({resultCode:1,message:e.message});}});
app.get('/api/payments',requireAdmin,async(req,res)=>{try{ok(res,await paymentService.listPayments(req.query.billId));}catch(e){fail(res,e,500);}});

// Order/billing service module. Stock deduction and bill persistence run in one DB transaction; FEFO is enforced.
app.post('/api/bills',requireLogin,async(req,res)=>{try{ok(res,await orders.createBill(req.body.items,req.session.user.id),'Bill created successfully.')}catch(e){fail(res,e,400)}});
app.get('/api/bills',requireLogin,async(req,res)=>{try{ok(res,await orders.listBills())}catch(e){fail(res,e,500)}});
app.get('/api/bills/:id',requireLogin,async(req,res)=>{try{const b=await orders.getBill(req.params.id);b?ok(res,b):res.status(404).json({success:false,message:'Bill not found'})}catch(e){fail(res,e,500)}});
app.get('/api/health',async(req,res)=>{try{await db.query('SELECT 1');res.json({success:true,status:'ok',database:'connected'})}catch(e){res.status(503).json({success:false,status:'degraded',database:'unavailable'})}});
app.get('/api', (req,res)=>res.json({name:'Makeup Store SOA + SOAP API',soap:['/soap/auth?wsdl','/soap/inventory?wsdl','/soap/order?wsdl','/soap/notification?wsdl','/soap/management?wsdl','/soap/ai?wsdl','/soap/payment?wsdl']}));

// SOAP contracts: simple interoperable request/response envelope. The payload/result fields contain JSON text.
function makeWsdl(service, port, operations) {
 const ops=operations.map(op=>`<operation name="${op}"><input message="tns:${op}Request"/><output message="tns:${op}Response"/></operation>`).join('');
 const messages=operations.map(op=>`<message name="${op}Request"><part name="payload" type="xsd:string"/></message><message name="${op}Response"><part name="result" type="xsd:string"/></message>`).join('');
 const bindingOps=operations.map(op=>`<operation name="${op}"><soap:operation soapAction="${service}/${op}"/><input><soap:body use="literal"/></input><output><soap:body use="literal"/></output></operation>`).join('');
 const url=`${process.env.APP_BASE_URL || `http://localhost:${PORT}`}${port}`;
 return `<?xml version="1.0" encoding="UTF-8"?><definitions name="${service}" targetNamespace="urn:makeup-store:${service}" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:tns="urn:makeup-store:${service}" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><types><xsd:schema targetNamespace="urn:makeup-store:${service}"/></types>${messages}<portType name="${service}PortType">${ops}</portType><binding name="${service}Binding" type="tns:${service}PortType"><soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>${bindingOps}</binding><service name="${service}"><port name="${service}Port" binding="tns:${service}Binding"><soap:address location="${url}"/></port></service></definitions>`;
}
async function requireSoapUser(payload, adminOnly = false) { const user = await authService.login(payload.email, payload.password); if (!user) throw new Error('SOAP authentication failed. Include valid email and password in payload.'); if (adminOnly && user.role !== 'admin') throw new Error('Administrator role required.'); return user; }
function soapServices(serviceName, operations) {
 const port={}; for(const [name,handler] of Object.entries(operations)) port[name]=async(args)=>{ try { const raw=args && args.payload; const payload=raw ? JSON.parse(raw) : {}; const result=await handler(payload); return {result:JSON.stringify({success:true,data:result})}; } catch(e) { return {result:JSON.stringify({success:false,message:e.message})}; } };
 return {[serviceName]:{[`${serviceName}Port`]:port}};
}
const server=http.createServer(app);
function attachSoap(route, name, operations) { soap.listen(server,route,soapServices(name,operations),makeWsdl(name,route,Object.keys(operations))); }
attachSoap('/soap/auth','AuthService',{LoginUser:async p=>{const user=await authService.login(p.email,p.password);if(!user)throw new Error('Invalid credentials');return user;}});
attachSoap('/soap/inventory','InventoryService',{
 GetProducts:async()=>inventory.listProducts(), GetBatches:async p=>{await requireSoapUser(p);return inventory.listBatches(p.productId);},
 AddBatch:async p=>{await requireSoapUser(p,true);return inventory.addBatch(p);}, GetExpiryAlerts:async p=>{await requireSoapUser(p);return notifications.getAlerts(p.days);}
});
attachSoap('/soap/order','OrderService',{CreateBill:async p=>{const user=await requireSoapUser(p);return orders.createBill(p.items,user.id);},GetBills:async p=>{await requireSoapUser(p,true);return orders.listBills();}});
attachSoap('/soap/notification','NotificationService',{SendExpiryAlert:async p=>{await requireSoapUser(p,true);return notifications.sendExpiryAlerts(p.days);},GetExpiryAlerts:async p=>{await requireSoapUser(p);return notifications.getAlerts(p.days);}});

attachSoap('/soap/management','ManagementService',{
  GetCategories:async p=>{await requireSoapUser(p,true);return management.list('categories');},
  GetBrands:async p=>{await requireSoapUser(p,true);return management.list('brands');},
  GetSuppliers:async p=>{await requireSoapUser(p,true);return management.list('suppliers');},
  GetCustomers:async p=>{await requireSoapUser(p,true);return management.list('customers');},
  GetDashboard:async p=>{await requireSoapUser(p,true);return management.dashboard();}
});
attachSoap('/soap/ai','AIRecommendationService',{RecommendProducts:async p=>aiService.recommend(p)});
attachSoap('/soap/payment','PaymentService',{
  CreateMomoPayment:async p=>{const user=await requireSoapUser(p);return paymentService.createPayment(p.billId,user);},
  GetPayments:async p=>{await requireSoapUser(p,true);return paymentService.listPayments(p.billId);}
});

async function start() {
 try {
   await db.query('SELECT 1 AS connected');
   const requiredTables = ['users','products','inventory_batches','bills','bill_items','alert_logs','categories','brands','suppliers','customers','payment_transactions'];
   const [foundTables] = await db.query(`SELECT name FROM sys.tables WHERE name IN ('users','products','inventory_batches','bills','bill_items','alert_logs','categories','brands','suppliers','customers','payment_transactions')`);
   const found = new Set(foundTables.map(row => String(row.name).toLowerCase()));
   const missing = requiredTables.filter(name => !found.has(name));
   if (missing.length) {
     throw new Error(`Database schema is incomplete. Missing tables: ${missing.join(', ')}. Run db-schema.sql in SQL Server Management Studio first.`);
   }

   await authService.ensureAdmin();
   const [productCount] = await db.query('SELECT COUNT(*) AS n FROM products');
   if (Number(productCount[0].n) === 0) {
     const seed = [
       ['Radiant Glow Face Powder','FP-001',7000,"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23ffeaa7' width='100' height='100'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E✨%3C/text%3E%3C/svg%3E",50],
       ['Matte Velvet Lipstick','LS-002',5200,"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23ff7675' width='100' height='100'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E💄%3C/text%3E%3C/svg%3E",120],
       ['Precision Point Eyeliner','EL-003',4200,"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23a29bfe' width='100' height='100'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E✏️%3C/text%3E%3C/svg%3E",0]
     ];
     for (const item of seed) {
       const [inserted] = await db.execute('INSERT INTO products(name,code,price,image) VALUES(?,?,?,?)', item.slice(0,4));
       if (item[4] > 0) {
         await db.execute('INSERT INTO inventory_batches(product_id,batch_code,quantity,expiry_date,supplier) VALUES(?,?,?,?,?)', [inserted.insertId, `INIT-${item[1]}`, item[4], new Date(Date.now()+365*86400000).toISOString().slice(0,10), 'Initial stock']);
       }
     }
   }

   cron.schedule('0 8 * * *', () => notifications.sendExpiryAlerts().catch(error => console.error('Scheduled expiry alert failed:', error.message)));
   server.listen(PORT, '0.0.0.0', () => console.log(`Makeup Store running on port ${PORT}; SQL Server database: ${process.env.DB_NAME || 'makeup_store'}; SOAP WSDL: /soap/inventory?wsdl`));
 } catch (error) {
   console.error('Application startup failed.');
   console.error(error.message);
   if (error.code === 'ESOCKET' || error.code === 'ETIMEOUT' || error.code === 'ECONNREFUSED') {
     console.error('Check that SQL Server is running, TCP/IP is enabled, and the configured ODBC Driver is installed.');
   }
   process.exit(1);
 }
}
start();
