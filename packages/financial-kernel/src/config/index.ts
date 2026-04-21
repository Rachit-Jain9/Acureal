/**
 * Config barrel. Consumers should `import { INDIA_CONFIG } from '...config'`
 * rather than reaching into sub-files, so we can reorganize without breaking
 * call-sites.
 */
export * from './india';
export {
  GLOBAL_DEFAULTS_META,
  GLOBAL_DEFAULTS_VALUES,
  ASSET_DEFAULTS_META,
  ASSET_DEFAULTS_VALUES,
  getAssetDefaultsMeta,
  getDefaultMeta,
  getDefaultValue,
  listDefaultKeys,
  SUPPORTED_ASSET_CLASSES,
} from './defaults';
export type { DefaultUnit, DefaultMeta, DefaultsBlock } from './defaults';
