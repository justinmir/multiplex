import { ipc } from "@app/preload";
import type { IpcChannel, IpcReq, IpcRes } from "@app/core";

export function call<C extends IpcChannel>(c: C, req: IpcReq<C>): Promise<IpcRes<C>> {
  return ipc.invoke(c, req) as Promise<IpcRes<C>>;
}

export function on(topic: string, cb: (p: unknown) => void): () => void {
  return ipc.subscribe(topic, cb);
}
