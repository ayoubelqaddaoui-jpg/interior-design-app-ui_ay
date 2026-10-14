const fs = require('node:fs/promises');
const path = require('node:path');

/** Single-instance persistent-volume store. Atomic commits, serialized writes, private permissions.
 * Replace this adapter with a shared database before running multiple backend replicas.
 */
function createStore(file) {
  let data;
  let queue = Promise.resolve();
  async function load() {
    if (!data) {
      try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        data = { requests: [], subscriptions: [], sessions: [], outbox: [] };
      }
    }
    return data;
  }
  function mutate(change) {
    const task = queue.then(async () => {
      const next = structuredClone(await load());
      const result = change(next);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.tmp`;
      const handle = await fs.open(temporary, 'w', 0o600);
      try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, file);
      data = next;
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }
  return { mutate, read: async () => { await queue; return structuredClone(await load()); } };
}
module.exports = { createStore };
