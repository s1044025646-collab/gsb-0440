import path from "node:path";
import { Store } from "./db";
import { AllocationService } from "./service";
import { createServer, listen } from "./server";

async function main(): Promise<void> {
  const dataDir = process.env.FAMILY_TREE_DATA_DIR ?? path.join(process.cwd(), "data");
  const dbPath = path.join(dataDir, "family-tree.db");
  const preferredPort = process.env.PORT ? Number(process.env.PORT) : undefined;

  const store = new Store(dbPath);
  const service = new AllocationService(store);
  const server = createServer(service);

  const port = await listen(server, preferredPort);
  console.log("家族树按支系代位分摊后端已启动");
  console.log(`监听地址: http://127.0.0.1:${port}`);
  console.log(`数据目录: ${dataDir}`);
  console.log("停止: Ctrl+C");

  const shutdown = (): void => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("启动失败:", e);
  process.exit(1);
});
