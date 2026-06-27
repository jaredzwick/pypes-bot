#!/usr/bin/env bun
import { init } from './commands/init';
import { start } from './commands/start';

const HELP = `pypes-bot — Slack @pypes-bot mention → Claude → PR loop.

Usage:
  npx @pypes/bot init      Walk through interactive setup; writes ./pypes.env
  npx @pypes/bot start     docker run with ./pypes.env and ./pypes-data/

Other ops (use docker directly):
  docker logs -f pypes-bot
  docker stop pypes-bot
  docker exec -it pypes-bot sqlite3 /data/pypes.db
`;

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    process.exit(0);
  }
  switch (cmd) {
    case 'init':
      await init();
      break;
    case 'start':
      await start();
      break;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
