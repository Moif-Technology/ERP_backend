import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'moif',
  password: '404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53',
  database: 'moifone_uae',
});

async function checkSalesData() {
  try {
    console.log('📊 Checking sales data in database...\n');

    // Check total sales
    const totalSales = await pool.query(
      `SELECT COUNT(*) as count FROM ops.sales_master WHERE post_status = 'POSTED'`
    );
    console.log(`✓ Total POSTED sales: ${totalSales.rows[0].count}`);

    // Check sales by staff
    const staffSales = await pool.query(
      `SELECT
         sm.staff_id,
         s.staff_name,
         COUNT(*) as bill_count,
         SUM(CASE WHEN sm.amount > 0 THEN sm.amount ELSE 0 END) as gross_amount
       FROM ops.sales_master sm
       LEFT JOIN core.staff_master s ON s.staff_id = sm.staff_id AND s.company_id = sm.company_id
       WHERE sm.post_status = 'POSTED'
       GROUP BY sm.staff_id, s.staff_name
       ORDER BY bill_count DESC
       LIMIT 10`
    );
    console.log(`\n✓ Staff-wise breakdown (top 10):`);
    if (staffSales.rows.length === 0) {
      console.log('  ⚠️  No staff sales found');
    } else {
      staffSales.rows.forEach((row, idx) => {
        console.log(`  ${idx+1}. Staff ${row.staff_id}: "${row.staff_name}" - ${row.bill_count} bills, Total: ${row.gross_amount}`);
      });
    }

    // Check by counter
    const byCounter = await pool.query(
      `SELECT DISTINCT counter_no FROM ops.sales_master WHERE post_status = 'POSTED' ORDER BY counter_no`
    );
    console.log(`\n✓ Counters with sales: ${byCounter.rows.length > 0 ? byCounter.rows.map(r => r.counter_no).join(', ') : 'None found'}`);

    // Check date range
    const dateRange = await pool.query(
      `SELECT MIN(bill_date::date) as earliest, MAX(bill_date::date) as latest FROM ops.sales_master WHERE post_status = 'POSTED'`
    );
    console.log(`\n✓ Date range: ${dateRange.rows[0].earliest} to ${dateRange.rows[0].latest}`);

    console.log('\n✅ Database check complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('   Stack:', err.stack);
  } finally {
    await pool.end();
  }
}

checkSalesData();
