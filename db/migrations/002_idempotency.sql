CREATE TABLE idempotency_keys (
	idempotency_key TEXT    NOT NULL,
	method          TEXT    NOT NULL,
	path            TEXT    NOT NULL,
	request_hash    TEXT    NOT NULL,
	state           TEXT    NOT NULL CHECK (state IN ('in_progress', 'completed')),
	response_status INTEGER,
	response_body   TEXT,
	created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	completed_at    TEXT,
	PRIMARY KEY (idempotency_key, method, path)
);

CREATE INDEX idx_idempotency_created ON idempotency_keys (created_at);
