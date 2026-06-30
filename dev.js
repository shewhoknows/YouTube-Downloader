// Zero-dependency dev runner: starts the Express backend and the Vite frontend
// together, prefixing each line of output so you can tell them apart.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'server', color: '\x1b[36m', args: ['--workspace', 'server', 'run', 'dev'] },
  { name: 'client', color: '\x1b[35m', args: ['--workspace', 'client', 'run', 'dev'] },
];

const children = [];

for (const { name, color, args } of procs) {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);

  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown();
  });
}

function shutdown() {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
