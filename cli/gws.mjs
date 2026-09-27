// Thin wrapper around the authenticated `gws` CLI.
import { spawnSync } from 'node:child_process';

export function gws(args, { params, json, upload, uploadType, bin = process.env.GWS_BIN || 'gws' } = {}) {
  const argv = [...args];
  if (params) argv.push('--params', JSON.stringify(params));
  if (json) argv.push('--json', JSON.stringify(json));
  if (upload) argv.push('--upload', upload);
  if (uploadType) argv.push('--upload-content-type', uploadType);
  const res = spawnSync(bin, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw res.error;
  let out;
  try {
    out = res.stdout.trim() ? JSON.parse(res.stdout) : {};
  } catch {
    throw new Error(`gws ${args.join(' ')}: unexpected output\n${res.stdout}\n${res.stderr}`);
  }
  if (res.status !== 0 || out.error) {
    const msg = out.error ? out.error.message : res.stderr;
    throw new Error(`gws ${args.join(' ')} failed: ${msg}`);
  }
  return out;
}

/** Accepts a bare ID or any docs.google.com / drive.google.com URL. */
export function docIdFrom(input) {
  const m = /\/d\/([\w-]{10,})/.exec(input) || /[?&]id=([\w-]{10,})/.exec(input);
  return m ? m[1] : input;
}
