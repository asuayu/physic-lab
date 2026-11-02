// @ts-check
import { z } from "zod";
import data from "./experiments.json" with { type: "json" };

const localPath = z.string().regex(/^\/(?!\/)[^?#]+$/, "资源必须使用站内绝对路径");
const experimentSchema = z.object({
    title: z.string().trim().min(1),
    desc: z.string().trim().min(1),
    image: localPath.optional(),
    icon: z.string().min(1).optional(),
    link: localPath.regex(/\.html$/, "实验链接必须指向 HTML"),
    publishedAt: z.iso.datetime({ offset: true }),
    hidden: z.boolean().default(false),
}).strict().refine((item) => item.image || item.icon, "实验需要封面或图标");

export const catalogSchema = z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().trim().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    animations: z.array(experimentSchema),
}).strict()).superRefine((groups, ctx) => {
    const ids = new Set();
    const links = new Set();
    for (const [groupIndex, group] of groups.entries()) {
        if (ids.has(group.id)) ctx.addIssue({ code: "custom", path: [groupIndex, "id"], message: "重复分类 ID" });
        ids.add(group.id);
        for (const [index, item] of group.animations.entries()) {
            if (links.has(item.link)) ctx.addIssue({ code: "custom", path: [groupIndex, "animations", index, "link"], message: "重复实验链接" });
            links.add(item.link);
        }
    }
});

/** @typedef {z.infer<typeof experimentSchema>} Experiment */
/** @typedef {z.infer<typeof catalogSchema>[number]} Category */
export const categories = catalogSchema.parse(data);
export const allExperiments = categories.flatMap((category) =>
    category.animations.map((item) => ({
        ...item,
        categoryId: category.id,
        categoryName: category.name,
        categoryColor: category.color,
    })),
);
export const visibleExperiments = allExperiments
    .filter((item) => !item.hidden)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
