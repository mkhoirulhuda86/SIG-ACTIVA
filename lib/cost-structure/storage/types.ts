export interface WorkbookStorage {
  createSignedUpload(
    objectKey: string,
  ): Promise<{ signedUrl: string; token: string }>;
  upload(
    objectKey: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  download(objectKey: string): Promise<Uint8Array>;
  remove(objectKey: string): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
}
