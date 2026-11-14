import { spawn } from "node:child_process";

// One dependency installation, then both workspace watchers. Never race npm ci.
const commands = [
  ["run", "dev", "-w", "@2space/server"],
  ["run", "dev", "-w", "@2space/web", "--", "--host", "0.0.0.0"],
];
const children = commands.map((args) =>
  spawn("npm", args, { stdio: "inherit", env: process.env }),
);
let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(exitCode);
  }, 4000);
  timer.unref();
  Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    ),
  ).then(() => process.exit(exitCode));
}
for (const child of children) {
  child.once("error", () => stop(1));
  child.once("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
