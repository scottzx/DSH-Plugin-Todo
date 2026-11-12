import { contribution, METHODS, SERVICE } from './contract.js';
import { binaryPath, callNative } from './native.js';
import { registerMcp } from './register-mcp.js';

export const name = 'ios-agenda';
export const inject = ['typert'];
const binary = binaryPath();

function failure(code, message) {
    return { ok: false, error: { code, message } };
}

async function invoke(method, input, signal) {
    try {
        return await callNative(binary, method, input, signal);
    } catch (error) {
        return failure(error?.code ?? 'FAILED', error instanceof Error ? error.message : String(error));
    }
}

export function apply(ctx) {
    const service = {};
    for (const method of METHODS) {
        service[method] = (input, signal) => invoke(method, input, signal);
    }
    service.typertRemote = Object.freeze({ service, serviceKey: SERVICE, namespace: SERVICE });
    ctx.effect(() => ctx.reflect.provide(SERVICE, service));
    ctx.effect(() => ctx.typert.register({
        ...contribution,
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: contribution.descriptors,
    }));
    // 页面不依赖这次登记。失败只说明 Agent 暂时搜不到工具。
    registerMcp(binary).then((result) => {
        if (!result.ok) console.error(`[ios-agenda] 未能登记 dreammate MCP：${result.error}`);
    });
}
