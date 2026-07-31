/**
 * Appointment repository — raw SQL queries only, no business logic
 */

/**
 * Find appointments for a given date (optionally filter by stylist)
 */
export async function findAppointmentsByDate(client, query) {
  const { companyId, date, stylistId } = query;

  let sql = `
    SELECT
      appointment_id, company_id, customer_id, stylist_id,
      appointment_date, appointment_time, duration_minutes,
      appointment_status, notes, job_id,
      created_at, updated_at
    FROM ops.appointment_master
    WHERE company_id = $1
      AND appointment_date = $2
      AND appointment_status != 'CANCELLED'
    ORDER BY appointment_time ASC
  `;
  const params = [companyId, date];

  if (stylistId) {
    sql += ` AND stylist_id = $${params.length + 1}`;
    params.push(stylistId);
  }

  const result = await client.query(sql, params);
  return result.rows;
}

/**
 * Find appointments that conflict with a given time slot
 */
export async function findConflictingAppointments(client, query) {
  const {
    companyId,
    stylistId,
    appointmentDate,
    appointmentTime,
    durationMinutes,
    excludeAppointmentId,
  } = query;

  const parts = appointmentTime.split(':');
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    throw new Error(`Invalid appointmentTime format: "${appointmentTime}" (expected HH:MM)`);
  }

  const [hour, min] = parts.map(Number);
  if (hour < 0 || hour > 23 || min < 0 || min > 59) {
    throw new Error(`Invalid time values: hour=${hour}, min=${min}`);
  }

  const appointmentEndTime = new Date();
  appointmentEndTime.setHours(hour, 0, 0, 0);
  appointmentEndTime.setMinutes(min + durationMinutes);
  const appointmentEndTimeStr = String(appointmentEndTime.getHours()).padStart(2, '0')
    + ':' + String(appointmentEndTime.getMinutes()).padStart(2, '0');

  let sql = `
    SELECT
      appointment_id, appointment_time, duration_minutes,
      NULL as available_slot
    FROM ops.appointment_master
    WHERE company_id = $1
      AND stylist_id = $2
      AND appointment_date = $3
      AND appointment_status != 'CANCELLED'
      AND (
        (appointment_time >= $4 AND appointment_time < $5) OR
        (appointment_time + (duration_minutes || ' minutes')::interval > $4::time)
      )
  `;
  const params = [companyId, stylistId, appointmentDate, appointmentTime, appointmentEndTimeStr];

  if (excludeAppointmentId) {
    sql += ` AND appointment_id != $${params.length + 1}`;
    params.push(excludeAppointmentId);
  }

  const result = await client.query(sql, params);
  return result.rows;
}

/**
 * Find single appointment by ID
 */
export async function findAppointmentById(client, appointmentId, companyId) {
  const result = await client.query(
    `SELECT
      appointment_id, company_id, customer_id, stylist_id,
      appointment_date, appointment_time, duration_minutes,
      appointment_status, notes, job_id,
      created_at, updated_at
    FROM ops.appointment_master
    WHERE appointment_id = $1 AND company_id = $2`,
    [appointmentId, companyId],
  );
  return result.rows[0] || null;
}

/**
 * Insert new appointment master
 */
export async function insertAppointmentMaster(client, data) {
  const {
    companyId,
    customerId,
    stylistId,
    appointmentDate,
    appointmentTime,
    durationMinutes,
    appointmentStatus,
    notes,
  } = data;

  const result = await client.query(
    `INSERT INTO ops.appointment_master
      (company_id, customer_id, stylist_id, appointment_date, appointment_time,
       duration_minutes, appointment_status, notes, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    RETURNING *`,
    [companyId, customerId, stylistId, appointmentDate, appointmentTime,
      durationMinutes, appointmentStatus, notes],
  );

  return result.rows[0];
}

/**
 * Insert appointment service lines
 */
export async function insertAppointmentServices(client, appointmentId, serviceIds) {
  if (!serviceIds || serviceIds.length === 0) return;

  const values = serviceIds
    .map((_, i) => `($1, $${i + 2}, NULL, NOW())`)
    .join(', ');

  const sql = `INSERT INTO ops.appointment_service
    (appointment_id, service_id, expected_duration_min, created_at)
    VALUES ${values}`;

  const params = [appointmentId, ...serviceIds];
  await client.query(sql, params);
}

/**
 * Find services booked in an appointment
 */
export async function findAppointmentServices(client, appointmentId) {
  const result = await client.query(
    `SELECT
      aps.appointment_service_id, aps.service_id,
      pm.product_name as service_name
    FROM ops.appointment_service aps
    LEFT JOIN core.product_master pm ON aps.service_id = pm.product_id
    WHERE aps.appointment_id = $1
    ORDER BY aps.created_at ASC`,
    [appointmentId],
  );
  return result.rows;
}

/**
 * Update appointment master
 */
export async function updateAppointmentMaster(client, appointmentId, updates) {
  const setClauses = [];
  const params = [appointmentId];
  let paramIndex = 2;

  if (updates.appointmentDate !== undefined) {
    setClauses.push(`appointment_date = $${paramIndex++}`);
    params.push(updates.appointmentDate);
  }
  if (updates.appointmentTime !== undefined) {
    setClauses.push(`appointment_time = $${paramIndex++}`);
    params.push(updates.appointmentTime);
  }
  if (updates.durationMinutes !== undefined) {
    setClauses.push(`duration_minutes = $${paramIndex++}`);
    params.push(updates.durationMinutes);
  }
  if (updates.notes !== undefined) {
    setClauses.push(`notes = $${paramIndex++}`);
    params.push(updates.notes);
  }

  if (setClauses.length === 0) return null;

  setClauses.push(`updated_at = NOW()`);

  const result = await client.query(
    `UPDATE ops.appointment_master
    SET ${setClauses.join(', ')}
    WHERE appointment_id = $1
    RETURNING *`,
    params,
  );

  return result.rows[0];
}

/**
 * Update appointment status
 */
export async function updateAppointmentStatus(client, appointmentId, status) {
  const result = await client.query(
    `UPDATE ops.appointment_master
    SET appointment_status = $1, updated_at = NOW()
    WHERE appointment_id = $2
    RETURNING *`,
    [status, appointmentId],
  );
  return result.rows[0];
}

/**
 * Link job to appointment (check-in)
 */
export async function linkJobToAppointment(client, appointmentId, jobId) {
  const result = await client.query(
    `UPDATE ops.appointment_master
    SET job_id = $1, updated_at = NOW()
    WHERE appointment_id = $2
    RETURNING *`,
    [jobId, appointmentId],
  );
  return result.rows[0];
}

/**
 * Find customer by ID
 */
export async function findCustomer(client, customerId) {
  const result = await client.query(
    `SELECT customer_id, customer_name, phone, email
    FROM core.customer_master
    WHERE customer_id = $1`,
    [customerId],
  );
  return result.rows[0] || null;
}

/**
 * Find staff (stylist) by ID
 */
export async function findStaff(client, staffId) {
  const result = await client.query(
    `SELECT staff_id, staff_name
    FROM core.staff_master
    WHERE staff_id = $1`,
    [staffId],
  );
  return result.rows[0] || null;
}
