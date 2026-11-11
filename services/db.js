// SQL Server connection layer using Windows Integrated Authentication.
// The small compatibility API (query/execute/getConnection) keeps service modules simple.
const sql = require('mssql/msnodesqlv8');

const server = process.env.DB_SERVER || 'localhost';
const database = process.env.DB_NAME || 'makeup_store';
const driver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 18 for SQL Server';
const trusted = String(process.env.DB_AUTH || 'windows').toLowerCase() === 'windows';
const asBoolean = value => ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
const encrypt = asBoolean(process.env.DB_ENCRYPT || 'yes');
const trustServerCertificate = asBoolean(process.env.DB_TRUST_SERVER_CERTIFICATE || 'yes');

// Build an explicit ODBC connection string. With ODBC Driver 18, Encrypt defaults
// to Yes and a local/self-signed SQL Server certificate may not chain to a trusted
// root. Putting TrustServerCertificate directly in the ODBC string ensures the
// native msnodesqlv8 driver receives the setting (it is not a browser TLS setting).
const brace = value => `{${String(value).replace(/}/g, '}}')}}`;
const odbcParts = [
  `Driver=${brace(driver)}`,
  `Server=${brace(server)}`,
  `Database=${brace(database)}`,
  trusted ? 'Trusted_Connection=Yes' : `UID=${brace(process.env.DB_USER || '')};PWD=${brace(process.env.DB_PASSWORD || '')}`,
  `Encrypt=${encrypt ? 'Yes' : 'No'}`,
  `TrustServerCertificate=${trustServerCertificate ? 'Yes' : 'No'}`
];
const config = {
  connectionString: `${odbcParts.join(';')};`,
  options: { useUTC: false },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT || 15000),
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT || 30000)
};

let poolPromise;
async function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);
    pool.on('error', error => console.error('SQL Server pool error:', error.message));
    poolPromise = pool.connect().catch(error => {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
}

function parameterize(statement, values = []) {
  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let output = '';
  for (let i = 0; i < statement.length; i += 1) {
    const char = statement[i];
    if (char === "'" && !inDouble) {
      if (inSingle && statement[i + 1] === "'") {
        output += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    }
    if (char === '?' && !inSingle && !inDouble) {
      if (index >= values.length) throw new Error('SQL parameter count mismatch: not enough values supplied.');
      output += `@appParam${index}`;
      index += 1;
    } else {
      output += char;
    }
  }
  if (index !== values.length) throw new Error(`SQL parameter count mismatch: expected ${index}, received ${values.length}.`);
  return output;
}

function bindParameters(request, values = []) {
  values.forEach((value, index) => {
    if (typeof value === 'string') request.input(`appParam${index}`, sql.NVarChar(sql.MAX), value);
    else if (value === null || value === undefined) request.input(`appParam${index}`, sql.NVarChar(sql.MAX), null);
    else request.input(`appParam${index}`, value);
  });
}

async function run(statement, values = [], transaction = null) {
  const pool = transaction ? null : await getPool();
  const request = transaction ? new sql.Request(transaction) : pool.request();
  bindParameters(request, values);
  const queryText = parameterize(statement, values);
  const isInsert = /^\s*INSERT\s+INTO\b/i.test(queryText);
  const finalText = isInsert
    ? `${queryText.replace(/;\s*$/, '')}; SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS insertId;`
    : queryText;
  const result = await request.query(finalText);

  if (isInsert) {
    const identityRows = result.recordsets?.[result.recordsets.length - 1] || [];
    const insertId = identityRows[0]?.insertId == null ? null : Number(identityRows[0].insertId);
    return [{ insertId, affectedRows: (result.rowsAffected || []).reduce((sum, count) => sum + count, 0) }, result.recordsets?.[0] || []];
  }
  if (/^\s*(UPDATE|DELETE|MERGE)\b/i.test(queryText)) {
    return [{ affectedRows: (result.rowsAffected || []).reduce((sum, count) => sum + count, 0) }, result.recordset || []];
  }
  return [result.recordset || [], result];
}

const db = {
  query: (statement, values = []) => run(statement, values),
  execute: (statement, values = []) => run(statement, values),
  connect: getPool,
  async getConnection() {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    return {
      beginTransaction: () => transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED),
      query: (statement, values = []) => run(statement, values, transaction),
      execute: (statement, values = []) => run(statement, values, transaction),
      commit: () => transaction.commit(),
      rollback: () => transaction.rollback(),
      release() { /* Connection is pooled; transaction resources are released by commit/rollback. */ }
    };
  },
  async close() {
    if (poolPromise) {
      const pool = await poolPromise.catch(() => null);
      poolPromise = null;
      if (pool) await pool.close();
    }
  }
};

module.exports = db;
