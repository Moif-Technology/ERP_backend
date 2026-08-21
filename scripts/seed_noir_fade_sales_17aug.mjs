/**
 * Insert 17-08-2026 Noir Fade DXB sales: one CARD + one CASH bill per stylist.
 * Item: Beard Trim (product_id=2). Totals match the given cash/card amounts.
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
const BILL_DATE = '2026-08-17';

const STAFF = {
  Shanid: 1,
  Faslu: 2,
  Ajmal: 3,
};

const BILLS = [
  { staffName: 'Shanid', staffId: STAFF.Shanid, payMode: 'CREDITCARD', amount: 200, time: '10:15:00' },
  { staffName: 'Shanid', staffId: STAFF.Shanid, payMode: 'CASH', amount: 100, time: '10:40:00' },
  { staffName: 'Ajmal', staffId: STAFF.Ajmal, payMode: 'CREDITCARD', amount: 155, time: '12:05:00' },
  { staffName: 'Ajmal', staffId: STAFF.Ajmal, payMode: 'CASH', amount: 120, time: '12:30:00' },
  { staffName: 'Faslu', staffId: STAFF.Faslu, payMode: 'CREDITCARD', amount: 280, time: '16:10:00' },
  { staffName: 'Faslu', staffId: STAFF.Faslu, payMode: 'CASH', amount: 45, time: '16:35:00' },
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

    const product = await client.query(
      `SELECT product_id, product_name FROM core.product_master
        WHERE company_id = $1 AND product_id = $2`,
      [COMPANY_ID, PRODUCT_ID],
    );
    if (!product.rows.length) throw new Error('Beard Trim product not found');
    console.log('Item:', product.rows[0]);

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
            'PENDING','SALE','seed_17aug','seed_17aug'
          )`,
        [
          COMPANY_ID,
          salesId,
          BRANCH_ID,
          STATION_ID,
          bill.staffId,
          COUNTER_NO,
          billNo,
          ts,
          CUSTOMER_ID,
          bill.payMode,
          bill.amount,
          cashAmt,
          cardAmt,
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
            'seed_17aug','seed_17aug'
          )`,
        [
          COMPANY_ID,
          childId,
          salesId,
          BRANCH_ID,
          STATION_ID,
          PRODUCT_ID,
          PRODUCT_NAME,
          GROUP_ID,
          bill.amount,
          bill.staffId,
        ],
      );

      await client.query(
        `INSERT INTO ops.sales_payment_split (
            company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount,
            branch_id, counter_id, staff_id, pay_date, is_cancelled
          ) VALUES ($1,$2,1,$3,$4,0,$5,$6,$7,$8::timestamp, FALSE)`,
        [
          COMPANY_ID,
          salesId,
          bill.payMode,
          bill.amount,
          BRANCH_ID,
          COUNTER_NO,
          bill.staffId,
          ts,
        ],
      );

      console.log(
        `Bill ${billNo}  ${bill.staffName.padEnd(6)}  ${bill.payMode.padEnd(11)}  ${String(bill.amount).padStart(3)}  ${ts}`,
      );
    }

    await client.query('COMMIT');

    const summary = await client.query(
      `SELECT
         st.staff_name,
         COALESCE(SUM(CASE WHEN sm.payment_mode = 'CREDITCARD' THEN sm.amount ELSE 0 END), 0)::numeric AS card,
         COALESCE(SUM(CASE WHEN sm.payment_mode = 'CASH' THEN sm.amount ELSE 0 END), 0)::numeric AS cash,
         COALESCE(SUM(sm.amount), 0)::numeric AS total,
         COUNT(*)::int AS bills
       FROM ops.sales_master sm
       JOIN core.staff_master st
         ON st.company_id = sm.company_id AND st.staff_id = sm.staff_id
      WHERE sm.company_id = $1
        AND sm.bill_date::date = $2::date
      GROUP BY st.staff_name
      ORDER BY st.staff_name`,
      [COMPANY_ID, BILL_DATE],
    );
    console.log('\nSummary 17-08-2026:');
    console.table(summary.rows);
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
