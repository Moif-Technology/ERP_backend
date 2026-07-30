import { withTransaction } from '../../../config/db.js';
import * as appointmentRepo from '../repositories/appointment.repository.js';

const WORKING_HOURS = { start: '09:00', end: '18:00' };
const SLOT_INTERVAL_MINUTES = 15;

/**
 * Create new appointment with availability check
 */
export async function createAppointment(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);

  const {
    customerId,
    stylistId,
    appointmentDate,
    appointmentTime,
    durationMinutes = 60,
    serviceIds = [],
    notes,
  } = body;

  if (!customerId) throw createError('customerId is required', 400);
  if (!stylistId) throw createError('stylistId is required', 400);
  if (!appointmentDate) throw createError('appointmentDate is required (YYYY-MM-DD)', 400);
  if (!appointmentTime) throw createError('appointmentTime is required (HH:MM)', 400);

  return withTransaction(async (client) => {
    // Advisory lock prevents concurrent double-bookings for this stylist+date
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `salon-pos.appointment:${companyId}:${stylistId}:${appointmentDate}`,
    ]);

    // Check availability: does this time + duration overlap with existing appointments?
    const conflicting = await appointmentRepo.findConflictingAppointments(client, {
      companyId,
      stylistId,
      appointmentDate,
      appointmentTime,
      durationMinutes,
    });

    if (conflicting.length > 0) {
      const err = new Error(
        `Stylist unavailable at that time. ` +
        `Try: ${conflicting.map((a) => a.available_slot).join(', ')}.`,
      );
      err.status = 409;
      throw err;
    }

    // Insert appointment master
    const appointment = await appointmentRepo.insertAppointmentMaster(client, {
      companyId,
      customerId,
      stylistId,
      appointmentDate,
      appointmentTime,
      durationMinutes,
      appointmentStatus: 'SCHEDULED',
      notes,
    });

    // Insert service lines
    if (serviceIds.length > 0) {
      await appointmentRepo.insertAppointmentServices(
        client,
        appointment.appointment_id,
        serviceIds,
      );
    }

    return formatAppointmentResponse(appointment);
  });
}

/**
 * List appointments for a given date (optionally filtered by stylist)
 */
export async function listAppointments(pool, query, authStaff) {
  const companyId = Number(authStaff.company_id);
  const { date, stylistId } = query;

  const appointments = await appointmentRepo.findAppointmentsByDate(pool, {
    companyId,
    date,
    stylistId,
  });

  // Enrich with service and customer names
  const enriched = await Promise.all(
    appointments.map(async (appt) => {
      const services = await appointmentRepo.findAppointmentServices(pool, appt.appointment_id);
      const customer = await appointmentRepo.findCustomer(pool, appt.customer_id);
      const stylist = await appointmentRepo.findStaff(pool, appt.stylist_id);

      return {
        appointmentId: appt.appointment_id,
        customerId: appt.customer_id,
        customerName: customer?.customer_name || 'Unknown',
        stylistId: appt.stylist_id,
        stylistName: stylist?.staff_name || 'Unknown',
        appointmentDate: appt.appointment_date,
        appointmentTime: appt.appointment_time,
        durationMinutes: appt.duration_minutes,
        appointmentStatus: appt.appointment_status,
        serviceIds: services.map((s) => s.service_id),
        serviceNames: services.map((s) => s.service_name || `Service ${s.service_id}`),
        notes: appt.notes,
      };
    }),
  );

  return enriched;
}

/**
 * Get single appointment with full details
 */
