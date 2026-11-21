import path from "node:path";

/**
 * Where a local installation keeps its files. From a source checkout these are
 * the familiar project folders (.data, .dev-mailbox). The packaged Windows app
 * sets ITM_HOME (e.g. %LOCALAPPDATA%\ITopMed) so data never lives inside the
 * program folder that is replaced on update.
 */
export function dataRoot(): string {
  return process.env.ITM_HOME ?? path.join(process.cwd(), ".data");
}

/** Simulated SMS / Telegram output ("dev-outbox"). */
export function mailboxRoot(): string {
  return process.env.ITM_HOME ? path.join(process.env.ITM_HOME, "mailbox") : path.join(process.cwd(), ".dev-mailbox");
}
