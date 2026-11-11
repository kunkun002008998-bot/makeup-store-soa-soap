const crypto = require('crypto');
const db = require('./db');
const orders = require('./order-service');
const base64 = value => Buffer.from(String(value)).toString('base64');
function sign(raw, secret) { return crypto.createHmac('sha256', secret).update(raw).digest('hex'); }
function verifyMomo(body) {
  const raw = `accessKey=${body.accessKey}&amount=${body.amount}&extraData=${body.extraData}&message=${body.message}&orderId=${body.orderId}&orderInfo=${body.orderInfo}&orderType=${body.orderType}&partnerCode=${body.partnerCode}&payType=${body.payType}&requestId=${body.requestId}&responseTime=${body.responseTime}&resultCode=${body.resultCode}&transId=${body.transId}`;
  const expected = sign(raw, process.env.MOMO_SECRET_KEY || '');
  const actual = Buffer.from(String(body.signature || ''));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(wanted, actual);
}

async function createPayment(billId, user) {
  for (const key of ['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY']) {
    if (!process.env[key]) throw new Error(`${key} chưa được cấu hình.`);
  }
  const bill = await orders.getBill(billId);
  if (!bill) throw new Error('Không tìm thấy hóa đơn.');
  if (user && user.role !== 'admin' && Number(bill.createdBy) !== Number(user.id)) throw new Error('Bạn không có quyền thanh toán hóa đơn này.');
  if (bill.paymentStatus === 'paid') throw new Error('Hóa đơn đã được thanh toán.');

  const requestId = `REQ${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
  const orderId = `BILL${bill.id}-${Date.now()}`;
  const amount = String(Math.round(Number(bill.total)));
  const orderInfo = `Thanh toan hoa don ${bill.id}`;
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const redirectUrl = process.env.MOMO_REDIRECT_URL || `${baseUrl}/payment-result.html`;
  const ipnUrl = process.env.MOMO_IPN_URL || `${baseUrl}/api/payments/momo/ipn`;
  const extraData = base64(JSON.stringify({ billId: Number(bill.id) }));
  const requestType = 'captureWallet';
  const raw = `accessKey=${process.env.MOMO_ACCESS_KEY}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${process.env.MOMO_PARTNER_CODE}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
  const payload = { partnerCode: process.env.MOMO_PARTNER_CODE, accessKey: process.env.MOMO_ACCESS_KEY, requestId, amount, orderId, orderInfo, redirectUrl, ipnUrl, extraData, requestType, lang: 'vi', signature: sign(raw, process.env.MOMO_SECRET_KEY) };

  const [existing] = await db.execute("SELECT TOP (1) id FROM payment_transactions WHERE bill_id=? AND status='pending' ORDER BY id DESC", [bill.id]);
  if (existing.length) await db.execute("UPDATE payment_transactions SET status='expired' WHERE id=?", [existing[0].id]);
  await db.execute('INSERT INTO payment_transactions (bill_id,provider,provider_order_id,request_id,amount,status,request_payload) VALUES (?,?,?,?,?,?,?)', [bill.id, 'momo', orderId, requestId, amount, 'pending', JSON.stringify(payload)]);
  await db.execute("UPDATE bills SET payment_status='pending',payment_method='momo' WHERE id=?", [bill.id]);

  const response = await fetch(process.env.MOMO_CREATE_URL || 'https://test-payment.momo.vn/v2/gateway/api/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.resultCode !== 0 || !result.payUrl) {
    await db.execute("UPDATE payment_transactions SET status='failed',response_payload=? WHERE request_id=?", [JSON.stringify(result), requestId]);
    await db.execute("UPDATE bills SET payment_status='failed' WHERE id=?", [bill.id]);
    throw new Error(result.message || 'MoMo không tạo được yêu cầu thanh toán.');
  }
  await db.execute('UPDATE payment_transactions SET response_payload=?,pay_url=? WHERE request_id=?', [JSON.stringify(result), result.payUrl, requestId]);
  return { billId: Number(bill.id), orderId, payUrl: result.payUrl, deeplink: result.deeplink || null, qrCodeUrl: result.qrCodeUrl || null, amount: Number(amount) };
}

async function handleIpn(body) {
  if (!verifyMomo(body)) throw new Error('Chữ ký MoMo không hợp lệ.');
  const conn = await db.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [rows] = await conn.execute('SELECT * FROM payment_transactions WITH (UPDLOCK, ROWLOCK, HOLDLOCK) WHERE provider_order_id=?', [body.orderId]);
    const payment = rows[0];
    if (!payment) throw new Error('Không tìm thấy giao dịch.');
    if (Number(body.amount) !== Number(payment.amount)) throw new Error('Số tiền IPN không khớp giao dịch.');
    if (body.partnerCode !== process.env.MOMO_PARTNER_CODE) throw new Error('Partner code MoMo không hợp lệ.');
    if (payment.status === 'paid') {
      await conn.commit();
      transactionStarted = false;
      return { received: true, duplicate: true };
    }
    const success = Number(body.resultCode) === 0;
    await conn.execute(`UPDATE payment_transactions SET status=?,provider_transaction_id=?,response_payload=?,
      paid_at=CASE WHEN ?=1 THEN SYSDATETIME() ELSE paid_at END WHERE id=?`, [success ? 'paid' : 'failed', String(body.transId || ''), JSON.stringify(body), success ? 1 : 0, payment.id]);
    await conn.execute("UPDATE bills SET payment_status=?,payment_method='momo' WHERE id=?", [success ? 'paid' : 'failed', payment.bill_id]);
    await conn.commit();
    transactionStarted = false;
    return { received: true, success };
  } catch (error) {
    if (transactionStarted) await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listPayments(billId) {
  const query = `SELECT id,bill_id AS billId,provider,provider_order_id AS orderId,amount,status,pay_url AS payUrl,
    provider_transaction_id AS transactionId,created_at AS createdAt,paid_at AS paidAt
    FROM payment_transactions ${billId ? 'WHERE bill_id=?' : ''} ORDER BY id DESC`;
  const [rows] = await db.execute(query, billId ? [billId] : []);
  return rows;
}
module.exports = { createPayment, handleIpn, listPayments };
