-- Add module column to core.document_sequence for per-module grouping.
-- Backfill existing rows with 'BACKOFFICE' as default module.

ALTER TABLE core.document_sequence
  ADD COLUMN IF NOT EXISTS module VARCHAR(30) NOT NULL DEFAULT 'BACKOFFICE';

-- Backfill known accounting sequences if already present
UPDATE core.document_sequence SET module = 'ACCOUNTS'
  WHERE sequence_code IN ('VOUCHER','JOURNAL','PAYMENT','CONTRA','DEBIT_NOTE','CREDIT_NOTE','EXPENSE','INCOME','RECEIPT');

UPDATE core.document_sequence SET module = 'GARAGE'
  WHERE sequence_code IN ('JOB_CARD','ESTIMATION','GATE_PASS','GARAGE_INVOICE','PART_REQUEST','PRE_JOB_CARD','SUBLET_LPO');

UPDATE core.document_sequence SET module = 'CRM'
  WHERE sequence_code IN ('LEAD','OPPORTUNITY');

UPDATE core.document_sequence SET module = 'HR'
  WHERE sequence_code IN ('EMPLOYEE','STAFF');

UPDATE core.document_sequence SET module = 'RESTAURANT'
  WHERE sequence_code IN ('KOT','ADVANCE_PAYMENT');

UPDATE core.document_sequence SET module = 'COUNTER_POS'
  WHERE sequence_code IN ('HOLD_BILL','COUNTER_CLOSE');
