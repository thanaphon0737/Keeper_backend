-- add for false delete
ALTER TABLE notes ADD COLUMN deleted BOOLEAN DEFAULT false;
-- adding file path 
ALTER TABLE notes ADD COLUMN file TEXT;