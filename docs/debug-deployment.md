# dub2 GitHub 调试部署与 Cloudflare 受保护全栈预览说明

本文档对应任务 [CMP-74](/CMP/issues/CMP-74) 与验收任务 [CMP-75](/CMP/issues/CMP-75)，记录 dub2 最终版本调试部署的标准触发步骤、访问入口、架构隔离与回退方案。

---

## 1. 部署基本信息

- **目标代码基线**：`e938bf195e95dd8d0af94eb9e26994805dd962a9` (及由此前进的调试分支提交)
- **调试分支**：`cmp-73/debug-preview`
- **拉取请求 (PR)**：开向 `main` 分支（标注：调试部署，不合并）
- **受保护全栈预览入口**：[https://dub2-preview.mimopolo.dpdns.org](https://dub2-preview.mimopolo.dpdns.org)
- **全栈健康检查接口**：`GET https://dub2-preview.mimopolo.dpdns.org/api/health`

---

## 2. 董事会在 GitHub Actions 手动触发部署步骤

董事会或审核人员可按以下步骤随时在 GitHub Actions 重新触发或复现校验：

1. 访问 GitHub 仓库 Actions 页面：`https://github.com/fengqiaozhu/dub2/actions`
2. 在左侧工作流列表中点击 **Debug Preview Deployment** (`debug-deploy.yml`)
3. 点击右侧 **Run workflow** 下拉按钮
4. 在 **Use workflow from** 选择分支 **`cmp-73/debug-preview`**
5. 点击绿色的 **Run workflow** 按钮启动
6. 工作流执行过程中将自动打印并记录部署 SHA、校验 compose 服务拓扑与前后端构建物完整性，并在 Job Summary 中输出部署清单与工件

> **提示**：工作流配置了 `timeout-minutes: 15`，避免长时间孤儿任务占用运行资源。

---

## 3. 全栈架构与网络隔离

预览环境采用完整全栈架构，非纯静态页面：

```
Internet (Browser / API Client)
          │
          │ HTTPS (TLS 由 Cloudflare Edge 终止)
          ▼
   [Cloudflare CDN & Edge]
          │
          │ Cloudflare Tunnel (dub2-debug-preview)
          ▼
    [ebook-ui (Nginx:80)] ─── /api/*, /media/* ───► [ebook-api (Node.js:13000)]
          │                                                   │
          │                                        ┌──────────┴──────────┐
          │                                        ▼                     ▼
          └── 静态资源 (HTML/JS/CSS)       [PostgreSQL 16]       [MinIO / S3]
```

### 安全与隔离约束
1. **对外仅暴露 UI**：通过 Cloudflare Tunnel 仅暴露 UI 服务的 80 端口，外部通过 `https://dub2-preview.mimopolo.dpdns.org` 访问。
2. **敏感端口封锁**：PostgreSQL (5432)、MinIO API (9000)、MinIO 控制台 (9001) 均保持内部容器网络互通，不对公网开放。
3. **应用鉴权开启 (Fail-Closed)**：
   - 环境变量注入 `DUB_ACCESS_TOKEN`，系统启用严格的 Bearer Token 鉴权。
   - 未携带或携带错误令牌的 API 请求统一返回 401 Unauthorized。
   - 前端界面感知 401 状态并提示跳转至 `/settings?tab=access` 进行凭据配置。
   - `/api/health` 路由作为探针公开放行，返回底层 `api`、`postgres`、`s3` 连通性。
4. **零外部费用**：所有 AI 及 TTS 相关密钥 (`OPEN_AI_API_KEY`, `MOSI_API_KEY`, `FISH_API_KEY`) 保持为空，不调用付费外部模型。

---

## 4. 健康检查验证

执行以下命令验证全栈连通性：

```bash
curl -s https://dub2-preview.mimopolo.dpdns.org/api/health
```

预期返回 JSON 样例：
```json
{
  "data": {
    "ok": true,
    "checks": {
      "api": { "ok": true },
      "postgres": { "ok": true },
      "s3": { "ok": true, "bucket": "ebook" }
    }
  }
}
```

---

## 5. 回退与清理步骤

当调试阶段结束或需要回退清理时：

1. **停止本地容器栈**：
   ```bash
   docker compose down -v
   ```
2. **断开 Cloudflare Tunnel**：
   停止运行的 `cloudflared` 容器即可立即切断外部流量。
3. **清理 DNS 记录**：
   在 Cloudflare 控制台或通过 API 移除 `dub2-preview.mimopolo.dpdns.org` 的 CNAME 记录。
