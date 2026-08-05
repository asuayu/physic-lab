import { readFile, readdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const indexPath = join(root, "src", "pages", "index.astro");

const indexSource = await readFile(indexPath, "utf8");
const references = [...indexSource.matchAll(/(?:image|link):\s*["']([^"']+)["']/g)].map(
    ([, value]) => value,
);

const errors = [];

for (const reference of references) {
    const relativePath = reference.replace(/^\//, "");
    try {
        await access(join(publicDir, relativePath), constants.R_OK);
    } catch {
        errors.push(`主页引用不存在: ${reference}`);
    }
}

const htmlFiles = (await readdir(publicDir)).filter((name) => name.endsWith(".html"));
for (const name of htmlFiles) {
    const source = await readFile(join(publicDir, name), "utf8");
    const required = [
        ["<title", "缺少标题"],
        ['name="viewport"', "缺少 viewport"],
        ["<canvas", "缺少 Canvas"],
        ["返回展厅", "缺少返回展厅入口"],
        ["/lab-common.css", "未加载公共样式"],
        ["/lab-runtime.js", "未加载公共运行时"],
    ];

    for (const [needle, message] of required) {
        if (!source.includes(needle)) errors.push(`${name}: ${message}`);
    }

    const ids = [...source.matchAll(/\sid=["']([^"']+)["']/g)].map(([, id]) => id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
        errors.push(`${name}: 存在重复 id (${[...new Set(duplicateIds)].join(", ")})`);
    }

    for (const [, script] of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
        try {
            Function(script);
        } catch (error) {
            errors.push(`${name}: 内联脚本语法错误 (${error.message})`);
        }
    }
}

for (const scriptName of ["lab-runtime.js"]) {
    const script = await readFile(join(publicDir, scriptName), "utf8");
    try {
        Function(script);
    } catch (error) {
        errors.push(`${scriptName}: 脚本语法错误 (${error.message})`);
    }
}

if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
} else {
    console.log(`内容检查通过：${htmlFiles.length} 个实验页面，${references.length} 个主页资源引用。`);
}
