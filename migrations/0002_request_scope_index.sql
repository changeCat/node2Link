-- Existing and new log rows share the same scope expression as the detail query.
CREATE INDEX IF NOT EXISTS node2link_requests_scope_key
  ON node2link_records (
    CASE WHEN json_extract(metadata, '$.access') = 'share'
      THEN json_extract(metadata, '$.subscriptionId') ELSE 'main' END,
    key
  )
  WHERE key GLOB 'requests.*' AND metadata IS NOT NULL;
