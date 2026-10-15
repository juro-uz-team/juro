SET search_path TO app, public;
ALTER TABLE practice_invoices ADD COLUMN language text NOT NULL DEFAULT 'ru'
 CHECK(language IN ('ru','uz','en'));
ALTER TABLE practice_recurring_services ADD COLUMN language text NOT NULL DEFAULT 'ru'
 CHECK(language IN ('ru','uz','en'));
