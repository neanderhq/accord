-- Database invariants complement per-operation authorization. Use a restricted runtime
-- role in production; a database owner can disable triggers and is not an audit boundary.
ALTER TABLE memberships ADD CONSTRAINT membership_role CHECK (role IN ('admin','sender','read-only'));
ALTER TABLE envelopes ADD CONSTRAINT envelope_state CHECK (state IN ('draft','sent','viewed','part-signed','completed','declined','expired','voided'));
ALTER TABLE envelopes ADD CONSTRAINT envelope_routing CHECK (routing IN ('parallel','sequential'));
ALTER TABLE recipients ADD CONSTRAINT recipient_state CHECK (status IN ('pending','viewed','signed','declined'));
ALTER TABLE recipients ADD CONSTRAINT recipient_attempts CHECK (attempts >= 0);
ALTER TABLE documents ADD CONSTRAINT bounded_document CHECK (size=octet_length(original) AND size=octet_length(signing) AND size BETWEEN 16 AND 8388608);
ALTER TABLE outputs ADD CONSTRAINT output_size CHECK (size=octet_length(bytes) AND size > 0);
ALTER TABLE outbox ADD CONSTRAINT verification_dispatch_only CHECK (status='verification_only');
--> statement-breakpoint
CREATE FUNCTION esign_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only or immutable', TG_TABLE_NAME; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION esign_immutable();
CREATE TRIGGER document_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON documents FOR EACH STATEMENT EXECUTE FUNCTION esign_immutable();
CREATE TRIGGER output_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON outputs FOR EACH STATEMENT EXECUTE FUNCTION esign_immutable();
--> statement-breakpoint
CREATE FUNCTION esign_freeze_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state <> 'draft' AND (NEW.title,NEW.routing,NEW.fields,NEW.company_id,NEW.expires_at,NEW.sent_at) IS DISTINCT FROM (OLD.title,OLD.routing,OLD.fields,OLD.company_id,OLD.expires_at,OLD.sent_at) THEN
  RAISE EXCEPTION 'Sent envelope content is frozen';
 END IF;
 IF OLD.state IN ('completed','declined','expired','voided') AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'Terminal envelope cannot reopen'; END IF;
 IF OLD.state='draft' AND NEW.state NOT IN ('draft','sent') THEN RAISE EXCEPTION 'Invalid draft transition'; END IF;
 IF OLD.state<>'draft' AND NEW.state='draft' THEN RAISE EXCEPTION 'Cannot return to draft'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER freeze_envelope BEFORE UPDATE ON envelopes FOR EACH ROW EXECUTE FUNCTION esign_freeze_envelope();
--> statement-breakpoint
CREATE FUNCTION esign_draft_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM envelopes WHERE id=NEW.envelope_id AND state='draft') THEN RAISE EXCEPTION 'Documents can only be added to drafts'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER draft_document BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION esign_draft_document();
--> statement-breakpoint
CREATE FUNCTION esign_freeze_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid;
BEGIN
 eid := CASE WHEN TG_OP='DELETE' THEN OLD.envelope_id ELSE NEW.envelope_id END;
 IF NOT EXISTS(SELECT 1 FROM envelopes WHERE id=eid AND state='draft') THEN
  IF TG_OP='INSERT' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Sent recipient assignments are frozen'; END IF;
  IF (NEW.id,NEW.envelope_id,NEW.name,NEW.email,NEW.routing_order,NEW.access_verifier) IS DISTINCT FROM (OLD.id,OLD.envelope_id,OLD.name,OLD.email,OLD.routing_order,OLD.access_verifier) THEN RAISE EXCEPTION 'Sent recipient assignments are frozen'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER freeze_recipient BEFORE INSERT OR UPDATE OR DELETE ON recipients FOR EACH ROW EXECUTE FUNCTION esign_freeze_recipient();
