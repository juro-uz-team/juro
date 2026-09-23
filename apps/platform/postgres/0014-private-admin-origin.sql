ALTER TABLE app.admin_handoff_tickets
  DROP CONSTRAINT admin_handoff_tickets_destination_check;
ALTER TABLE app.admin_handoff_tickets
  ADD CONSTRAINT admin_handoff_tickets_destination_check CHECK (
    destination_origin LIKE 'https://%'
    OR (environment = 'development' AND destination_origin ~ '^http://(localhost|127\.0\.0\.1):[0-9]{1,5}$')
  );
