-- Additive migration: old Workers continue to work while the new version deploys.
ALTER TABLE comments ADD COLUMN request_id TEXT;
ALTER TABLE comments ADD COLUMN request_fingerprint TEXT;

CREATE UNIQUE INDEX idx_comments_client_request
    ON comments(client_hash, request_id) WHERE request_id IS NOT NULL;

CREATE TABLE comments_schema (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    version INTEGER NOT NULL
);
INSERT INTO comments_schema (singleton, version) VALUES (1, 2);
