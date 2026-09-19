// Turning an axios blob response into a file the browser saves.
//
// The export endpoints return a real .xlsx stream rather than JSON, so these
// requests use responseType: 'blob' -- which also means an *error* response
// arrives as a Blob of JSON rather than a parsed object, hence
// blobErrorMessage below.

// Filenames are set by the server (Content-Disposition) so the date in the
// name always matches the data, not the browser's clock.
export function saveBlobResponse(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;

  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function blobErrorMessage(err, fallback) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.error) return parsed.error;
    } catch {
      // Not JSON (a proxy's HTML error page, say) -- fall through.
    }
  }
  return data?.error || fallback;
}
