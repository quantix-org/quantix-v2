export async function localGet<T>(key: string, fallback: T): Promise<T> {
  const raw = await browser.storage.local.get(key);
  return (raw[key] as T) ?? fallback;
}

export async function localSet<T>(key: string, value: T): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function sessionGet<T>(key: string, fallback: T): Promise<T> {
  const raw = await browser.storage.session.get(key);
  return (raw[key] as T) ?? fallback;
}

export async function sessionSet<T>(key: string, value: T): Promise<void> {
  await browser.storage.session.set({ [key]: value });
}

export async function sessionRemove(key: string): Promise<void> {
  await browser.storage.session.remove(key);
}