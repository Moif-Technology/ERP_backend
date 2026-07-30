import * as appointmentService from '../services/appointment.service.js';

/**
 * POST /api/salon-pos/appointments
 * Create new appointment
 */
export async function createAppointment(req, res, next) {
  try {
    const result = await appointmentService.createAppointment(req.app.get('pool'), req.body, req.authStaff);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/salon-pos/appointments?date=YYYY-MM-DD&stylistId=X
 * List appointments for date (optionally filtered by stylist)
 */
export async function listAppointments(req, res, next) {
  try {
    const { date, stylistId } = req.query;
    if (!date) {
      const err = new Error('date query parameter is required (YYYY-MM-DD format)');
      err.status = 400;
      throw err;
    }
    const result = await appointmentService.listAppointments(req.app.get('pool'), {
      date,
      stylistId: stylistId ? Number(stylistId) : null,
    }, req.authStaff);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/salon-pos/appointments/:appointmentId
 * Get single appointment detail
 */
export async function getAppointmentDetail(req, res, next) {
  try {
    const result = await appointmentService.getAppointmentDetail(
      req.app.get('pool'),
      req.params.appointmentId,
      req.authStaff,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/salon-pos/appointments/:appointmentId
 * Update appointment (reschedule, notes, etc.)
 */
export async function updateAppointment(req, res, next) {
  try {
    const result = await appointmentService.updateAppointment(
      req.app.get('pool'),
      req.params.appointmentId,
      req.body,
      req.authStaff,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/salon-pos/appointments/:appointmentId
 * Cancel appointment (soft delete on appointment_status)
 */
export async function cancelAppointment(req, res, next) {
  try {
    await appointmentService.cancelAppointment(
      req.app.get('pool'),
      req.params.appointmentId,
      req.authStaff,
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/salon-pos/appointments/:appointmentId/confirm
 * Confirm appointment (move from SCHEDULED to CONFIRMED)
 */
export async function confirmAppointment(req, res, next) {
  try {
    const result = await appointmentService.confirmAppointment(
      req.app.get('pool'),
      req.params.appointmentId,
      req.authStaff,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/salon-pos/appointments/:appointmentId/check-in
 * Link appointment to job (set job_id, mark CONFIRMED)
 */
export async function checkInAppointment(req, res, next) {
  try {
    const { jobId } = req.body;
    if (!jobId) {
      const err = new Error('jobId is required');
      err.status = 400;
      throw err;
    }
    const result = await appointmentService.checkInAppointment(
      req.app.get('pool'),
      req.params.appointmentId,
      jobId,
      req.authStaff,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/salon-pos/stylists/:stylistId/availability?date=YYYY-MM-DD
 * Get available slots for stylist on given date (15-min intervals)
 */
export async function getStylistAvailability(req, res, next) {
  try {
    const { date } = req.query;
    if (!date) {
      const err = new Error('date query parameter is required (YYYY-MM-DD format)');
      err.status = 400;
      throw err;
    }
    const result = await appointmentService.getStylistAvailability(
      req.app.get('pool'),
      Number(req.params.stylistId),
      date,
      req.authStaff,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/salon-pos/appointments/stats/daily-load?date=YYYY-MM-DD
 * Get salon-wide appointment load for the day
 */
export async function getDailyLoad(req, res, next) {
  try {
    const { date } = req.query;
    if (!date) {
      const err = new Error('date query parameter is required (YYYY-MM-DD format)');
      err.status = 400;
      throw err;
    }
    const result = await appointmentService.getDailyLoad(
      req.app.get('pool'),
      date,
      req.authStaff,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
