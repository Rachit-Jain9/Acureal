'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

const runWithRequestContext = (value, callback) => storage.run(value, callback);

const getRequestContext = () => storage.getStore() || {};

const setRequestContext = (nextValue) => {
  const store = storage.getStore();
  if (!store) {
    return;
  }

  Object.assign(store, nextValue);
};

module.exports = {
  runWithRequestContext,
  getRequestContext,
  setRequestContext,
};
