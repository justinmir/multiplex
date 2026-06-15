export const EVENT_CHANNEL = "multiplex:event" as const;

/** Request/response channels. Add one entry per feature. */
export interface IpcContract {
  "app:ping": { req: { value: string }; res: { value: string; ts: number } };
}
export type IpcChannel = keyof IpcContract;
export type IpcReq<C extends IpcChannel> = IpcContract[C]["req"];
export type IpcRes<C extends IpcChannel> = IpcContract[C]["res"];

/** Server→client push events. Topic is a runtime string; payloads typed by prefix. */
export interface AppEvent<T = unknown> { topic: string; payload: T; ts: number; }
