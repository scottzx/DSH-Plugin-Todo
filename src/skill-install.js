import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'ios-agenda';

/** DSH 只从用户技能目录加载 SKILL.md，所以包内的技能要落到这里。 */
export function skillsRoot() {
    return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skills');
}

/**
 * 把包内 skills/ios-agenda/SKILL.md 同步到 ~/.dsh/skills/ios-agenda/SKILL.md。
 * 内容一致就不写，避免每次启动都动用户的文件。
 */
export async function installSkill(packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
    const source = join(packageRoot, 'skills', SKILL_NAME, 'SKILL.md');
    const target = join(skillsRoot(), SKILL_NAME, 'SKILL.md');
    let content;
    try {
        content = await readFile(source, 'utf8');
    } catch {
        return { ok: false, reason: `包内缺少技能文件：${source}`, target };
    }
    try {
        if ((await readFile(target, 'utf8')) === content) return { ok: true, changed: false, target };
    } catch {
        // 目标不存在，正常往下写。
    }
    try {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
        return { ok: true, changed: true, target };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error), target };
    }
}
