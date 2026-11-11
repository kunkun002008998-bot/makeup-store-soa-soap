require('dotenv').config();
const db = require('../services/db');

(async () => {
  try {
    const [rows] = await db.query(`SELECT @@SERVERNAME AS serverName, DB_NAME() AS databaseName,
      SUSER_SNAME() AS windowsLogin, CAST(1 AS int) AS connectionTest`);
    const result = rows[0];
    // Regression check: parameter names must not use the reserved @p{n} pattern
    // used internally by node-mssql/msnodesqlv8.
    const [parameterRows] = await db.query(
      'SELECT ? AS stringParameter, ? AS numberParameter, ? AS nullParameter',
      ['parameter-check', 27, null]
    );
    if (parameterRows[0]?.stringParameter !== 'parameter-check' || Number(parameterRows[0]?.numberParameter) !== 27 || parameterRows[0]?.nullParameter !== null) {
      throw new Error('SQL Server parameter binding regression check failed.');
    }
    console.log('SQL Server connection successful.');
    console.log(`Server: ${result.serverName}`);
    console.log(`Database: ${result.databaseName}`);
    console.log(`Windows login: ${result.windowsLogin}`);
    console.log(`Test: ${result.connectionTest}`);
    console.log('Parameterized query: successful (string, number, NULL).');
  } catch (error) {
    console.error('SQL Server connection failed.');
    console.error(`Code: ${error.code || error.number || 'N/A'}`);
    console.error(error.message);
    console.error('Check SQL Server service, Windows login permissions, ODBC Driver name and DB_SERVER/DB_NAME in .env.');
    process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
  }
})();
