import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: 'localhost',
  port: 5433,
  user: 'moif',
  password: '404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53',
  database: 'moifone_uae',
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
});

async function checkSales() {
  try {
    console.log('🔗 Connecting to database at localhost:5433...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Total sales
    const total = await client.query(
      `SELECT COUNT(*) as count, COUNT(DISTINCT staff_id) as staff_count FROM ops.sales_master WHERE post_status = 'POSTED'`
    );
    console.log(`📊 Total POSTED sales: ${total.rows[0].count}`);
    console.log(`👥 Unique staff: ${total.rows[0].staff_count}\n`);

    // By date
    const byDate = await client.query(
      `SELECT DATE(bill_date) as date, COUNT(*) as count FROM ops.sales_master WHERE post_status = 'POSTED' GROUP BY DATE(bill_date) ORDER BY date DESC LIMIT 10`
    );
    console.log('📅 Sales by date (last 10):');
    byDate.rows.forEach(r => console.log(`   ${r.date}: ${r.count} bills`));

    // Staff-wise for today
    const today = await client.query(
      `SELECT DATE(CURRENT_DATE) as today`
    );
    console.log(`\n📆 Today's date in DB: ${today.rows[0].today}`);

    const staffWise = await client.query(
      `SELECT
         sm.staff_id,
         s.staff_name,
         COUNT(*) as bill_count,
         SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END) as gross
       FROM ops.sales_master sm
       LEFT JOIN core.staff_master s ON s.staff_id = sm.staff_id AND s.company_id = sm.company_id
       WHERE sm.post_status = 'POSTED'
         AND DATE(sm.bill_date) >= DATE(CURRENT_DATE) - INTERVAL '7 days'
       GROUP BY sm.staff_id, s.staff_name
       ORDER BY bill_count DESC`
    );

    console.log(`\n👨‍💼 Staff-wise sales (last 7 days):`);
    if (staffWise.rows.length === 0) {
      console.log('   ⚠️  No staff sales found');
    } else {
      staffWise.rows.forEach((r, i) => {
        console.log(`   ${i+1}. Staff ${r.staff_id} "${r.staff_name}": ${r.bill_count} bills, ₹${r.gross || 0}`);
      });
    }

    console.log('\n✅ Query complete');
  } catch (err) {
    console.error('❌ Connection Error:', err.message);
    console.error('   Code:', err.code);
  } finally {
    await client.end();
  }
}

checkSales();
