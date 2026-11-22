# Verification scope

This repository begins with Ibrahim Abdelrahman's delivered Accord source. Template checks use disposable databases, synthetic documents and test identities; they do not reuse customer records, signed outputs or production credentials.

The application unit and PostgreSQL integration tests cover document/signing workflows, roles, company isolation, consent, audit/evidence integrity, templates, contacts, delivery behavior, recovery and visibility filtering. The production-image template test additionally checks real browser login, seeded documents, archived visibility/CSV export, role restrictions and edit persistence after restart.

PDF uploads preserve their original presentation. DOCX conversion is limited; see the README. Provider email delivery, customer webhook endpoints, external scheduler ownership, managed database recovery, physical-device behavior and legal compliance require separate deployment-specific verification.
