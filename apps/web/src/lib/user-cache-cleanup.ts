/** Somente chaves da aplicação; nunca apaga o armazenamento de outras aplicações na mesma origem. */
export function clearUserLocalStorage(storage: Storage = localStorage) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) if (key?.startsWith("miupy.") || key?.startsWith("miupy-calendar.")) storage.removeItem(key);
}
