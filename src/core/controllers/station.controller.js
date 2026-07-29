import { pool } from '../../config/db.js';
import * as stationRepo from '../repositories/station.repository.js';

// Must stay in sync with chk_station_type on core.station_master
// (see database/migrations/104_salon_pos.sql).
// Note the naming split: station types use UNDERSCORES (SALON_POS) while role
// software types use HYPHENS (SALON-POS). They are different vocabularies.
const VALID_TYPES = new Set(['BACKOFFICE', 'COUNTER_POS', 'RESTAURANT_POS', 'SALON_POS']);

export async function listStations(req, res) {
  try {
    const rows = await stationRepo.listStationsByCompany(pool, req.authStaff.company_id);
    return res.json({ stations: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load stations' });
  }
}

export async function createStation(req, res) {
  try {
    const companyId = req.authStaff.company_id;
    const { stationCode, stationName, stationType, branchId, counterNo } = req.body;

    if (!stationCode || !String(stationCode).trim()) {
      return res.status(400).json({ message: 'stationCode is required' });
    }
    if (!stationName || !String(stationName).trim()) {
      return res.status(400).json({ message: 'stationName is required' });
    }
    const type = String(stationType || '').toUpperCase();
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ message: `Invalid stationType. Valid: ${[...VALID_TYPES].join(', ')}` });
    }
    const brId = Number(branchId);
    if (!Number.isFinite(brId) || brId < 1) {
      return res.status(400).json({ message: 'branchId is required' });
    }

    const stationId = await stationRepo.nextStationId(pool, companyId);
    const station = await stationRepo.insertStation(pool, {
      companyId,
      stationId,
      branchId: brId,
      stationCode: String(stationCode).trim().toUpperCase(),
      stationName: String(stationName).trim(),
      stationType: type,
      counterNo: counterNo != null && counterNo !== '' ? Number(counterNo) : null,
      createdBy: req.authStaff.staff_id,
    });
    return res.status(201).json({ station });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not create station' });
  }
}

export async function updateStation(req, res) {
  try {
    const companyId = req.authStaff.company_id;
    const stationId = Number(req.params.stationId);
    if (!Number.isFinite(stationId)) {
      return res.status(400).json({ message: 'Invalid stationId' });
    }
    const { stationCode, stationName, stationType, branchId, counterNo } = req.body;
    if (!stationCode || !String(stationCode).trim()) {
      return res.status(400).json({ message: 'stationCode is required' });
    }
    if (!stationName || !String(stationName).trim()) {
      return res.status(400).json({ message: 'stationName is required' });
    }
    const type = String(stationType || '').toUpperCase();
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ message: 'Invalid stationType' });
    }
    const brId = Number(branchId);
    if (!Number.isFinite(brId) || brId < 1) {
      return res.status(400).json({ message: 'branchId is required' });
    }

    const station = await stationRepo.updateStation(pool, {
      companyId,
      stationId,
      branchId: brId,
      stationCode: String(stationCode).trim().toUpperCase(),
      stationName: String(stationName).trim(),
      stationType: type,
      counterNo: counterNo != null && counterNo !== '' ? Number(counterNo) : null,
      modifiedBy: req.authStaff.staff_id,
    });
    if (!station) {
      return res.status(404).json({ message: 'Station not found' });
    }
    return res.json({ station });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not update station' });
  }
}

export async function deleteStation(req, res) {
  try {
    const companyId = req.authStaff.company_id;
    const stationId = Number(req.params.stationId);
    if (!Number.isFinite(stationId)) {
      return res.status(400).json({ message: 'Invalid stationId' });
    }

    const deleted = await stationRepo.softDeleteStation(pool, companyId, stationId, req.authStaff.staff_id);
    if (!deleted) {
      return res.status(404).json({ message: 'Station not found or already deleted' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not delete station' });
  }
}
