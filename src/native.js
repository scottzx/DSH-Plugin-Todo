import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function binaryPath(from = import.meta.url) {
    return fileURLToPath(new URL('./IosAgenda.app/Contents/MacOS/ios-agenda', from));
}

// TCC 按「责任进程」判定授权。宿主直接 spawn 内部二进制时，责任进程是整个 DSH，
// 日历权限会被静默判成 notDetermined，弹框也不出现。交给 LaunchServices 启动，
// app 才是自己的责任进程，授权和权限查询才正常。
function appBundle(binary) {
    // dist/IosAgenda.app/Contents/MacOS/ios-agenda → dist/IosAgenda.app
    return resolve(binary, '../../..');
}

function timeoutFor(method) {
    return method === 'authorize' || method === 'snapshot' ? 120000 : 20000;
}

function parseResult(output, stderr) {
    const line = String(output).trim().split('\n').findLast((item) => item.trim());
    if (!line) {
        return { ok: false, error: { code: 'BAD_RESPONSE', message: stderr.trim() || '原生程序没有返回 JSON' } };
    }
    try {
        return JSON.parse(line);
    } catch {
        return { ok: false, error: { code: 'BAD_RESPONSE', message: stderr.trim() || line } };
    }
}

export async function callNative(binary, method, input = {}, signal) {
    await access(binary, constants.X_OK).catch(() => {
        throw Object.assign(new Error('还没有构建 IosAgenda.app。先运行 npm run build。'), { code: 'NOT_BUILT' });
    });
    const bundle = appBundle(binary);
    await access(bundle, constants.F_OK).catch(() => {
        throw Object.assign(new Error('找不到 IosAgenda.app 包，无法通过系统启动器授权。先运行 npm run build。'), { code: 'NOT_BUILT' });
    });

    const workdir = await mkdtemp(join(tmpdir(), 'ios-agenda-'));
    const inputPath = join(workdir, 'input.json');
    const outputPath = join(workdir, 'output.json');
    const errorPath = join(workdir, 'stderr.txt');
    await writeFile(inputPath, JSON.stringify(input ?? {}), 'utf8');

    try {
        return await new Promise((resolveResult) => {
            // -n 强制新实例，保证参数真的传给了这次调用；-W 等它退出。
            const child = spawn('open', [
                '-W', '-n', '-a', bundle,
                '--stdout', outputPath,
                '--stderr', errorPath,
                '--args', 'call-file', method, inputPath,
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            let settled = false;
            let timer = null;
            const finish = async (result) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                resolveResult(result);
            };
            timer = setTimeout(() => {
                child.kill('SIGTERM');
                // open 被杀不会带走 app，按可执行文件路径收尾。
                const cleanup = spawn('pkill', ['-f', binary], { stdio: 'ignore' });
                cleanup.on('error', () => {});
                cleanup.on('close', () => {
                    finish({ ok: false, error: { code: 'TIMEOUT', message: '调用本机日历超时。如果系统正在询问权限，允许后再试。' } });
                });
            }, timeoutFor(method));
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk) => { stderr += chunk; });
            child.on('error', (error) => finish({ ok: false, error: { code: 'SPAWN', message: error.message } }));
            child.on('close', async (code) => {
                let output = '';
                try {
                    output = await readFile(outputPath, 'utf8');
                } catch {
                    const openFailed = code !== 0 || stderr.trim();
                    return finish({
                        ok: false,
                        error: {
                            code: 'SPAWN',
                            message: openFailed
                                ? `系统启动器没能拉起 IosAgenda.app：${stderr.trim() || `退出码 ${code}`}`
                                : '原生程序没有写出结果',
                        },
                    });
                }
                let logged = stderr;
                try {
                    logged = await readFile(errorPath, 'utf8');
                } catch {
                    // stderr 文件可能不存在，保留 open 自己的输出。
                }
                finish(parseResult(output, logged));
            });
            signal?.addEventListener('abort', () => {
                child.kill('SIGTERM');
                spawn('pkill', ['-f', binary], { stdio: 'ignore' }).on('error', () => {});
            }, { once: true });
        });
    } finally {
        await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
}
