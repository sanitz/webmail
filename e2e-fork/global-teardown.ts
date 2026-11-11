import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Removes the throwaway Stalwart: a run leaves no server and no data behind. */
export default function globalTeardown(): void {
  if (process.env.E2E_KEEP_STALWART) return;
  execFileSync(path.join(__dirname, 'stalwart.sh'), ['down'], { stdio: 'inherit' });
}
