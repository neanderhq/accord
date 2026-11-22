CREATE TRIGGER source_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON source_files FOR EACH STATEMENT EXECUTE FUNCTION esign_immutable();
CREATE TRIGGER delivery_attempt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON delivery_attempts FOR EACH STATEMENT EXECUTE FUNCTION esign_immutable();
CREATE TRIGGER webhook_attempt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON webhook_attempts FOR EACH STATEMENT EXECUTE FUNCTION esign_immutable();
--> statement-breakpoint
ALTER TABLE action_tokens ADD CONSTRAINT action_token_kind CHECK(kind IN ('invite','reset'));
ALTER TABLE action_tokens ADD CONSTRAINT action_token_role CHECK(role IS NULL OR role IN ('admin','sender','read-only'));
ALTER TABLE delivery_jobs ADD CONSTRAINT bounded_delivery_attempts CHECK(attempts BETWEEN 0 AND 5);
ALTER TABLE webhook_events ADD CONSTRAINT bounded_webhook_attempts CHECK(attempts BETWEEN 0 AND 5);
ALTER TABLE envelope_lifecycle ADD CONSTRAINT reminder_interval CHECK(reminder_days BETWEEN 0 AND 30);
ALTER TABLE company_settings ADD CONSTRAINT retention_interval CHECK(retention_days BETWEEN 1 AND 3650);
--> statement-breakpoint
CREATE FUNCTION esign_step2_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='delivery_jobs' THEN
  IF NEW.envelope_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM envelopes WHERE id=NEW.envelope_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'Cross-company delivery denied'; END IF;
  IF NEW.recipient_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM recipients WHERE id=NEW.recipient_id AND envelope_id=NEW.envelope_id) THEN RAISE EXCEPTION 'Cross-envelope recipient denied'; END IF;
 ELSIF TG_TABLE_NAME='templates' THEN
  IF NOT EXISTS(SELECT 1 FROM envelopes WHERE id=NEW.source_envelope_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'Cross-company template denied'; END IF;
  IF TG_OP='UPDATE' AND (NEW.snapshot,NEW.roles,NEW.source_envelope_id,NEW.company_id) IS DISTINCT FROM (OLD.snapshot,OLD.roles,OLD.source_envelope_id,OLD.company_id) THEN RAISE EXCEPTION 'Saved template content is immutable'; END IF;
 ELSIF TG_TABLE_NAME='envelope_lifecycle' THEN
  IF NEW.predecessor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM envelopes a JOIN envelopes b ON b.company_id=a.company_id WHERE a.id=NEW.envelope_id AND b.id=NEW.predecessor_id AND a.id<>b.id) THEN RAISE EXCEPTION 'Invalid predecessor'; END IF;
  IF TG_OP='UPDATE' AND NEW.predecessor_id IS DISTINCT FROM OLD.predecessor_id THEN RAISE EXCEPTION 'Predecessor is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER scoped_delivery BEFORE INSERT OR UPDATE ON delivery_jobs FOR EACH ROW EXECUTE FUNCTION esign_step2_scope();
CREATE TRIGGER scoped_template BEFORE INSERT OR UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION esign_step2_scope();
CREATE TRIGGER scoped_lifecycle BEFORE INSERT OR UPDATE ON envelope_lifecycle FOR EACH ROW EXECUTE FUNCTION esign_step2_scope();
