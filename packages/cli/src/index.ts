#!/usr/bin/env node
import { Command } from "commander";
import { CORE_NAME, CORE_VERSION } from "@pm/core";

const program = new Command();

program.name("pm").description(`${CORE_NAME} 台账 CLI（占位：7 个子命令尚未实现）`).version(CORE_VERSION);

for (const name of ["validate", "new", "move", "stats", "check", "inbox", "serve"]) {
  program
    .command(name)
    .description(`${name}（占位）`)
    .action(() => {
      console.error(`${name} 尚未实现`);
      process.exitCode = 2;
    });
}

program.parse(process.argv);
