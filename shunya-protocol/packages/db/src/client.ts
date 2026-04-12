import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

// During build, we might not have a DATABASE_URL. 
// We provide a dummy string to prevent neon() from throwing at module load time.
const sql = neon(connectionString || "postgresql://dummy:dummy@localhost/shunya");

export const db = drizzle(sql, { schema });

export type DB = typeof db;

