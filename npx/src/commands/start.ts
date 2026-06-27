import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const IMAGE = process.env.PYPES_BOT_IMAGE ?? 'ghcr.io/jaredzwick/pypes-bot:latest';
const CONTAINER = 'pypes-bot';

export async function start(): Promise<void> {
  if (!existsSync('pypes.env')) {
    console.error('pypes.env not found. Run `npx @pypes/bot init` first.');
    process.exit(2);
  }
  if (!existsSync('pypes-data')) {
    console.error('pypes-data/ not found. Run `npx @pypes/bot init` first.');
    process.exit(2);
  }

  console.log(`pulling ${IMAGE}…`);
  const pull = Bun.spawnSync(['docker', 'pull', IMAGE], { stdout: 'inherit', stderr: 'inherit' });
  if (pull.exitCode !== 0) {
    console.error('docker pull failed.');
    process.exit(pull.exitCode ?? 1);
  }

  // Stop any running instance first
  Bun.spawnSync(['docker', 'rm', '-f', CONTAINER], { stdout: 'ignore', stderr: 'ignore' });

  const dataDir = resolve('pypes-data');
  const envFile = resolve('pypes.env');

  const run = Bun.spawnSync(
    [
      'docker',
      'run',
      '--rm',
      '-d',
      '--name',
      CONTAINER,
      '--env-file',
      envFile,
      '-v',
      `${dataDir}:/data`,
      '-p',
      '8080:8080',
      IMAGE,
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if (run.exitCode !== 0) {
    console.error('docker run failed.');
    process.exit(run.exitCode ?? 1);
  }

  console.log(`\npypes-bot is running.`);
  console.log(`  Health:    http://localhost:8080/healthz`);
  console.log(`  Logs:      docker logs -f ${CONTAINER}`);
  console.log(`  Stop:      docker stop ${CONTAINER}`);
  console.log(`\nMake sure your public URL routes to http://localhost:8080.`);
}
