-- An account is one person in a split. The Worker refuses a second link with a clear
-- message; this catches two changes racing past that check (answered as a conflict).
CREATE UNIQUE INDEX people_member_email ON people (split_id, member_email)
  WHERE member_email IS NOT NULL;
