/** Storage is optional: privacy modes and embedded browsers may deny all access. */
export const preferences = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* Keep playing without persistence. */
    }
  },
};
