import { build } from 'esbuild';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'dist/IosAgenda.app');
const executable = resolve(app, 'Contents/MacOS/ios-agenda');

function run(command, args, cwd = root, env = {}) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(' ')} 退出 ${code}`))));
    });
}

const cache = resolve(root, '.build-cache');
await mkdir(resolve(cache, 'clang'), { recursive: true });
await run('swift', [
    'build', '-c', 'release', '--package-path', 'native',
    '--cache-path', resolve(cache, 'swiftpm'),
    '--scratch-path', resolve(root, 'native/.build'),
], root, { CLANG_MODULE_CACHE_PATH: resolve(cache, 'clang') });
const built = resolve(root, 'native/.build/release/ios-agenda');
await rm(app, { recursive: true, force: true });
await mkdir(dirname(executable), { recursive: true });
await cp(built, executable);
await cp(resolve(root, 'native/Info.plist'), resolve(app, 'Contents/Info.plist'));
await chmod(executable, 0o755);
await run('codesign', ['--force', '--sign', '-', '--identifier', 'work.1agents.ios-agenda', app]);

await build({
    absWorkingDir: root,
    entryPoints: ['src/host.js'],
    outfile: 'dist/host.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
});

const client = await build({
    absWorkingDir: root,
    entryPoints: ['src/client.jsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    define: { 'process.env.NODE_ENV': '"production"' },
});
const wrapped = `window.__ModuleLoader__.load({id:"@1agents/dsh-plugin-todo",dependencies:["react","react/jsx-runtime"],factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`;
await mkdir(resolve(root, 'dist'), { recursive: true });
const { writeFile } = await import('node:fs/promises');
await writeFile(resolve(root, 'dist/client.js'), wrapped);
