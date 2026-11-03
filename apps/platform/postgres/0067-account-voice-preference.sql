ALTER TABLE app.user_profiles ADD COLUMN IF NOT EXISTS speech_voice text NOT NULL DEFAULT 'marin' CHECK (speech_voice IN ('marin', 'cedar'));
