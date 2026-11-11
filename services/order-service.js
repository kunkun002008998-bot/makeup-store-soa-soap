const db = require('./db');
const inventory = require('./inventory-service');

async function createBill(items, createdBy = null) {
  if (!Array.isArray(items) || !items.length) throw new Error('No items in bill');
  const conn = await db.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    let subtotal = 0;
    const processed = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Each item quantity must be a positive integer');
      const productId = item.id || item.productId;
      const [rows] = await conn.execute('SELECT id,name,code,price FROM products WITH (UPDLOCK, ROWLOCK, HOLDLOCK) WHERE id=?', [productId]);
      const product = rows[0];
      if (!product) throw new Error(`Product with ID ${productId} not found`);
      await inventory.consumeStock(product.id, quantity, conn);
      const price = Number(product.price);
      const total = price * quantity;
      subtotal += total;
      processed.push({ productId: product.id, name: product.name, code: product.code, price, quantity, total });
    }
    const tax = subtotal * 0.10;
    const total = subtotal + tax;
    const [bill] = await conn.execute('INSERT INTO bills (subtotal,tax,total,created_by) VALUES (?,?,?,?)', [subtotal, tax, total, createdBy]);
    for (const item of processed) {
      await conn.execute('INSERT INTO bill_items (bill_id,product_id,product_name,product_code,unit_price,quantity,line_total) VALUES (?,?,?,?,?,?,?)', [bill.insertId, item.productId, item.name, item.code, item.price, item.quantity, item.total]);
    }
    await conn.commit();
    return { id: bill.insertId, items: processed, subtotal, tax, total, date: new Date().toISOString() };
  } catch (error) {
    if (transactionStarted) await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listBills() {
  const [bills] = await db.query(`SELECT id,subtotal,tax,total,created_by AS createdBy,payment_status AS paymentStatus,
    payment_method AS paymentMethod,created_at AS date FROM bills ORDER BY id DESC`);
  for (const bill of bills) {
    const [items] = await db.execute(`SELECT product_id AS productId,product_name AS name,product_code AS code,
      unit_price AS price,quantity,line_total AS total FROM bill_items WHERE bill_id=?`, [bill.id]);
    bill.items = items;
    bill.subtotal = Number(bill.subtotal);
    bill.tax = Number(bill.tax);
    bill.total = Number(bill.total);
  }
  return bills;
}
async function getBill(id) {
  const [bills] = await db.execute(`SELECT id,subtotal,tax,total,created_by AS createdBy,payment_status AS paymentStatus,
    payment_method AS paymentMethod,created_at AS date FROM bills WHERE id=?`, [id]);
  if (!bills[0]) return null;
  const bill = bills[0];
  const [items] = await db.execute(`SELECT product_id AS productId,product_name AS name,product_code AS code,
    unit_price AS price,quantity,line_total AS total FROM bill_items WHERE bill_id=?`, [id]);
  bill.items = items;
  bill.subtotal = Number(bill.subtotal);
  bill.tax = Number(bill.tax);
  bill.total = Number(bill.total);
  return bill;
}
module.exports = { createBill, listBills, getBill };
