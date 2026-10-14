DELETE FROM core.staff_master
 WHERE staff_code IN ('DB-AHMED', 'DB-HASSAN')
   AND UPPER(TRIM(COALESCE(designation, ''))) = 'DELIVERY BOY'
   AND created_by = 'seed';
