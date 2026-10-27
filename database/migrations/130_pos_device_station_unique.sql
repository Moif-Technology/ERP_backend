-- 130_pos_device_station_unique.sql
-- One active Counter-POS terminal per station. Enroll API checks this first and
-- returns 409; the index stops two terminals racing onto the same station.

-- Existing duplicates: keep the most recently enrolled terminal per station.
UPDATE core.pos_device_enrollment d
   SET record_status = 'INACTIVE', last_seen_at = NOW()
 WHERE d.record_status = 'ACTIVE'
   AND d.station_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM core.pos_device_enrollment n
      WHERE n.company_id = d.company_id
        AND n.station_id = d.station_id
        AND n.record_status = 'ACTIVE'
        AND (n.enrolled_at > d.enrolled_at
             OR (n.enrolled_at = d.enrolled_at AND n.id > d.id))
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_device_enrollment_active_station
  ON core.pos_device_enrollment (company_id, station_id)
  WHERE record_status = 'ACTIVE' AND station_id IS NOT NULL;
