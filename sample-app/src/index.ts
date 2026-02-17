#!/usr/bin/env node
import { run } from "./cli.js";

const STORE_PATH = process.env.TASK_CLI_STORE ?? ".tasks.json";

const output = await run(process.argv.slice(2), STORE_PATH);
console.log(output);
