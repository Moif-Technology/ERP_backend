/**
 * Adjust 27-Aug Noir Fade DXB bills (counter close 30 / Z-C2-0014)
 * to the requested salesman cash/card totals, then recast that close.
 */
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const COMPANY_ID = 7;
const CLOSE_ID = 30;

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

    // Shanid card 165 → 160: Hair Colour 35 → 30 on bill 368
    await client.query(
      `UPDATE ops.sales_child
          SET unit_price = 30, line_total = 30, subtotal_amount = 30, modified_at = NOW()
        WHERE company_id = $1 AND sales_id = 368 AND sales_child_id = 629`,
      [COMPANY_ID],
    );

    // Faslu card 90 → 110: Haircut 15 → 35 on bill 367
    await client.query(
      `UPDATE ops.sales_child
          SET unit_price = 35, line_total = 35, subtotal_amount = 35, modified_at = NOW()
        WHERE company_id = $1 AND sales_id = 367 AND sales_child_id = 627`,
      [COMPANY_ID],
    );

    // Ajmal card 120 → 105: drop Beard Trim on bill 369
    await client.query(
      `DELETE FROM ops.sales_child
        WHERE company_id = $1 AND sales_id = 369 AND sales_child_id = 633`,
      [COMPANY_ID],
    );

    // Ajmal cash 60 → 25:
    // bill 372 drop Head Massage (30 → 15)
    await client.query(
      `DELETE FROM ops.sales_child
        WHERE company_id = $1 AND sales_id = 372 AND sales_child_id = 639`,
      [COMPANY_ID],
    );
    // bill 378 drop Beard Trim and Haircut 15 → 10 (30 → 10)
    await client.query(
      `DELETE FROM ops.sales_child
        WHERE company_id = $1 AND sales_id = 378 AND sales_child_id = 647`,
      [COMPANY_ID],
    );
    await client.query(
      `UPDATE ops.sales_child
          SET unit_price = 10, line_total = 10, subtotal_amount = 10, modified_at = NOW()
        WHERE company_id = $1 AND sales_id = 378 AND sales_child_id = 646`,
      [COMPANY_ID],
    );

    const affected = [367, 368, 369, 372, 378];
    for (const salesId of affected) {
      const totRes = await client.query(
        `SELECT COALESCE(SUM(line_total), 0)::numeric AS tot
           FROM ops.sales_child
          WHERE company_id = $1 AND sales_id = $2`,
        [COMPANY_ID, salesId],
      );
      const tot = Number(totRes.rows[0].tot);

      await client.query(
        `UPDATE ops.sales_master
            SET amount = $3::numeric,
                subtotal_amount = $3::numeric,
                taxable_amount = $3::numeric,
                paid_amount = $3::numeric,
                cash_amount = CASE WHEN payment_mode = 'CASH' THEN $3::numeric ELSE 0::numeric END,
                credit_card_amount = CASE WHEN payment_mode = 'CREDITCARD' THEN $3::numeric ELSE 0::numeric END,
                modified_at = NOW()
          WHERE company_id = $1 AND sales_id = $2`,
        [COMPANY_ID, salesId, tot],
      );

      await client.query(
        `UPDATE ops.sales_payment_split
            SET bill_amount = $3::numeric, modified_at = NOW()
          WHERE company_id = $1 AND sales_id = $2`,
        [COMPANY_ID, salesId, tot],
      );

      console.log(`Resynced bill ${salesId} → ${tot.toFixed(2)}`);
    }

    const agg = await client.query(
      `SELECT
         COUNT(*)::int AS bill_count,
         COALESCE(SUM(cash_amount), 0)::numeric AS total_cash,
         COALESCE(SUM(credit_card_amount), 0)::numeric AS total_card,
         COALESCE(SUM(credit_amount), 0)::numeric AS total_credit,
         COALESCE(SUM(discount_amount), 0)::numeric AS total_discount,
         COALESCE(SUM(round_off_adjustment), 0)::numeric AS total_round_off,
         COALESCE(SUM(COALESCE(tax_1_amount,0)+COALESCE(tax_2_amount,0)+COALESCE(tax_3_amount,0)), 0)::numeric AS total_tax,
         COALESCE(SUM(amount), 0)::numeric AS gross_amount,
         MIN(bill_no)::bigint AS start_bill_no,
         MAX(bill_no)::bigint AS end_bill_no
       FROM ops.sales_master
      WHERE company_id = $1
        AND counter_close_status = $2`,
      [COMPANY_ID, String(CLOSE_ID)],
    );
    const t = agg.rows[0];
    const cash = Number(t.total_cash);

    const closeBefore = await client.query(
      `SELECT collected_cash FROM ops.counter_close WHERE company_id = $1 AND id = $2`,
      [COMPANY_ID, CLOSE_ID],
    );
    const collected = Number(closeBefore.rows[0]?.collected_cash ?? 0);
    const cashDiff = collected - cash;

    await client.query(
      `UPDATE ops.counter_close
          SET total_cash = $3,
              total_card = $4,
              total_credit = $5,
              total_discount = $6,
              total_round_off = $7,
              total_tax = $8,
              gross_amount = $9,
              cash_to_be_collected = $3,
              cash_difference = $10,
              bill_count = $11,
              start_bill_no = $12,
              end_bill_no = $13
        WHERE company_id = $1 AND id = $2`,
      [
        COMPANY_ID,
        CLOSE_ID,
        t.total_cash,
        t.total_card,
        t.total_credit,
        t.total_discount,
        t.total_round_off,
        t.total_tax,
        t.gross_amount,
        cashDiff,
        t.bill_count,
        t.start_bill_no,
        t.end_bill_no,
      ],
    );

    await client.query('COMMIT');

    const staff = await client.query(
      `SELECT
         COALESCE(st.staff_name, 'UNASSIGNED') AS salesman,
         COUNT(*)::int AS bills,
         SUM(sm.amount)::numeric AS net,
         SUM(COALESCE(sm.cash_amount, 0))::numeric AS cash,
         SUM(COALESCE(sm.credit_card_amount, 0))::numeric AS card
       FROM ops.sales_master sm
       LEFT JOIN core.staff_master st
         ON st.company_id = sm.company_id AND (st.id = sm.staff_id OR st.staff_id = sm.staff_id)
      WHERE sm.company_id = $1
        AND sm.counter_close_status = $2
      GROUP BY st.staff_name
      ORDER BY salesman`,
      [COMPANY_ID, String(CLOSE_ID)],
    );
    console.log('\nSalesman totals after:');
    console.log(JSON.stringify(staff.rows, null, 2));

    const closeAfter = await client.query(
      `SELECT close_no, bill_count, total_cash, total_card, total_credit,
              gross_amount, cash_to_be_collected, collected_cash, cash_difference
         FROM ops.counter_close
        WHERE company_id = $1 AND id = $2`,
      [COMPANY_ID, CLOSE_ID],
    );
    console.log('\nCounter close after:');
    console.log(JSON.stringify(closeAfter.rows[0], null, 2));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
