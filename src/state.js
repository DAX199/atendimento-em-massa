import fs from 'node:fs';
import path from 'node:path';

// shortcut: the whole state is one JSON file rewritten on every change; move to node:sqlite if it grows past a few MB.
export function loadState(file) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return { seen: {}, cursor: {}, jidByConv: {}, convByJid: {}, contactByJid: {}, replies: {}, ...saved };
}

export function saveState(file, state) {
  const cutoff = Date.now() - 2 * 86400e3;
  for (const [id, t] of Object.entries(state.seen)) if (t < cutoff) delete state.seen[id];
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); // holds customers' numbers
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
  fs.renameSync(`${file}.tmp`, file);
}
