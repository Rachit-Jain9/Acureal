'use strict';

const WRAPPER_METADATA_KEYS = new Set([
  'doc_type',
  'document_type',
  'confidence',
  'reason',
  'language',
  'language_detected',
  'notes',
  'needs_human_review',
]);

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const unwrapStructuredFields = (value) => {
  if (!isPlainObject(value) || !isPlainObject(value.extracted_json)) {
    return value;
  }

  const siblingKeys = Object.keys(value).filter((key) => key !== 'extracted_json');
  const isWrapper = siblingKeys.every((key) => WRAPPER_METADATA_KEYS.has(key));
  return isWrapper ? value.extracted_json : value;
};

const toPlainObject = (value) => {
  const unwrapped = unwrapStructuredFields(value);
  return isPlainObject(unwrapped) ? unwrapped : {};
};

const mergeStructuredFields = (baseFields, corrections) => ({
  ...toPlainObject(baseFields),
  ...toPlainObject(corrections),
});

module.exports = {
  unwrapStructuredFields,
  toPlainObject,
  mergeStructuredFields,
};
