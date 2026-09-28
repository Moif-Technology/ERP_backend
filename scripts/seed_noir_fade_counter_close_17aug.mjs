/**
 * Z-close Noir Fade DXB sales for 17-08-2026 (company_id=7).
 */
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const COMPANY_ID = 7;
const BRANCH_ID = 1;
const STATION_ID = 2;
const COUNTER_NO = 1;
const STAFF_ID = 1; // Shanid (admin)
const CLOSE_DATE = '2026-08-17 16:45:00';
const BILL_DATE = '2026-08-17';

async function main() {
  const client = new pg.Client(process.env.DATABASE_URL);
  await client.connect();

  try {
    const co = await client.query(
      `SELECT company_id, company_code, company_name FROM core.company_master WHERE company_id = $1`,
      [COMPANY_ID],
    );
    if (!co.rows.length) throw new Error(`Company ${COMPANY_ID} not found`);
    console.log('Target:', co.rows[0]);

    await client.query('BEGIN');

    const pending = await client.query(
      `SELECT sales_id, bill_no, staff_id, payment_mode, amount, cash_amount, credit_card_amount,
              counter_close_status
         FROM ops.sales_master
        WHERE company_id = $1
          AND station_id = $2
          AND bill_date::date = $3::date
        ORDER BY bill_no`,
      [COMPANY_ID, STATION_ID, BILL_DATE],
    );
    if (!pending.rows.length) throw new Error('No sales found for 2026-08-17');
    console.log(`Sales on ${BILL_DATE}: ${pending.rows.length}`);
    for (const r of pending.rows) {
      console.log(
        `  bill ${r.bill_no} staff=${r.staff_id} ${r.payment_mode} ${r.amount} close=${r.counter_close_status}`,
      );
    }

    const alreadyClosed = pending.rows.filter(
      (r) => String(r.counter_close_status || '').trim() !== 'PENDING',
    );
    if (alreadyClosed.length) {
      throw new Error(`${alreadyClosed.length} bill(s) already closed — aborting`);
    }

    const totals = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_mode = 'CASH' THEN amount ELSE 0 END), 0)::numeric AS total_cash,
         COALESCE(SUM(CASE WHEN payment_mode = 'CREDITCARD' THEN amount ELSE 0 END), 0)::numeric AS total_card,
         COALESCE(SUM(amount), 0)::numeric AS gross_amount,
         COUNT(*)::int AS bill_count,
         MIN(bill_no)::bigint AS start_bill_no,
         MAX(bill_no)::bigint AS end_bill_no
       FROM ops.sales_master
      WHERE company_id = $1
        AND station_id = $2
        AND bill_date::date = $3::date
        AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'`,
      [COMPANY_ID, STATION_ID, BILL_DATE],
    );
    const t = totals.rows[0];
    const cash = Number(t.total_cash);
    const card = Number(t.total_card);
    const gross = Number(t.gross_amount);

    const seqRes = await client.query(
      `SELECT COALESCE(
         MAX(
           CASE
             WHEN close_no ~ '^Z-C[0-9]+-[0-9]+$'
             THEN CAST(SPLIT_PART(close_no, '-', 3) AS INTEGER)
             ELSE NULL
           END
         ),
         0
       ) + 1 AS next_seq
       FROM ops.counter_close
       WHERE company_id = $1`,
      [COMPANY_ID],
    );
    const closeNo = `Z-C${COUNTER_NO}-${String(Number(seqRes.rows[0].next_seq)).padStart(4, '0')}`;

    const ins = await client.query(
      `INSERT INTO ops.counter_close (
         company_id, branch_id, station_id, counter_no, staff_id, report_type, close_date,
         total_cash, total_credit, total_card, total_discount,
         total_refund, total_round_off, total_tax, gross_amount,
         cash_in, cash_out,
         cash_to_be_collected, collected_cash, cash_difference,
         bill_count, start_bill_no, end_bill_no, close_no,
         credit_receipt_cash, credit_receipt_card, credit_receipt_count
       ) VALUES (
         $1,$2,$3,$4,$5,'Z',$6::timestamp,
         $7,0,$8,0,
         0,0,0,$9,
         0,0,
         $7,$7,0,
         $10,$11,$12,$13,
         0,0,0
       ) RETURNING id, close_no, close_date, total_cash, total_card, gross_amount, bill_count`,
      [
        COMPANY_ID,
        BRANCH_ID,
        STATION_ID,
        COUNTER_NO,
        STAFF_ID,
        CLOSE_DATE,
        cash,
        card,
        gross,
        t.bill_count,
        t.start_bill_no,
        t.end_bill_no,
        closeNo,
      ],
    );
    const close = ins.rows[0];
    console.log('\nInserted close:', close);

    const marked = await client.query(
      `UPDATE ops.sales_master
          SET counter_close_status = $1, modified_at = NOW()
        WHERE company_id = $2
          AND station_id = $3
          AND bill_date::date = $4::date
          AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'
          AND post_status = 'POSTED'`,
      [String(close.id), COMPANY_ID, STATION_ID, BILL_DATE],
    );

    await client.query(
      `UPDATE ops.sales_payment_split
          SET counter_close_status = $1
        WHERE company_id = $2
          AND sales_id IN (
            SELECT sales_id FROM ops.sales_master
             WHERE company_id = $2 AND station_id = $3 AND bill_date::date = $4::date
          )`,
      [String(close.id), COMPANY_ID, STATION_ID, BILL_DATE],
    ).catch(() => {});

    await client.query('COMMIT');
    console.log(`Marked ${marked.rowCount} sale(s) closed as ${close.close_no} (id=${close.id})`);
    console.log(`Cash ${cash}  Card ${card}  Gross ${gross}  Bills ${t.bill_count}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
