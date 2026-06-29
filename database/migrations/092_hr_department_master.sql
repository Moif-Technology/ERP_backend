-- 092_hr_department_master.sql  Department master for HR module

CREATE TABLE IF NOT EXISTS hr.department_master (
  company_id  INTEGER      NOT NULL,
  branch_id   INTEGER      NOT NULL,
  dept_id     INTEGER      NOT NULL,
  dept_name   VARCHAR(80)  NOT NULL,
  PRIMARY KEY (company_id, branch_id, dept_id)
);
