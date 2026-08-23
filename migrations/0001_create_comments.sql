CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_key TEXT NOT NULL,
    parent_id INTEGER REFERENCES comments(id),
    nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    client_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CHECK (length(page_key) BETWEEN 1 AND 180),
    CHECK (length(nickname) BETWEEN 0 AND 24),
    CHECK (length(content) BETWEEN 0 AND 800)
);

CREATE INDEX IF NOT EXISTS idx_comments_page_roots
    ON comments(page_key, parent_id, status, id DESC);

CREATE INDEX IF NOT EXISTS idx_comments_parent
    ON comments(parent_id, status, id ASC);

CREATE INDEX IF NOT EXISTS idx_comments_client_time
    ON comments(client_hash, created_at DESC);
