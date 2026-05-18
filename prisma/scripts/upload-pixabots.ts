/**
 * One-off: upload local .gif files to Supabase Storage (avatars/pixabots/).
 *
 * Usage:
 *   PIXABOT_DIR=/path/to/gifs SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec ts-node prisma/scripts/upload-pixabots.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

const BUCKET = 'avatars';
const FOLDER = 'pixabots';

function isConflictError(error: { statusCode?: string; message?: string }) {
  return error.statusCode === '409' || error.statusCode === '23505';
}

async function main() {
  const PIXABOT_DIR = process.env.PIXABOT_DIR?.trim();
  if (!PIXABOT_DIR) {
    throw new Error(
      'Set PIXABOT_DIR to the directory that contains the .gif files (absolute path recommended).',
    );
  }
  if (!fs.existsSync(PIXABOT_DIR)) {
    throw new Error(`PIXABOT_DIR does not exist: ${PIXABOT_DIR}`);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: buckets, error: listErr } =
    await supabase.storage.listBuckets();
  if (listErr) {
    throw new Error(`listBuckets: ${listErr.message}`);
  }

  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: true,
    });
    if (createErr) {
      throw new Error(`createBucket: ${createErr.message}`);
    }
    console.log(`Bucket "${BUCKET}" created`);
  }

  const files = fs
    .readdirSync(PIXABOT_DIR)
    .filter((f) => f.endsWith('.gif'))
    .sort();

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(PIXABOT_DIR, file);
    const content = fs.readFileSync(filePath);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${FOLDER}/${file}`, content, {
        contentType: 'image/gif',
        upsert: false,
      });
    if (error) {
      if (isConflictError(error)) {
        skipped++;
      } else {
        console.error(`[FAIL] ${file}: ${error.message}`);
        failed++;
      }
    } else {
      uploaded++;
    }
    if ((i + 1) % 100 === 0) {
      console.log(
        `Progress: ${i + 1}/${files.length} (uploaded=${uploaded} skipped=${skipped} fail=${failed})`,
      );
    }
  }
  console.log(
    `Done: ${uploaded} uploaded, ${skipped} already present, ${failed} failed`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
