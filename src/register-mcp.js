import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SOURCE = 'ios-agenda';

function run(args, input) {
    return new Promise((resolve) => {
        const child = spawn('dreammate-node', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (error) => resolve({ code: 127, stdout, stderr: error.message }));
        child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
        if (input) child.stdin.end(input);
        else child.stdin.end();
    });
}

async function currentCommand() {
    try {
        const raw = await readFile(join(homedir(), '.1agents', 'mcp-sources.json'), 'utf8');
        return JSON.parse(raw)?.mcpServers?.[SOURCE]?.command;
    } catch {
        return undefined;
    }
}

/** 把同一个二进制登记成本机 dreammate MCP。已是同一路径时不重连。 */
export async function registerMcp(binary) {
    const current = await currentCommand();
    if (current === binary) return { ok: true, changed: false };
    if (current) {
        const removed = await run(['mcp', 'remove', `mcp-${SOURCE}`]);
        if (removed.code !== 0 && !/not found|不存在|unknown/i.test(`${removed.stdout}\n${removed.stderr}`)) {
            return { ok: false, error: removed.stderr || removed.stdout || '无法更新已有 MCP 来源' };
        }
    }
    const config = JSON.stringify({
        mcpServers: {
            [SOURCE]: { command: binary, args: ['mcp'], sharing: 'local' },
        },
    });
    const added = await run(['mcp', 'add', '--config', config]);
    if (added.code !== 0) return { ok: false, error: added.stderr || added.stdout || 'dreammate-node mcp add 失败' };
    return { ok: true, changed: true };
}
