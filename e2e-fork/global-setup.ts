import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Starts the throwaway Stalwart unless E2E_KEEP_STALWART names one already up. */
export default function globalSetup(): void {
  if (process.env.E2E_KEEP_STALWART) return;
  execFileSync(path.join(__dirname, 'stalwart.sh'), ['up'], { stdio: 'inherit' });
}
