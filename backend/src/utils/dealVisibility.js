'use strict';

const buildVisibleDealCondition = (alias = 'd') =>
  `${alias}.organization_id = current_organization_id() AND ${alias}.is_archived = FALSE AND ${alias}.stage <> 'dead'`;

const buildVisiblePropertyCondition = (propertyAlias = 'p', dealAlias = 'linked_deal') => `
  ${propertyAlias}.organization_id = current_organization_id()
  AND (
    NOT EXISTS (
      SELECT 1
      FROM deals ${dealAlias}
      WHERE ${dealAlias}.property_id = ${propertyAlias}.id
    )
    OR EXISTS (
      SELECT 1
      FROM deals ${dealAlias}
      WHERE ${dealAlias}.property_id = ${propertyAlias}.id
        AND ${buildVisibleDealCondition(dealAlias)}
    )
  )
`;

module.exports = {
  buildVisibleDealCondition,
  buildVisiblePropertyCondition,
};
