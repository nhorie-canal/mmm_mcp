import { localDayKey, mcpUsagePath, planMcpUsageWrite } from "../domain/mcpUsage.js";
import type { FirestoreRestClient } from "./restClient.js";

type UsageClient = Pick<FirestoreRestClient, "getDocument" | "commitWrites">;

/**
 * MCP から書いた日の印(`users/{uid}/private/usage`)をつける。その日の初回だけ、
 * マップへの書き込みとは別の commit で書く(1回の commit で同じドキュメントへ2件書かない)。
 *
 * **失敗しても投げない。** 印は計測のためのもので、マップへの書き込みの結果は変えない。
 * 同じ日の2回目以降は、読み取りもしないようプロセスの中で覚えておく。
 */
export class McpUsageRecorder {
  private recordedDay: string | null = null;

  async record(client: UsageClient, uid: string, now: Date = new Date()): Promise<void> {
    const today = localDayKey(now);
    if (this.recordedDay === today) return;
    try {
      const doc = await client.getDocument(mcpUsagePath(uid));
      const write = planMcpUsageWrite(
        uid,
        doc ? { data: doc.data, updateTime: doc.updateTime } : null,
        today
      );
      if (write) await client.commitWrites([write]);
      this.recordedDay = today;
    } catch {
      // 失敗は握りつぶす。覚えないので、次の書き込みでもう一度試す
    }
  }
}
