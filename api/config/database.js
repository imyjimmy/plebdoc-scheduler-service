import mysql from 'mysql2/promise';

const getMySQLHost = () => {
  // Container name varies by environment
  if (process.env.NODE_ENV === 'production') {
    return 'umbrel_appointments_mysql_1';
  }
  return 'plebdoc-appointments-service-appointments-mysql-1';
};

const pool = mysql.createPool({
  host: getMySQLHost(),
  user: 'user',
  password: 'password',
  database: 'easyappointments',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
});

export { pool, getMySQLHost };