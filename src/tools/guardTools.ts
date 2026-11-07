import { localMcpDisabledMessage, type LocalSwitch } from "../domain/localSwitch.js";

type ToolFn = (...args: unknown[]) => unknown;

/**
 * [server].tool を包み、以後に登録するすべてのツールの前に止めるスイッチを確かめる。
 * 止まっているときは元のハンドラを呼ばず、リモート版への案内だけを返す。
 * ツールの登録（register…）より前に呼ぶこと。
 */
export function guardTools(server: { tool: unknown }, localSwitch: Pick<LocalSwitch, "isDisabled">): void {
  const original = (server.tool as ToolFn).bind(server);
  server.tool = (...args: unknown[]) => {
    const last = args.length - 1;
    const handler = args[last] as (...a: unknown[]) => Promise<unknown>;
    args[last] = async (...a: unknown[]) => {
      if (await localSwitch.isDisabled()) {
        return { content: [{ type: "text", text: localMcpDisabledMessage() }], isError: true };
      }
      return handler(...a);
    };
    return original(...args);
  };
}
