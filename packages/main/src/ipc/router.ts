import { ipcMain } from "electron";
import type { IpcChannel, IpcReq, IpcRes } from "@app/core";

export function handle<C extends IpcChannel>(
  channel: C,
  fn: (req: IpcReq<C>) => Promise<IpcRes<C>> | IpcRes<C>,
) {
  ipcMain.handle(channel, (_e, payload) => fn(payload as IpcReq<C>));
}
