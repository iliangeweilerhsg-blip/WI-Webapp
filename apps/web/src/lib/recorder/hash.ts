// SHA-256 eines Chunks als Hex (Header `X-Sha256`, VERTRAEGE §10.2).

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new Error('Web Crypto (SHA-256) ist nicht verfügbar. Die Seite braucht https oder localhost.');
  const digest = new Uint8Array(await subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Inhalt eines Blobs als `ArrayBuffer` (auch dort, wo `Blob.arrayBuffer` fehlt) */
export function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Blob nicht lesbar'));
    reader.readAsArrayBuffer(blob);
  });
}
