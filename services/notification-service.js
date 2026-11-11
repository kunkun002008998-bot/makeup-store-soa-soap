const nodemailer = require('nodemailer');
const db = require('./db');
const inventory = require('./inventory-service');
function getTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
}
async function getAlerts(days) { return inventory.getExpiryAlerts(days); }
async function sendExpiryAlerts(days) {
  const alerts = await getAlerts(days);
  const to = process.env.ALERT_EMAIL_TO;
  if (!alerts.length) return { count: 0, emailSent: false, message: 'No batches near expiry.' };
  const rows = alerts.map(alert => `<tr><td>${alert.product_name}</td><td>${alert.batch_code}</td><td>${alert.quantity}</td><td>${alert.expiry_date}</td><td>${alert.days_to_expiry}</td></tr>`).join('');
  const html = `<h2>Makeup Store - Expiry Alert</h2><p>These inventory batches are expired or will expire soon.</p><table border="1" cellpadding="6"><tr><th>Product</th><th>Batch</th><th>Qty</th><th>Expiry</th><th>Days remaining</th></tr>${rows}</table>`;
  const transport = getTransport();
  let emailSent = false;
  let errorMessage = null;
  if (transport && to) {
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject: `Makeup Store: ${alerts.length} batch(es) near expiry`, html });
      emailSent = true;
      for (const alert of alerts) await db.execute('INSERT INTO alert_logs (batch_id,alert_type,sent_to,status,message) VALUES (?,?,?,?,?)', [alert.id, Number(alert.days_to_expiry) < 0 ? 'expired' : 'expiring', to, 'sent', `Expiry ${alert.expiry_date}`]);
    } catch (error) { errorMessage = error.message; }
  } else {
    for (const alert of alerts) await db.execute('INSERT INTO alert_logs (batch_id,alert_type,sent_to,status,message) VALUES (?,?,?,?,?)', [alert.id, Number(alert.days_to_expiry) < 0 ? 'expired' : 'expiring', to || null, 'in_app', `SMTP is not configured. Expiry ${alert.expiry_date}`]);
  }
  return { count: alerts.length, emailSent, alerts, error: errorMessage, message: emailSent ? 'Email alert sent.' : (transport ? 'Email could not be sent; check SMTP settings.' : 'In-app alert ready. Configure SMTP to send email.') };
}
module.exports = { getAlerts, sendExpiryAlerts };
