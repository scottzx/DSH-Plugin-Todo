#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binary = fileURLToPath(new URL('../dist/IosAgenda.app/Contents/MacOS/ios-agenda', import.meta.url));
const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
child.on('error', (error) => {
    console.error(error.code === 'ENOENT' ? '还没有构建 IosAgenda.app。先运行 npm run build。' : error.message);
    process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
