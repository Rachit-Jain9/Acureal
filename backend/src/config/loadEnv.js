'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..', '..');
const protectedKeys = new Set(Object.keys(process.env));

const getEnvFiles = (nodeEnv = process.env.NODE_ENV || 'development') => {
  const files = ['.env'];

  if (nodeEnv) {
    files.push(`.env.${nodeEnv}`);
  }

  if (nodeEnv !== 'test') {
    files.push('.env.local');

    if (nodeEnv) {
      files.push(`.env.${nodeEnv}.local`);
    }
  }

  return files;
};

const loadEnv = (baseDir = backendRoot) => {
  const loadedFiles = [];

  for (const relativeFile of getEnvFiles()) {
    const fullPath = path.join(baseDir, relativeFile);

    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const parsed = dotenv.parse(fs.readFileSync(fullPath));

    for (const [key, value] of Object.entries(parsed)) {
      if (!protectedKeys.has(key)) {
        process.env[key] = value;
      }
    }

    loadedFiles.push(fullPath);
  }

  return loadedFiles;
};

loadEnv();

module.exports = { loadEnv, getEnvFiles };
