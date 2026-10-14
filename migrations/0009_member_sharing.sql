-- Members share a split with their own link. Someone opening it asks to join, and the
-- owner approves or declines: their split_invites row has needs_approval set until then.
-- The owner's link stays splits.invite_token; members' links are split_members.share_token.
ALTER TABLE split_members ADD COLUMN share_token TEXT;
UPDATE split_members SET share_token = lower(hex(randomblob(18))) WHERE role = 'editor';
CREATE UNIQUE INDEX split_members_by_share_token ON split_members(share_token);
ALTER TABLE split_invites ADD COLUMN needs_approval INTEGER NOT NULL DEFAULT 0
  CHECK (needs_approval IN (0, 1));
