#!/usr/bin/env node
/**
 * Builds the Lambda deployment package:
 *   backend/dist/lambda/index.mjs   (esbuild bundle of src/lambda.js incl. pg + @vault/shared)
 *   backend/dist/lambda/schema.sql  (read by the "migrate" task)
 *   backend/dist/lambda.zip         (upload with `aws lambda update-function-code --zip-file`)
 *
 * Lambda handler setting: index.handler   Runtime: nodejs22.x
 * The AWS SDK v3 is provided by the Lambda runtime, so @aws-sdk/* is left external.
 */

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist', 'lambda');
const ZIP_PATH = path.join(ROOT, 'dist', 'lambda.zip');

fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: [path.join(ROOT, 'src', 'lambda.js')],
  outfile: path.join(OUT_DIR, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  external: ['@aws-sdk/*', 'pg-native'],
  // pg is CommonJS and calls require() for Node built-ins.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});

fs.copyFileSync(path.join(ROOT, 'src', 'db', 'schema.sql'), path.join(OUT_DIR, 'schema.sql'));

// Minimal ZIP writer (deflate) so the build needs no external zip binary.
// Fixed timestamp (2020-01-01 00:00) keeps the archive reproducible.
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
function writeZip(zipPath, files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name);
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by UNIX, v3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...localParts, centralBuf, end]));
}

const files = fs.readdirSync(OUT_DIR).map((name) => ({ name, data: fs.readFileSync(path.join(OUT_DIR, name)) }));
writeZip(ZIP_PATH, files);
console.log(`Lambda package: ${path.relative(process.cwd(), ZIP_PATH)} (${(fs.statSync(ZIP_PATH).size / 1024).toFixed(1)} KiB)`);
