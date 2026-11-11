const db = require('./db');

const resources = {
  categories: { table: 'categories', fields: ['name', 'description'], required: ['name'] },
  brands: { table: 'brands', fields: ['name', 'description'], required: ['name'] },
  suppliers: { table: 'suppliers', fields: ['name', 'phone', 'email', 'address'], required: ['name'] },
  customers: { table: 'customers', fields: ['name', 'phone', 'email', 'address'], required: ['name'] }
};
function config(type) {
  const resource = resources[type];
  if (!resource) throw new Error('Loại dữ liệu không hợp lệ.');
  return resource;
}
async function list(type) {
  const resource = config(type);
  const [rows] = await db.query(`SELECT * FROM ${resource.table} ORDER BY id DESC`);
  return rows;
}
async function save(type, id, data) {
  const resource = config(type);
  for (const field of resource.required) if (!String(data[field] || '').trim()) throw new Error(`${field} là trường bắt buộc.`);
  const fields = resource.fields.filter(field => data[field] !== undefined);
  if (!fields.length) throw new Error('Không có dữ liệu hợp lệ.');
  const values = fields.map(field => data[field] || null);
  if (id) {
    await db.execute(`UPDATE ${resource.table} SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`, [...values, id]);
    return { id: Number(id), ...data };
  }
  const [result] = await db.execute(`INSERT INTO ${resource.table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, values);
  return { id: result.insertId, ...data };
}
async function remove(type, id) {
  const resource = config(type);
  const [result] = await db.execute(`DELETE FROM ${resource.table} WHERE id=?`, [id]);
  return result.affectedRows > 0;
}
async function dashboard() {
  const [[sales]] = await db.query(`SELECT COUNT(*) AS bills,COALESCE(SUM(total),0) AS revenue,
    COALESCE(SUM(CASE WHEN CAST(created_at AS date)=CAST(GETDATE() AS date) THEN total ELSE 0 END),0) AS todayRevenue FROM bills`);
  const [[products]] = await db.query('SELECT COUNT(*) AS totalProducts FROM products');
  const [[stock]] = await db.query('SELECT COALESCE(SUM(quantity),0) AS totalStock FROM inventory_batches WHERE expiry_date>=CAST(GETDATE() AS date)');
  const [[customers]] = await db.query('SELECT COUNT(*) AS totalCustomers FROM customers');
  const [recent] = await db.query('SELECT TOP (10) id,total,payment_status AS paymentStatus,created_at AS createdAt FROM bills ORDER BY id DESC');
  const [top] = await db.query(`SELECT TOP (5) product_name AS name,SUM(quantity) AS quantity,SUM(line_total) AS revenue
    FROM bill_items GROUP BY product_id,product_name ORDER BY SUM(quantity) DESC`);
  return { sales, products, stock, customers, recent, topProducts: top };
}
module.exports = { list, save, remove, dashboard };
