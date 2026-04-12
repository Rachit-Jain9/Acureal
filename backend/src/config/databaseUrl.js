'use strict';

const normalizeDatabaseUrl = (connectionString) => {
  if (!connectionString || typeof connectionString !== 'string') {
    return connectionString;
  }

  const protocolMatch = connectionString.match(/^(postgres(?:ql)?:\/\/)(.+)$/i);
  if (!protocolMatch) {
    return connectionString;
  }

  const [, protocol, remainder] = protocolMatch;
  const firstSlashIndex = remainder.indexOf('/');
  if (firstSlashIndex === -1) {
    return connectionString;
  }

  const authority = remainder.slice(0, firstSlashIndex);
  const pathAndQuery = remainder.slice(firstSlashIndex);
  const atIndex = authority.lastIndexOf('@');
  if (atIndex === -1) {
    return connectionString;
  }

  const credentials = authority.slice(0, atIndex);
  const host = authority.slice(atIndex + 1);
  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) {
    return connectionString;
  }

  const username = credentials.slice(0, colonIndex);
  const password = credentials.slice(colonIndex + 1);
  const encodedPassword = encodeURIComponent(password);

  if (encodedPassword === password) {
    return connectionString;
  }

  return `${protocol}${username}:${encodedPassword}@${host}${pathAndQuery}`;
};

module.exports = { normalizeDatabaseUrl };