export async function getAppointmentDetail(pool, appointmentId, authStaff) {
  const companyId = Number(authStaff.company_id);

  const appointment = await appointmentRepo.findAppointmentById(pool, appointmentId, companyId);
  if (!appointment) {
    throw createError('Appointment not found', 404);
  }

  const services = await appointmentRepo.findAppointmentServices(pool, appointmentId);
  const customer = await appointmentRepo.findCustomer(pool, appointment.customer_id);
  const stylist = await appointmentRepo.findStaff(pool, appointment.stylist_id);

  return {
    appointmentId: appointment.appointment_id,
    customerId: appointment.customer_id,
    customerName: customer?.customer_name || 'Unknown',
    customerPhone: customer?.phone || 'N/A',
    customerEmail: customer?.email || 'N/A',
    stylistId: appointment.stylist_id,
    stylistName: stylist?.staff_name || 'Unknown',
    appointmentDate: appointment.appointment_date,
    appointmentTime: appointment.appointment_time,
    durationMinutes: appointment.duration_minutes,
    appointmentStatus: appointment.appointment_status,
    serviceIds: services.map((s) => s.service_id),
    serviceNames: services.map((s) => s.service_name || `Service ${s.service_id}`),
    notes: appointment.notes,
    jobId: appointment.job_id,
  };
}

/**
 * Update appointment (reschedule, notes, etc.)
 */
export async function updateAppointment(pool, appointmentId, body, authStaff) {
  const companyId = Number(authStaff.company_id);

  return withTransaction(async (client) => {
    const appointment = await appointmentRepo.findAppointmentById(client, appointmentId, companyId);
    if (!appointment) {
      throw createError('Appointment not found', 404);
    }

    // Prevent updates to checked-in appointments
    if (appointment.job_id) {
      throw createError('Cannot reschedule a checked-in appointment', 409);
    }

    const {
      appointmentDate,
      appointmentTime,
      durationMinutes,
      notes,
    } = body;

    // If rescheduling, check availability with new date/time
    if (appointmentDate || appointmentTime) {
      const newDate = appointmentDate || appointment.appointment_date;
      const newTime = appointmentTime || appointment.appointment_time;
      const newDuration = durationMinutes || appointment.duration_minutes;

      const conflicting = await appointmentRepo.findConflictingAppointments(client, {
        companyId,
        stylistId: appointment.stylist_id,
        appointmentDate: newDate,
        appointmentTime: newTime,
        durationMinutes: newDuration,
        excludeAppointmentId: appointmentId,
      });

      if (conflicting.length > 0) {
        const err = new Error('Stylist unavailable at new time');
        err.status = 409;
        throw err;
      }
    }

    const updated = await appointmentRepo.updateAppointmentMaster(client, appointmentId, {
      appointmentDate,
      appointmentTime,
      durationMinutes,
      notes,
    });

    return formatAppointmentResponse(updated);
  });
}

/**
 * Cancel appointment (soft delete)
 */
export async function cancelAppointment(pool, appointmentId, authStaff) {
  const companyId = Number(authStaff.company_id);

  return withTransaction(async (client) => {
    const appointment = await appointmentRepo.findAppointmentById(client, appointmentId, companyId);
    if (!appointment) {
      throw createError('Appointment not found', 404);
    }

    await appointmentRepo.updateAppointmentStatus(client, appointmentId, 'CANCELLED');
  });
}

/**
 * Confirm appointment
 */
export async function confirmAppointment(pool, appointmentId, authStaff) {
  const companyId = Number(authStaff.company_id);

  const appointment = await appointmentRepo.findAppointmentById(pool, appointmentId, companyId);
  if (!appointment) {
    throw createError('Appointment not found', 404);
  }

  const updated = await appointmentRepo.updateAppointmentStatus(pool, appointmentId, 'CONFIRMED');
  return formatAppointmentResponse(updated);
}

/**
 * Check in appointment (link to job)
 */
export async function checkInAppointment(pool, appointmentId, jobId, authStaff) {
  const companyId = Number(authStaff.company_id);

  return withTransaction(async (client) => {
    const appointment = await appointmentRepo.findAppointmentById(client, appointmentId, companyId);
    if (!appointment) {
      throw createError('Appointment not found', 404);
    }

    if (appointment.job_id) {
      throw createError('Appointment already checked in', 409);
    }

    const updated = await appointmentRepo.linkJobToAppointment(
      client,
      appointmentId,
      jobId,
    );

    await appointmentRepo.updateAppointmentStatus(client, appointmentId, 'CONFIRMED');

    return formatAppointmentResponse(updated);
  });
}

