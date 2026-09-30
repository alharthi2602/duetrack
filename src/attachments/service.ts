import { cloud } from "../auth/client";
import { fileGet, filePut } from "../sync/store";
import { attachmentSchema } from "../payments/model";
export const LIMIT = 10485760;
export function metadata(file: File) {
  return attachmentSchema.parse({
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type,
    size: file.size,
  });
}
export async function upload(
  owner: string,
  a: any,
  onProgress: (n: number) => void,
) {
  if (!cloud) throw Error("Cloud is not configured");
  const blob = await fileGet(owner, a.id);
  if (!blob) throw Error("The queued receipt is missing. Select it again.");
  const { data, error } = await cloud.storage
    .from("receipts")
    .createSignedUploadUrl(`${owner}/${a.id}`);
  if (error) throw error;
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", data.signedUrl);
    x.timeout = 60000;
    x.ontimeout = () =>
      reject(Error("Receipt upload timed out. Retry when connected."));
    x.setRequestHeader("Content-Type", a.mime);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    x.onload = () =>
      x.status >= 200 && x.status < 300
        ? resolve()
        : reject(
            Error("Receipt upload failed. Retry to keep the existing receipt."),
          );
    x.onerror = () => reject(Error("Receipt upload interrupted"));
    x.send(blob);
  });
}
export async function receipt(owner: string, a: any) {
  let b = await fileGet(owner, a.id);
  if (!b) {
    if (!cloud) throw Error("Connect to view this receipt");
    const { data, error } = await cloud.storage
      .from("receipts")
      .download(`${owner}/${a.id}`);
    if (error) throw Error("Receipt unavailable. Reconnect and retry.");
    b = data;
    const session = await cloud.auth.getSession();
    if (session.data.session?.user.id === owner) await filePut(owner, a.id, b);
  }
  return b;
}
