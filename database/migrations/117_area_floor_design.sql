-- 117_area_floor_design.sql
-- Legacy MSSQL: dbo.AreaFloorShape, dbo.AreaTableLayout, dbo.AreaFloorBorderPoint
-- (TableFloorDesignerFrm / TableFloorRuntimeFrm). StationID -> branch_id,
-- UploadStatus -> sync_status. Coordinates stay percent of canvas (0–100).

CREATE TABLE IF NOT EXISTS core.area_floor_shape (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT        NOT NULL,
  branch_id           BIGINT        NOT NULL,
  area_id             BIGINT        NOT NULL,
  shape_type          VARCHAR(20)   NOT NULL,
  pos_x_percent       NUMERIC(8,4)  NOT NULL,
  pos_y_percent       NUMERIC(8,4)  NOT NULL,
  width_percent       NUMERIC(8,4)  NOT NULL,
  height_percent      NUMERIC(8,4)  NOT NULL,
  back_color_argb     INTEGER       NULL,
  border_color_argb   INTEGER       NULL,
  display_text        VARCHAR(100)  NULL,
  font_size           NUMERIC(4,1)  NULL,
  sync_status         VARCHAR(50)   NOT NULL DEFAULT 'PENDING',
  created_at          TIMESTAMP     NOT NULL DEFAULT NOW(),
  modified_at         TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_area_floor_shape_area
    FOREIGN KEY (company_id, branch_id, area_id)
    REFERENCES core.area_master (company_id, branch_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_area_floor_shape_company_branch_area
  ON core.area_floor_shape (company_id, branch_id, area_id);

CREATE TABLE IF NOT EXISTS core.area_table_layout (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT        NOT NULL,
  branch_id           BIGINT        NOT NULL,
  area_id             BIGINT        NOT NULL,
  table_id            BIGINT        NOT NULL,
  pos_x_percent       NUMERIC(8,4)  NOT NULL,
  pos_y_percent       NUMERIC(8,4)  NOT NULL,
  width_percent       NUMERIC(8,4)  NULL,
  height_percent      NUMERIC(8,4)  NULL,
  rotation_deg        INTEGER       NULL DEFAULT 0,
  sync_status         VARCHAR(50)   NOT NULL DEFAULT 'PENDING',
  created_at          TIMESTAMP     NOT NULL DEFAULT NOW(),
  modified_at         TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_area_table_layout_table
    UNIQUE (company_id, branch_id, area_id, table_id),
  CONSTRAINT fk_area_table_layout_area
    FOREIGN KEY (company_id, branch_id, area_id)
    REFERENCES core.area_master (company_id, branch_id, area_id),
  CONSTRAINT fk_area_table_layout_table
    FOREIGN KEY (company_id, branch_id, table_id)
    REFERENCES core.table_master (company_id, branch_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_area_table_layout_company_branch_area
  ON core.area_table_layout (company_id, branch_id, area_id);

CREATE TABLE IF NOT EXISTS core.area_floor_border_point (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT        NOT NULL,
  branch_id           BIGINT        NOT NULL,
  area_id             BIGINT        NOT NULL,
  sequence_no         INTEGER       NOT NULL,
  pos_x_percent       NUMERIC(8,4)  NOT NULL,
  pos_y_percent       NUMERIC(8,4)  NOT NULL,
  sync_status         VARCHAR(50)   NOT NULL DEFAULT 'PENDING',
  created_at          TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_area_floor_border_point_seq
    UNIQUE (company_id, branch_id, area_id, sequence_no),
  CONSTRAINT fk_area_floor_border_point_area
    FOREIGN KEY (company_id, branch_id, area_id)
    REFERENCES core.area_master (company_id, branch_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_area_floor_border_point_company_branch_area
  ON core.area_floor_border_point (company_id, branch_id, area_id, sequence_no);
