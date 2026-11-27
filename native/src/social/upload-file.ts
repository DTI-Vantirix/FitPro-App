/** Sends a picked file's bytes to the VantraRun server: the one place the app uploads media.
 * It is handed to uploadMedia (src/social/api.ts) by the composer and used nowhere else.
 * expo-file-system streams the file from disk as the request body, so a 50 MB video is
 * never held in memory, and reports how much has gone. */
import { File, UploadType } from 'expo-file-system';
import type { SendFile } from './api';

export const sendFile: SendFile = async ({ url, uri, mimeType, headers, onProgress, signal }) => {
  const result = await new File(uri).upload(url, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    mimeType,
    // The runner is watching the composer: the upload lives and dies with the screen.
    sessionType: 'foreground',
    ...(onProgress ? { onProgress: ({ bytesSent, totalBytes }: { bytesSent: number; totalBytes: number }) => onProgress(bytesSent, totalBytes) } : {}),
    ...(signal ? { signal } : {}),
  });
  return { status: result.status, body: result.body };
};

/** The size of a file on the phone, when the picker did not say. */
export function fileSize(uri: string): number | null {
  try {
    const size = new File(uri).size;
    return typeof size === 'number' && size >= 0 ? size : null;
  } catch {
    return null;
  }
}
