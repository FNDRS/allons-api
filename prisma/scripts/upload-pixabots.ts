import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

const PIXABOT_DIR = process.env.PIXABOT_DIR || '/Users/geovanydev/Downloads/pixabots-gif/gif/480';
const BUCKET = 'avatars';
const FOLDER = 'pixabots';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    await supabase.storage.createBucket(BUCKET, { public: true });
    console.log(`Bucket "${BUCKET}" created`);
  }

  const files = fs.readdirSync(PIXABOT_DIR)
    .filter((f) => f.endsWith('.gif'))
    .sort();

  let ok = 0;
  let fail = 0;
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
      if (error.message.includes('already exists')) {
        ok++;
      } else {
        console.error(`[FAIL] ${file}: ${error.message}`);
        fail++;
      }
    } else {
      ok++;
    }
    if ((i + 1) % 100 === 0) {
      console.log(`Progress: ${i + 1}/${files.length} (ok=${ok} fail=${fail})`);
    }
  }
  console.log(`Done: ${ok} uploaded, ${fail} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
