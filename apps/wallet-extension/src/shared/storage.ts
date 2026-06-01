export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const raw = await chrome.storage.local.get(key);
  return (raw[key] as T) ?? fallback;
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