/**
 * Get available slots for stylist on given date
 */
export async function getStylistAvailability(pool, stylistId, date, authStaff) {
  const companyId = Number(authStaff.company_id);

  const appointments = await appointmentRepo.findAppointmentsByDate(pool, {
    companyId,
    date,
    stylistId,
  });

  const stylist = await appointmentRepo.findStaff(pool, stylistId);

  // Generate all 15-minute slots for working hours
  const allSlots = generateTimeSlots(WORKING_HOURS.start, WORKING_HOURS.end, SLOT_INTERVAL_MINUTES);

  // Mark booked slots (exclusive end time: appointment occupies start..start+duration)
  const bookedSlots = [];
  const availableSlots = [];

  allSlots.forEach((slot) => {
    const isBooked = appointments.some((appt) => isSlotBooked(slot, appt));
    if (isBooked) {
      bookedSlots.push(slot);
    } else {
      availableSlots.push(slot);
    }
  });

  return {
    stylistId,
    styleName: stylist?.staff_name || 'Unknown',
    date,
    availableSlots,
    bookedSlots,
  };
}

/**
 * Get salon-wide daily load (appointments by stylist)
 */
export async function getDailyLoad(pool, date, authStaff) {
  const companyId = Number(authStaff.company_id);

  const appointments = await appointmentRepo.findAppointmentsByDate(pool, {
    companyId,
    date,
  });

  const byStylist = {};
  appointments.forEach((appt) => {
    if (!byStylist[appt.stylist_id]) {
      byStylist[appt.stylist_id] = [];
    }
    byStylist[appt.stylist_id].push(appt);
  });

  const load = await Promise.all(
    Object.entries(byStylist).map(async ([stylistId, appts]) => {
      const stylist = await appointmentRepo.findStaff(pool, Number(stylistId));
      return {
        stylistId: Number(stylistId),
        stylistName: stylist?.staff_name || 'Unknown',
        appointmentCount: appts.length,
        totalMinutes: appts.reduce((sum, a) => sum + a.duration_minutes, 0),
        utilization: `${Math.round((appts.reduce((sum, a) => sum + a.duration_minutes, 0) / (9 * 60)) * 100)}%`,
      };
    }),
  );

  return {
    date,
    totalAppointments: appointments.length,
    byStylist: load,
  };
}

// ============ Helpers ============

function createError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function formatAppointmentResponse(appt) {
  return {
    appointmentId: appt.appointment_id,
    customerId: appt.customer_id,
    stylistId: appt.stylist_id,
    appointmentDate: appt.appointment_date,
    appointmentTime: appt.appointment_time,
    durationMinutes: appt.duration_minutes,
    appointmentStatus: appt.appointment_status,
    notes: appt.notes,
    jobId: appt.job_id,
  };
}

function generateTimeSlots(startTime, endTime, intervalMinutes) {
  const slots = [];
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  let current = new Date();
  current.setHours(startHour, startMin, 0, 0);
  const end = new Date();
  end.setHours(endHour, endMin, 0, 0);

  while (current < end) {
    const hours = String(current.getHours()).padStart(2, '0');
    const minutes = String(current.getMinutes()).padStart(2, '0');
    slots.push(`${hours}:${minutes}`);
    current.setMinutes(current.getMinutes() + intervalMinutes);
  }

  return slots;
}

function isSlotBooked(slotTime, appointment) {
  // Slot is booked if it falls within [appt.time, appt.time + duration)
  // e.g., appt at 14:30 for 60 min occupies 14:30–15:30
  // Slots 14:30, 14:45, 15:00, 15:15 are booked
  // Slot 15:30 is free

  const [slotHour, slotMin] = slotTime.split(':').map(Number);
  const [apptHour, apptMin] = appointment.appointment_time.split(':').map(Number);

  const slotTotalMin = slotHour * 60 + slotMin;
  const apptTotalMin = apptHour * 60 + apptMin;
  const apptEndMin = apptTotalMin + appointment.duration_minutes;

  return slotTotalMin >= apptTotalMin && slotTotalMin < apptEndMin;
}
