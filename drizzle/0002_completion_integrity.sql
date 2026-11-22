-- Additive guards: preserve the existing migration history and immutable byte records.
CREATE UNIQUE INDEX output_receipt ON outputs(envelope_id) WHERE kind='receipt';
ALTER TABLE documents ADD CONSTRAINT document_envelope_id UNIQUE(envelope_id,id);
ALTER TABLE envelopes ADD CONSTRAINT envelope_company_id UNIQUE(company_id,id);
ALTER TABLE recipients ADD CONSTRAINT recipient_envelope_id UNIQUE(envelope_id,id);
ALTER TABLE envelopes ADD CONSTRAINT owner_company_membership FOREIGN KEY(company_id,owner_id) REFERENCES memberships(company_id,user_id);
ALTER TABLE outputs ADD CONSTRAINT output_document_envelope FOREIGN KEY(envelope_id,document_id) REFERENCES documents(envelope_id,id);
ALTER TABLE audit_events ADD CONSTRAINT audit_envelope_company FOREIGN KEY(company_id,envelope_id) REFERENCES envelopes(company_id,id);
ALTER TABLE outbox ADD CONSTRAINT outbox_recipient_envelope FOREIGN KEY(envelope_id,recipient_id) REFERENCES recipients(envelope_id,id);
ALTER TABLE recipients ADD CONSTRAINT signed_evidence CHECK(status<>'signed' OR (consent_at IS NOT NULL AND signed_at IS NOT NULL AND submission_key IS NOT NULL AND submission_hash IS NOT NULL));
ALTER TABLE outputs ADD CONSTRAINT output_kind CHECK(kind IN ('signed_pdf','receipt'));
ALTER TABLE outputs ADD CONSTRAINT output_reference CHECK((kind='receipt' AND document_id IS NULL) OR (kind='signed_pdf' AND document_id IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION esign_recipient_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('signed','declined') AND (NEW.status,NEW.values,NEW.consent_at,NEW.signed_at,NEW.submission_key,NEW.submission_hash) IS DISTINCT FROM (OLD.status,OLD.values,OLD.consent_at,OLD.signed_at,OLD.submission_key,OLD.submission_hash) THEN
  RAISE EXCEPTION 'Recipient evidence is immutable after submission';
 END IF;
 IF OLD.consent_at IS NOT NULL AND NEW.consent_at IS DISTINCT FROM OLD.consent_at THEN RAISE EXCEPTION 'Consent cannot be rewritten'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recipient_evidence BEFORE UPDATE ON recipients FOR EACH ROW EXECUTE FUNCTION esign_recipient_evidence();
--> statement-breakpoint
CREATE FUNCTION esign_completion_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state text;
BEGIN
 SELECT state INTO current_state FROM envelopes WHERE id=NEW.id;
 IF current_state='completed' THEN
  IF NOT EXISTS(SELECT 1 FROM recipients WHERE envelope_id=NEW.id) OR EXISTS(SELECT 1 FROM recipients WHERE envelope_id=NEW.id AND status<>'signed') THEN RAISE EXCEPTION 'All recipients must sign before completion'; END IF;
  IF NOT EXISTS(SELECT 1 FROM documents WHERE envelope_id=NEW.id) OR EXISTS(SELECT 1 FROM documents d WHERE d.envelope_id=NEW.id AND NOT EXISTS(SELECT 1 FROM outputs o WHERE o.envelope_id=d.envelope_id AND o.document_id=d.id AND kind='signed_pdf')) OR NOT EXISTS(SELECT 1 FROM outputs WHERE envelope_id=NEW.id AND kind='receipt') THEN RAISE EXCEPTION 'Completion requires every flattened PDF and receipt'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER completion_consistency AFTER UPDATE ON envelopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION esign_completion_consistency();
