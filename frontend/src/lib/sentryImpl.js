// Real Sentry SDK wrapper.
//
// This module STATICALLY imports @sentry/react and references only `init` and
// `captureException`, so Rollup can tree-shake the SDK down to just those paths
// (the same small chunk the app shipped before Sentry was made lazy). It is only
// ever reached through a dynamic import() from ./sentry, so that tree-shaken
// chunk stays OFF the first-paint critical path — best of both: small AND async.
import * as Sentry from '@sentry/react';

export function sentryInit(config) {
  Sentry.init(config);
}

export function sentryCapture(error, context) {
  Sentry.captureException(error, context);
}
