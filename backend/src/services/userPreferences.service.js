'use strict';

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { ASSET_CLASSES, normalizeAssetClass } = require('../constants/assetClasses');

const PRODUCT_ROLES = ['analyst', 'deal_lead', 'ic_approver', 'admin_portfolio', 'viewer'];

const DEFAULT_PREFERENCES = {
  productRole: 'analyst',
  showContextualHelp: true,
  dismissedHelpKeys: [],
  onboardingState: { completed: [], dismissed: false },
  preferredAssetClasses: [],
};

const toApi = (row) => ({
  userId: row.user_id,
  productRole: row.product_role,
  showContextualHelp: row.show_contextual_help,
  dismissedHelpKeys: row.dismissed_help_keys || [],
  onboardingState: row.onboarding_state || DEFAULT_PREFERENCES.onboardingState,
  preferredAssetClasses: row.preferred_asset_classes || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const sanitizePreferencesPatch = (payload = {}) => {
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'productRole')) {
    if (!PRODUCT_ROLES.includes(payload.productRole)) {
      throw createError('Invalid product role.', 400);
    }
    patch.productRole = payload.productRole;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'showContextualHelp')) {
    patch.showContextualHelp = Boolean(payload.showContextualHelp);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'dismissedHelpKeys')) {
    if (!Array.isArray(payload.dismissedHelpKeys)) {
      throw createError('Dismissed help keys must be a list.', 400);
    }
    patch.dismissedHelpKeys = [...new Set(
      payload.dismissedHelpKeys.map((key) => String(key).trim()).filter(Boolean)
    )].slice(0, 200);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'onboardingState')) {
    if (!payload.onboardingState || typeof payload.onboardingState !== 'object' || Array.isArray(payload.onboardingState)) {
      throw createError('Onboarding state must be an object.', 400);
    }
    patch.onboardingState = payload.onboardingState;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'preferredAssetClasses')) {
    if (!Array.isArray(payload.preferredAssetClasses)) {
      throw createError('Preferred asset classes must be a list.', 400);
    }
    const assetClasses = [...new Set(payload.preferredAssetClasses.map(normalizeAssetClass))]
      .filter((assetClass) => ASSET_CLASSES.includes(assetClass));
    patch.preferredAssetClasses = assetClasses.slice(0, 9);
  }

  return patch;
};

const getPreferences = async (userId) => {
  const result = await query(
    `SELECT user_id, product_role, show_contextual_help, dismissed_help_keys,
            onboarding_state, preferred_asset_classes, created_at, updated_at
       FROM user_preferences
      WHERE user_id = $1`,
    [userId]
  );

  if (result.rows[0]) {
    return toApi(result.rows[0]);
  }

  return {
    userId,
    ...DEFAULT_PREFERENCES,
    createdAt: null,
    updatedAt: null,
  };
};

const upsertPreferences = async (userId, payload = {}) => {
  const patch = sanitizePreferencesPatch(payload);
  const current = await getPreferences(userId);
  const merged = { ...current, ...patch };
  const result = await query(
    `INSERT INTO user_preferences (
       user_id,
       product_role,
       show_contextual_help,
       dismissed_help_keys,
       onboarding_state,
       preferred_asset_classes
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id)
     DO UPDATE SET
       product_role = EXCLUDED.product_role,
       show_contextual_help = EXCLUDED.show_contextual_help,
       dismissed_help_keys = EXCLUDED.dismissed_help_keys,
       onboarding_state = EXCLUDED.onboarding_state,
       preferred_asset_classes = EXCLUDED.preferred_asset_classes
     RETURNING user_id, product_role, show_contextual_help, dismissed_help_keys,
               onboarding_state, preferred_asset_classes, created_at, updated_at`,
    [
      userId,
      merged.productRole,
      merged.showContextualHelp,
      merged.dismissedHelpKeys,
      JSON.stringify(merged.onboardingState),
      merged.preferredAssetClasses,
    ]
  );

  return toApi(result.rows[0]);
};

module.exports = {
  PRODUCT_ROLES,
  DEFAULT_PREFERENCES,
  getPreferences,
  sanitizePreferencesPatch,
  upsertPreferences,
};
