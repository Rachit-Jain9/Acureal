/**
 * Trigger a browser download from a Blob or string content.
 * Properly revokes the object URL to avoid memory leaks.
 *
 * @param {BlobPart} content   - The content to download (string, Blob, ArrayBuffer, etc.)
 * @param {string}  filename   - Suggested filename including extension
 * @param {string}  [mimeType] - MIME type (defaults to 'application/octet-stream')
 */
export function downloadBlob(content, filename, mimeType = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Delay revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

/**
 * Trigger a download from an Axios response that has raw data (e.g. CSV, JSON).
 *
 * @param {import('axios').AxiosResponse} response - Axios response
 * @param {string} filename - Suggested filename
 */
export function downloadAxiosResponse(response, filename) {
  const contentType =
    response.headers?.['content-type'] || 'application/octet-stream';
  downloadBlob(response.data, filename, contentType);
}
