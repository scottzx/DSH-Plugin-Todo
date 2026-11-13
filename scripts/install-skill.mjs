#!/usr/bin/env node
// 安装时把技能放进 ~/.dsh/skills，DSH 才会加载到它。
// pnpm 默认会忽略依赖的 install 脚本；那种情况下由插件启动时补齐，这里失败也不阻断安装。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'ios-agenda';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skills');
const source = join(packageRoot, 'skills', SKILL_NAME, 'SKILL.md');
const target = join(skillsRoot, SKILL_NAME, 'SKILL.md');

try {
    const content = await readFile(source, 'utf8');
    let current = '';
    try {
        current = await readFile(target, 'utf8');
    } catch {
        // 还没有，直接写。
    }
    if (current !== content) {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
        console.log(`[ios-agenda] 技能已安装到 ${target}`);
    }
} catch (error) {
    console.warn(`[ios-agenda] 技能没能自动安装（${error.message}）。DSH 启动插件时会再试一次。`);
}
