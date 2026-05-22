const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: 'postgresql://postgres:admin@localhost:5432/MOiFOnE',
});

async function getAllTableDetails() {
  const client = await pool.connect();
  
  try {
    // Get all tables
    const tablesResult = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_type = 'BASE TABLE' 
        AND table_schema IN ('accounts', 'biz', 'core', 'garage', 'hr', 'ops')
      ORDER BY table_schema, table_name
    `);
    
    const tables = tablesResult.rows;
    const output = [];
    
    console.error(`Found ${tables.length} tables, processing...`);
    
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const schema = table.table_schema;
      const tableName = table.table_name;
      
      console.error(`Processing ${i+1}/${tables.length}: ${schema}.${tableName}`);
      
      // Get columns
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, tableName]);
      
      // Get primary key
      const pkResult = await client.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = $1 
          AND tc.table_name = $2 
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
      `, [schema, tableName]);
      
      // Get foreign keys
      const fkResult = await client.query(`
        SELECT
          kcu.column_name,
          ccu.table_schema AS foreign_table_schema,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.table_schema = $1 
          AND tc.table_name = $2 
          AND tc.constraint_type = 'FOREIGN KEY'
        ORDER BY kcu.ordinal_position
      `, [schema, tableName]);
      
      // Get indexes
      const indexResult = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY indexname
      `, [schema, tableName]);
      
      // Get unique constraints
      const uniqueResult = await client.query(`
        SELECT tc.constraint_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = $1 
          AND tc.table_name = $2 
          AND tc.constraint_type = 'UNIQUE'
        ORDER BY tc.constraint_name, kcu.ordinal_position
      `, [schema, tableName]);
      
      // Format the output
      output.push(`================================================================================`);
      output.push(`Schema: ${schema}`);
      output.push(`Table: ${tableName}`);
      output.push(`================================================================================`);
      output.push(``);
      output.push(`Purpose: `);
      output.push(``);
      output.push(`Primary Key: ${pkResult.rows.map(r => r.column_name).join(', ') || 'None'}`);
      output.push(``);
      output.push(`Columns:`);
      for (const col of columnsResult.rows) {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        output.push(`  - ${col.column_name} (${col.data_type}) ${nullable}${defaultVal}`);
      }
      output.push(``);
      
      if (fkResult.rows.length > 0) {
        output.push(`Foreign Keys:`);
        for (const fk of fkResult.rows) {
          output.push(`  - ${fk.column_name} -> ${fk.foreign_table_schema}.${fk.foreign_table_name}.${fk.foreign_column_name}`);
        }
        output.push(``);
      }
      
      // Group unique constraints by constraint name
      if (uniqueResult.rows.length > 0) {
        output.push(`Unique Constraints:`);
        const uniqueGroups = {};
        for (const u of uniqueResult.rows) {
          if (!uniqueGroups[u.constraint_name]) uniqueGroups[u.constraint_name] = [];
          uniqueGroups[u.constraint_name].push(u.column_name);
        }
        for (const [constraint, cols] of Object.entries(uniqueGroups)) {
          output.push(`  - ${constraint}: ${cols.join(', ')}`);
        }
        output.push(``);
      }
      
      output.push(`Scope: `);
      output.push(``);
      output.push(`Indexes:`);
      for (const idx of indexResult.rows) {
        // Simplify the index definition
        const idxDef = idx.indexdef.replace(/CREATE (UNIQUE )?INDEX .* ON /, '').replace(/ USING .* /, ' ');
        output.push(`  - ${idx.indexname}: ${idxDef}`);
      }
      if (indexResult.rows.length === 0) {
        output.push(`  None`);
      }
      output.push(``);
      output.push(`Notes: `);
      output.push(``);
    }
    
    // Write to file
    const outputPath = path.join(__dirname, '..', 'MOIFONE DATABASE INDEXES.txt');
    fs.writeFileSync(outputPath, output.join('\n'), 'utf8');
    console.error(`Done! Written to ${outputPath}`);
    
  } finally {
    client.release();
    await pool.end();
  }
}

getAllTableDetails().catch(console.error);