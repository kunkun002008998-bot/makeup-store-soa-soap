const bcrypt = require('bcryptjs');
const db = require('./db');

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@makeupstore.local';
  const [rows] = await db.execute('SELECT TOP (1) id FROM users WHERE email = ?', [email]);
  if (!rows.length) {
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = await bcrypt.hash(password, 12);
    await db.execute('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)', [process.env.ADMIN_NAME || 'Store Administrator', email, hash, 'admin']);
    console.log(`Initial admin created: ${email}. Change the password after first login.`);
  }
}

async function login(email, password) {
  const [rows] = await db.execute('SELECT TOP (1) id,name,email,password_hash,role,active FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !user.active || !(await bcrypt.compare(String(password || ''), user.password_hash))) return null;
  return { id: Number(user.id), name: user.name, email: user.email, role: user.role };
}
module.exports = { ensureAdmin, login };
