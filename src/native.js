import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function binaryPath(from = import.meta.url) {
    return fileURLToPath(new URL('./IosAgenda.app/Contents/MacOS/ios-agenda', from));
}

export async function callNative(binary, method, input = {}, signal) {
    await access(binary, constants.X_OK).catch(() => {
        throw Object.assign(new Error('还没有构建 IosAgenda.app。先运行 npm run build。'), { code: 'NOT_BUILT' });
    });
    return await new Promise((resolve) => {
        const child = spawn(binary, ['call', method], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish({ ok: false, error: { code: 'TIMEOUT', message: '读取日历或提醒事项超时。如果系统正在询问权限，允许后再试。' } });
        }, 20000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (error) => finish({ ok: false, error: { code: 'SPAWN', message: error.message } }));
        child.on('close', () => {
            const line = stdout.trim().split('\n').findLast((item) => item.trim());
            try {
                finish(line ? JSON.parse(line) : { ok: false, error: { code: 'BAD_RESPONSE', message: stderr.trim() || '原生程序没有返回 JSON' } });
            } catch {
                finish({ ok: false, error: { code: 'BAD_RESPONSE', message: stderr.trim() || stdout.trim() || '原生程序返回的不是 JSON' } });
            }
        });
        signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
        child.stdin.end(JSON.stringify(input ?? {}));
    });
}
