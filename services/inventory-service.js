const db = require('./db');

const stockSelect = `SELECT p.id,p.name,p.code,p.price,p.image,p.category_id,p.brand_id,
  c.name AS category_name,br.name AS brand_name,COALESCE(s.stock,0) AS stock
  FROM products p
  LEFT JOIN (SELECT product_id,SUM(CASE WHEN expiry_date >= CAST(GETDATE() AS date) THEN quantity ELSE 0 END) AS stock
             FROM inventory_batches GROUP BY product_id) s ON s.product_id=p.id
  LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands br ON br.id=p.brand_id`;

function normalizeProduct(product) {
  return { ...product, id: Number(product.id), price: Number(product.price), stock: Number(product.stock) };
}

async function listProducts() {
  const [rows] = await db.query(`${stockSelect} ORDER BY p.id`);
  return rows.map(normalizeProduct);
}

async function getProduct(id) {
  const [rows] = await db.execute(`${stockSelect} WHERE p.id=?`, [id]);
  return rows[0] ? normalizeProduct(rows[0]) : null;
}

async function createProduct(data) {
  const [result] = await db.execute('INSERT INTO products (name,code,price,image,category_id,brand_id) VALUES (?,?,?,?,?,?)', [data.name, data.code, Number(data.price), data.image || null, data.categoryId || null, data.brandId || null]);
  const id = result.insertId;
  if (Number(data.stock || 0) > 0) {
    const expiry = data.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    await addBatch({ productId: id, batchCode: `INIT-${id}`, quantity: Number(data.stock), manufactureDate: null, expiryDate: expiry, supplier: 'Initial stock' });
  }
  return getProduct(id);
}

async function updateProduct(id, data) {
  const [rows] = await db.execute('SELECT id FROM products WHERE id=?', [id]);
  if (!rows.length) return null;
  const columns = { name: 'name', code: 'code', price: 'price', image: 'image', categoryId: 'category_id', brandId: 'brand_id' };
  const fields = [], values = [];
  for (const [key, column] of Object.entries(columns)) {
    if (data[key] !== undefined) {
      fields.push(`${column}=?`);
      values.push(key === 'price' ? Number(data[key]) : (data[key] || null));
    }
  }
  if (fields.length) {
    fields.push('updated_at=SYSDATETIME()');
    values.push(id);
    await db.execute(`UPDATE products SET ${fields.join(',')} WHERE id=?`, values);
  }
  if (data.stock !== undefined) {
    const product = await getProduct(id);
    const delta = Number(data.stock) - product.stock;
    if (delta > 0) await addBatch({ productId: id, batchCode: `ADJ-${Date.now()}`, quantity: delta, expiryDate: data.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10), supplier: 'Stock adjustment' });
    if (delta < 0) await consumeStock(id, -delta);
  }
  return getProduct(id);
}

async function deleteProduct(id) {
  const [result] = await db.execute('DELETE FROM products WHERE id=?', [id]);
  return result.affectedRows > 0;
}

async function addBatch(batch) {
  if (!batch.productId || !batch.batchCode || !Number.isInteger(Number(batch.quantity)) || Number(batch.quantity) < 0 || !batch.expiryDate) {
    throw new Error('productId, batchCode, quantity (>= 0) and expiryDate are required');
  }
  const [result] = await db.execute('INSERT INTO inventory_batches (product_id,batch_code,quantity,manufacture_date,expiry_date,supplier) VALUES (?,?,?,?,?,?)', [batch.productId, batch.batchCode, Number(batch.quantity), batch.manufactureDate || null, batch.expiryDate, batch.supplier || null]);
  const [rows] = await db.execute('SELECT * FROM inventory_batches WHERE id=?', [result.insertId]);
  return rows[0];
}

async function listBatches(productId) {
  const params = [];
  let where = '';
  if (productId) { where = 'WHERE b.product_id=?'; params.push(productId); }
  const [rows] = await db.execute(`SELECT b.*,p.name AS product_name,p.code AS product_code,
    DATEDIFF(day,CAST(GETDATE() AS date),b.expiry_date) AS days_to_expiry
    FROM inventory_batches b JOIN products p ON p.id=b.product_id ${where} ORDER BY b.expiry_date ASC`, params);
  return rows;
}

async function consumeStock(productId, quantity, conn = db) {
  let remaining = Number(quantity);
  if (!Number.isInteger(remaining) || remaining <= 0) throw new Error('Quantity must be a positive integer');
  const [batches] = await conn.execute(`SELECT id,quantity FROM inventory_batches WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
    WHERE product_id=? AND expiry_date>=CAST(GETDATE() AS date) AND quantity>0 ORDER BY expiry_date ASC,id ASC`, [productId]);
  const available = batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
  if (available < remaining) throw new Error(`Insufficient non-expired stock. Available: ${available}`);
  for (const batch of batches) {
    if (!remaining) break;
    const take = Math.min(Number(batch.quantity), remaining);
    await conn.execute('UPDATE inventory_batches SET quantity=quantity-? WHERE id=?', [take, batch.id]);
    remaining -= take;
  }
}

async function getExpiryAlerts(days = Number(process.env.EXPIRY_WARNING_DAYS || 30)) {
  const [rows] = await db.execute(`SELECT b.*,p.name AS product_name,p.code AS product_code,
    DATEDIFF(day,CAST(GETDATE() AS date),b.expiry_date) AS days_to_expiry
    FROM inventory_batches b JOIN products p ON p.id=b.product_id
    WHERE b.quantity>0 AND b.expiry_date<=DATEADD(day,?,CAST(GETDATE() AS date)) ORDER BY b.expiry_date`, [Math.max(0, Number(days))]);
  return rows;
}

module.exports = { listProducts, getProduct, createProduct, updateProduct, deleteProduct, addBatch, listBatches, consumeStock, getExpiryAlerts };
