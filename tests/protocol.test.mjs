import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const binary = fileURLToPath(new URL('../dist/IosAgenda.app/Contents/MacOS/ios-agenda', import.meta.url));

function rpc(child, message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
}

function nextMessage(child) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => reject(new Error('MCP 没有在时限内返回')), 5000);
        const onData = (chunk) => {
            buffer += chunk;
            const newline = buffer.indexOf('\n');
            if (newline < 0) return;
            clearTimeout(timer);
            child.stdout.off('data', onData);
            resolve(JSON.parse(buffer.slice(0, newline)));
        };
        child.stdout.on('data', onData);
    });
}

test('MCP 握手并列出工具，不读取日历', async () => {
    const child = spawn(binary, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    try {
        rpc(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
        const initialized = await nextMessage(child);
        assert.equal(initialized.id, 1);
        assert.equal(initialized.result.protocolVersion, '2025-03-26');
        rpc(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
        rpc(child, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
        const listed = await nextMessage(child);
        const names = listed.result.tools.map((item) => item.name);
        assert.deepEqual(names, [
            'agenda_authorize',
            'agenda_snapshot',
            'agenda_create_reminder',
            'agenda_complete_reminder',
            'agenda_delete_reminder',
            'agenda_create_event',
            'agenda_delete_event',
        ]);
    } finally {
        child.kill('SIGTERM');
    }
});
