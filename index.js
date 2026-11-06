/**
 * Host half: inject the current `config.json` into each served page so the
 * Client viewer reads its colors, sizes, and boxes from one editable file.
 */
import { readFileSync } from 'node:fs';

const CONFIG_URL = new URL('./config.json', import.meta.url);

/** Read the style file on every page boot so edits apply without a Host restart. */
function readStyleConfig(ctx) {
  try {
    return JSON.parse(readFileSync(CONFIG_URL, 'utf8'));
  } catch (error) {
    ctx.logger?.warn?.(`dsh-image-scope: cannot read config.json: ${error.message}`);
    return {};
  }
}

export function apply(ctx) {
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: '__DSH_IMAGE_SCOPE_CONFIG__',
      value: readStyleConfig(ctx),
    });
  });
}
