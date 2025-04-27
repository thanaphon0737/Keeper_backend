import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;
const app = express();
dotenv.config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

await pool.connect();
console.log('Database connected');
