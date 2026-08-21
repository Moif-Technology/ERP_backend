/**
 * Insert 16-08-2026 Noir Fade DXB sales + Z-close.
 * One CARD + one CASH bill per stylist, item Beard Trim.
 */
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const COMPANY_ID = 7;
const BRANCH_ID = 1;
const STATION_ID = 2;
const COUNTER_NO = 1;
const CUSTOMER_ID = 1;
const PRODUCT_ID = 2;
const PRODUCT_NAME = 'Beard Trim';
const GROUP_ID = 1;
const BILL_DATE = '2026-08-16';
const CLOSE_DATE = '2026-08-16 16:45:00';
const CLOSE_STAFF_ID = 1;

const STAFF = { Shanid: 1, Faslu: 2, Ajmal: 3 };

const BILLS = [
  { staffName: 'Shanid', staffId: STAFF.Shanid, payMode: 'CREDITCARD', amount: 535, time: '10:15:00' },
  { staffName: 'Shanid', staffId: STAFF.Shanid, payMode: 'CASH', amount: 45, time: '10:40:00' },
  { staffName: 'Ajmal', staffId: STAFF.Ajmal, payMode: 'CREDITCARD', amount: 325, time: '12:05:00' },
  { staffName: 'Ajmal', staffId: STAFF.Ajmal, payMode: 'CASH', amount: 60, time: '12:30:00' },
  { staffName: 'Faslu', staffId: STAFF.Faslu, payMode: 'CREDITCARD', amount: 465, time: '16:10:00' },
  { staffName: 'Faslu', staffId: STAFF.Faslu, payMode: 'CASH', amount: 100, time: '16:35:00' },
];

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

    const existing = await client.query(
      `SELECT COUNT(*)::int AS n FROM ops.sales_master
        WHERE company_id = $1 AND bill_date::date = $2::date`,
      [COMPANY_ID, BILL_DATE],
    );
    if (existing.rows[0].n > 0) {
      throw new Error(`Already have ${existing.rows[0].n} sale(s) on ${BILL_DATE} — aborting`);
    }

    await client.query('BEGIN');

    const nextSales = await client.query(
      `SELECT COALESCE(MAX(sales_id), 0)::int AS n FROM ops.sales_master WHERE company_id = $1`,
      [COMPANY_ID],
    );
    const nextChild = await client.query(
      `SELECT COALESCE(MAX(sales_child_id), 0)::int AS n FROM ops.sales_child WHERE company_id = $1`,
      [COMPANY_ID],
    );
    const nextBill = await client.query(
      `SELECT COALESCE(MAX(bill_no), 0)::int AS n
         FROM ops.sales_master WHERE company_id = $1 AND station_id = $2`,
      [COMPANY_ID, STATION_ID],
    );

    let salesId = Number(nextSales.rows[0].n);
    let childId = Number(nextChild.rows[0].n);
    let billNo = Number(nextBill.rows[0].n);

    for (const bill of BILLS) {
      salesId += 1;
      childId += 1;
      billNo += 1;
      const isCard = bill.payMode === 'CREDITCARD';
      const ts = `${BILL_DATE} ${bill.time}`;
      const cashAmt = isCard ? 0 : bill.amount;
      const cardAmt = isCard ? bill.amount : 0;

      await client.query(
        `INSERT INTO ops.sales_master (
            company_id, sales_id, branch_id, station_id, salesman_id,
            counter_no, bill_no, bill_date, bill_time,
            customer_id, payment_mode,
            amount, cash_amount, credit_amount, credit_card_amount,
            paid_amount, balance_paid, outstanding_balance,
            discount_amount, subtotal_amount, taxable_amount,
            tax_1_amount, tax_2_amount, tax_3_amount,
            tax_1_rate, tax_2_rate, tax_3_rate,
            round_off_adjustment,
            waiter_id, no_of_customers,
            staff_id, remarks, entry_source, post_status,
            counter_close_status, transaction_type, created_by, modified_by
          ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8::timestamp,$8::timestamp,
            $9,$10,
            $11,$12,0,$13,
            $11,0,0,
            0,$11,$11,
            0,0,0,
            0,0,0,
            0,
            $5,1,
            $5,$14,'SALON-POS','POSTED',
            'PENDING','SALE','seed_16aug','seed_16aug'
          )`,
        [
          COMPANY_ID, salesId, BRANCH_ID, STATION_ID, bill.staffId,
          COUNTER_NO, billNo, ts, CUSTOMER_ID, bill.payMode,
          bill.amount, cashAmt, cardAmt,
          `${bill.staffName} ${isCard ? 'Card' : 'Cash'} ${BILL_DATE}`,
        ],
      );

      await client.query(
        `INSERT INTO ops.sales_child (
            company_id, sales_child_id, sales_id, branch_id, station_id,
            product_id, product_code, short_description, group_id,
            qty, unit_price, unit_cost, pack_qty, discount_amount, line_total,
            tax_1_amount, tax_2_amount, tax_3_amount,
            tax_1_rate, tax_2_rate, tax_3_rate,
            subtotal_amount, stylist_id, line_type,
            created_by, modified_by
          ) VALUES (
            $1,$2,$3,$4,$5,
            $6,'NF-002',$7,$8,
            1,$9,0,1,0,$9,
            0,0,0,
            0,0,0,
            $9,$10,'SERVICE',
            'seed_16aug','seed_16aug'
          )`,
        [
          COMPANY_ID, childId, salesId, BRANCH_ID, STATION_ID,
          PRODUCT_ID, PRODUCT_NAME, GROUP_ID, bill.amount, bill.staffId,
        ],
      );

      await client.query(
        `INSERT INTO ops.sales_payment_split (
            company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount,
            branch_id, counter_id, staff_id, pay_date, is_cancelled
          ) VALUES ($1,$2,1,$3,$4,0,$5,$6,$7,$8::timestamp, FALSE)`,
        [COMPANY_ID, salesId, bill.payMode, bill.amount, BRANCH_ID, COUNTER_NO, bill.staffId, ts],
      );

      console.log(
        `Bill ${billNo}  ${bill.staffName.padEnd(6)}  ${bill.payMode.padEnd(11)}  ${String(bill.amount).padStart(3)}  ${ts}`,
      );
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
      WHERE company_id = $1 AND station_id = $2 AND bill_date::date = $3::date
        AND COALESCE(NULLIF(TRIM(counter_close_status), ''), 'PENDING') = 'PENDING'`,
      [COMPANY_ID, STATION_ID, BILL_DATE],
    );
    const t = totals.rows[0];
    const cash = Number(t.total_cash);
    const card = Number(t.total_card);
    const gross = Number(t.gross_amount);

    if (cash !== 205 || card !== 1325) {
      throw new Error(`Totals mismatch: cash=${cash} card=${card} (expected cash 205 card 1325)`);
    }

    const seqRes = await client.query(
      `SELECT COALESCE(
         MAX(
           CASE
             WHEN close_no ~ '^Z-C[0-9]+-[0-9]+$'
             THEN CAST(SPLIT_PART(close_no, '-', 3) AS INTEGER)
             ELSE NULL
           END
         ), 0
       ) + 1 AS next_seq
       FROM ops.counter_close WHERE company_id = $1`,
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
        COMPANY_ID, BRANCH_ID, STATION_ID, COUNTER_NO, CLOSE_STAFF_ID, CLOSE_DATE,
        cash, card, gross, t.bill_count, t.start_bill_no, t.end_bill_no, closeNo,
      ],
    );
    const close = ins.rows[0];

    const marked = await client.query(
      `UPDATE ops.sales_master
          SET counter_close_status = $1, modified_at = NOW()
        WHERE company_id = $2 AND station_id = $3 AND bill_date::date = $4::date
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

    console.log('\nCounter close:', close);
    console.log(`Marked ${marked.rowCount} sale(s) as ${close.close_no}`);
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
