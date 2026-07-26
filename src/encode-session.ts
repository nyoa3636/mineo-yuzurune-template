import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(process.cwd(), ".mineo-storage-state.json");
const data = await readFile(path);
process.stdout.write(data.toString("base64"));
