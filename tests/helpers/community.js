import { DatabaseSync } from "node:sqlite";
import { CommunityHub } from "../../cloudflare/community.js";
import { PlayerProfile } from "../../cloudflare/profile.js";

export function platform() {
  const tasks = [],
    databases = [];
  const context = () => {
    const data = new Map(),
      db = new DatabaseSync(":memory:");
    databases.push(db);
    let alarm = null,
      lock = Promise.resolve();
    return {
      data,
      storage: {
        get: async (k) => structuredClone(data.get(k)),
        put: async (k, v) => data.set(k, structuredClone(v)),
        delete: async (k) => data.delete(k),
        list: async ({ prefix = "" } = {}) =>
          new Map([...data].filter(([k]) => k.startsWith(prefix))),
        getAlarm: async () => alarm,
        setAlarm: async (v) => {
          alarm = v;
        },
        sql: {
          exec: (sql, ...args) => {
            const rows = db.prepare(sql).all(...args);
            return { toArray: () => rows };
          },
        },
      },
      getWebSockets: () => [],
      waitUntil: (p) => tasks.push(p),
      blockConcurrencyWhile: (fn) => {
        const p = lock.then(fn);
        lock = p.catch(() => {});
        return p;
      },
    };
  };
  const env = {};
  const hubContext = context(),
    hub = new CommunityHub(hubContext);
  env.COMMUNITY = { idFromName: (n) => n, get: () => hub };
  const profiles = new Map();
  env.PROFILES = {
    idFromName: (n) => n,
    get: (id) => {
      if (!profiles.has(id))
        profiles.set(id, new PlayerProfile(context(), env));
      return profiles.get(id);
    },
  };
  return {
    env,
    hub,
    hubContext,
    profiles,
    context,
    tasks,
    async drain() {
      while (tasks.length) await Promise.all(tasks.splice(0));
    },
    async close() {
      await this.drain();
      databases.forEach((db) => db.close());
    },
  };
}
