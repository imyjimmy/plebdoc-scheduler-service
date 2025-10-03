const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

async function runMigration(sqlFilePath) {
  if (!sqlFilePath) {
    console.error('Usage: node run-migration.js <path-to-sql-file>');
    process.exit(1);
  }

  const fullPath = path.resolve(sqlFilePath);
  
  try {
    // Read the SQL file
    const sql = await fs.readFile(fullPath, 'utf8');
    
    // Connect to database
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: process.env.MYSQL_PORT || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || 'your_password',
      database: process.env.MYSQL_DATABASE || 'easyappointments',
      multipleStatements: true
    });

    console.log('✅ Connected to database');
    console.log(`📄 Running migration: ${path.basename(fullPath)}`);
    
    // Execute the SQL
    await connection.query(sql);
    
    console.log('✅ Migration completed successfully');
    
    await connection.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Get the SQL file path from command line arguments
const sqlFile = process.argv[2];
runMigration(sqlFile);
