CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  product_role TEXT NOT NULL DEFAULT 'analyst'
    CHECK (product_role IN ('analyst', 'deal_lead', 'ic_approver', 'admin_portfolio', 'viewer')),
  show_contextual_help BOOLEAN NOT NULL DEFAULT TRUE,
  dismissed_help_keys TEXT[] NOT NULL DEFAULT '{}',
  onboarding_state JSONB NOT NULL DEFAULT '{"completed": [], "dismissed": false}'::jsonb,
  preferred_asset_classes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_preferences_select_self ON public.user_preferences;
DROP POLICY IF EXISTS user_preferences_insert_self ON public.user_preferences;
DROP POLICY IF EXISTS user_preferences_update_self ON public.user_preferences;
DROP POLICY IF EXISTS user_preferences_delete_self ON public.user_preferences;

CREATE POLICY user_preferences_select_self
  ON public.user_preferences
  FOR SELECT
  USING (user_id = current_user_id());

CREATE POLICY user_preferences_insert_self
  ON public.user_preferences
  FOR INSERT
  WITH CHECK (user_id = current_user_id());

CREATE POLICY user_preferences_update_self
  ON public.user_preferences
  FOR UPDATE
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

CREATE POLICY user_preferences_delete_self
  ON public.user_preferences
  FOR DELETE
  USING (user_id = current_user_id());

CREATE OR REPLACE FUNCTION public.touch_user_preferences_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_preferences_touch_updated_at ON public.user_preferences;
CREATE TRIGGER user_preferences_touch_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_preferences_updated_at();
