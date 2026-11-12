/** Host 与页面共用的调用契约。Agent 工具不走这里，走 dreammate-node MCP。 */
export const SERVICE = 'iosAgenda';
export const PACKAGE = '@1agents/dsh-plugin-todo';
export const PANEL_ID = 'ios-agenda';
export const METHODS = ['authorize', 'snapshot', 'createReminder', 'completeReminder', 'deleteReminder', 'createEvent', 'deleteEvent'];

function objectOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
}

function resultOf(value) {
    if (value && typeof value === 'object' && (value.ok === true || value.ok === false)) return value;
    throw new Error('原生程序返回了无法识别的结果');
}

const codec = (name, parse) => ({
    mode: 'strict',
    typeSymbol: `${PACKAGE}#${name}`,
    create: () => ({ parse }),
});

export const contribution = {
    package: PACKAGE,
    descriptors: METHODS.map((method) => ({
        id: `${PACKAGE}#${method}`,
        service: SERVICE,
        namespace: SERVICE,
        method,
        invocation: { kind: 'direct' },
        cancellation: { parameter: 'signal' },
        parameters: [
            { name: 'input', wire: 'input', source: 'json', codec: codec('Input', objectOf) },
        ],
        result: codec('Result', resultOf),
    })),
};
