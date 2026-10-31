import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const requiredEnvironment = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_APP_PASSWORD'];

for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3307),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_APP_PASSWORD,
  connectionLimit: 5,
  charset: 'utf8mb4',
  timezone: 'Z',
});

export const initializeDatabase = async () => {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const statements = schema
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
};
