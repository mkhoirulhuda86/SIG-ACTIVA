import "server-only";
import type { WorkbookStorage } from "./types";
import { resolveSupabaseStorageSignedUrl } from "./signed-url";

const bucket =
  process.env.COST_STRUCTURE_STORAGE_BUCKET || "cost-structure-source";

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Supabase Storage server configuration is incomplete");
  return { url: `${url.replace(/\/$/, "")}/storage/v1`, key };
}

async function storageFetch(path: string, init: RequestInit = {}) {
  const { url, key } = config();
  return fetch(`${url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, apikey: key, ...init.headers },
  });
}

export const costStructureStorage: WorkbookStorage = {
  async upload(objectKey, bytes, contentType) {
    const response = await storageFetch(
      `/object/${bucket}/${encodeURI(objectKey)}`,
      {
        method: "POST",
        headers: { "content-type": contentType, "x-upsert": "false" },
        body: Buffer.from(bytes),
      },
    );
    if (!response.ok)
      throw new Error(`Storage upload failed (${response.status})`);
  },
  async createSignedUpload(objectKey) {
    const response = await storageFetch(
      `/object/upload/sign/${bucket}/${encodeURI(objectKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upsert: false }),
      },
    );
    if (!response.ok)
      throw new Error(`Storage signed upload failed (${response.status})`);
    const data = (await response.json()) as { url?: string; token?: string };
    const signedUrl = resolveSupabaseStorageSignedUrl(
      config().url,
      data.url || "",
    );
    const token =
      data.token || new URL(signedUrl).searchParams.get("token") || "";
    if (!token)
      throw new Error("Supabase Storage did not return a signed upload token");
    return { signedUrl, token };
  },
  async download(objectKey) {
    const response = await storageFetch(
      `/object/${bucket}/${encodeURI(objectKey)}`,
    );
    if (!response.ok)
      throw new Error(`Storage download failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  },
  async remove(objectKey) {
    const response = await storageFetch(`/object/${bucket}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [objectKey] }),
    });
    if (!response.ok)
      throw new Error(`Storage remove failed (${response.status})`);
  },
  async exists(objectKey) {
    const slash = objectKey.lastIndexOf("/"),
      name = objectKey.slice(slash + 1);
    const response = await storageFetch(`/object/list/${bucket}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prefix: objectKey.slice(0, slash),
        search: name,
        limit: 1,
      }),
    });
    if (!response.ok)
      throw new Error(`Storage list failed (${response.status})`);
    const data = (await response.json()) as { name: string }[];
    return data.some((item) => item.name === name);
  },
};
