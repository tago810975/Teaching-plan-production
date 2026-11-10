# physics-default 模板

由 `scripts/build-template.mjs` 从参考样例《动态圆专题》教案生成，导出 Word 时使用。

- 样式与自动编号：沿用样例的 `物理排版 *` 样式体系，【答案】【知识点】、题号、小问号均为自动编号。
- 页眉：机构 Logo、电话、`{{headerLeft}}`、`{{headerRight}}`（导出时替换为工程中的页眉文字）。
- 正文：`{{body}}` 处插入导出内容。

修改样例或生成逻辑后，运行 `node scripts/build-template.mjs` 重新生成。

被“物理教学案 V1.0”“物理知识点手册 V1.0”两个预设共用。样式名、自动编号、页眉占位符等硬性要求，
以及制作新模板的流程，见 [`docs/模板制作指南.md`](../../../docs/模板制作指南.md)。
