# dingtalk（占位）

钉钉渠道的 **目标归属目录**。

## 现状

- 可运行实现仍在 [`electron/channels/`](../../channels/)（Hub 客户端、ingress、delivery、binding 等）。
- 本目录 **仅作占位说明**，当前无业务代码。

## 迁入时机

**等微信渠道（`../weixin/`）稳定上线后**，再单独开机械 PR，将钉钉相关实现迁入本目录（或迁入 `../common/` 并由本目录承接钉钉专用部分）。

迁入要求：

- 行为零变化，与微信功能迭代拆开合入。
- 迁入完成后更新本 README，并删除或改写 `electron/channels/` 中的对应实现（可短暂保留 re-export）。

## 参考

- 伞说明：[`../README.md`](../README.md)
- 技术方案：[`docs/微信渠道-Host-Worker技术方案.md`](../../../docs/微信渠道-Host-Worker技术方案.md)
