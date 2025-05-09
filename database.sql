-- add for false delete
ALTER TABLE notes ADD COLUMN deleted BOOLEAN DEFAULT false;
-- adding file path 
ALTER TABLE notes ADD COLUMN file TEXT;

-- adding tage many-to-many
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
)

CREATE TABLE note_tags (
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    PRIMARY KEY (tag_id, note_id)
)