## StoClaw Tool Notes

### uv (Python)

- `uv` is bundled with StoClaw and on PATH. Do NOT use bare `python` or `pip`.
- Run scripts: `uv run python <script>` | Install packages: `uv pip install <package>`

### Browser

- `browser` tool provides full automation (scraping, form filling, testing) via an isolated managed browser.
- Flow: `action="start"` → `action="snapshot"` (see page + get element refs like `e12`) → `action="act"` (click/type using refs).
- Open new tabs: `action="open"` with `targetUrl`.
- To just open a URL for the user to view, use `shell:openExternal` instead.
- **例外：对于 skill 生成的本地 HTML 文件（如 PPT 报告），禁止调用 browser / shell:openExternal / exec open 主动打开。sto-claw 会自动识别文件路径并提供内置预览，Agent 只需在回复中输出文件路径即可。**
