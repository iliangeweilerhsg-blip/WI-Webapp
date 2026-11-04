-- updated_at (03 §1) pflegt die Datenbank selbst, damit Core und Worker es nie vergessen.
-- Setzt der Schreiber updated_at ausdrücklich, bleibt sein Wert erhalten.
CREATE OR REPLACE FUNCTION sg_touch_updated_at() RETURNS trigger AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'semester', 'module', 'calendar_source', 'calendar_event', 'session',
    'slide_deck', 'slide', 'exercise_sheet', 'task', 'task_slide_link',
    'job', 'setting', 'device', 'backup_run', 'cost_entry'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at()',
      t || '_touch_updated_at', t);
  END LOOP;
END;
$$;
