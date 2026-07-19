import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = process.argv[2];
if (!workbookPath) {
  throw new Error("Workbook path argument is required.");
}

const outputDir = path.resolve("C:/Users/BKanagaraju/Documents/FlowIQ/tmp/install_inspect/output");
await fs.mkdir(outputDir, { recursive: true });

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheetName = "Installs";

const sheetSummary = await workbook.inspect({
  kind: "sheet,region",
  sheetId: sheetName,
  range: "A1:AZ130",
  maxChars: 12000,
  tableMaxRows: 130,
  tableMaxCols: 52,
});
await fs.writeFile(path.join(outputDir, "installs-inspect.txt"), sheetSummary.ndjson, "utf8");

const formulas = await workbook.inspect({
  kind: "formula",
  sheetId: sheetName,
  range: "A1:AZ130",
  maxChars: 16000,
  options: { maxResults: 400 },
});
await fs.writeFile(path.join(outputDir, "installs-formulas.txt"), formulas.ndjson, "utf8");

const overview = await workbook.render({
  sheetName,
  range: "A1:AZ130",
  scale: 1.3,
  format: "png",
  autoCrop: "all",
});
await fs.writeFile(path.join(outputDir, "installs-overview.png"), new Uint8Array(await overview.arrayBuffer()));

const topSection = await workbook.render({
  sheetName,
  range: "A1:N110",
  scale: 2,
  format: "png",
  autoCrop: "all",
});
await fs.writeFile(path.join(outputDir, "installs-top.png"), new Uint8Array(await topSection.arrayBuffer()));

const lowerSection = await workbook.render({
  sheetName,
  range: "A90:N130",
  scale: 2,
  format: "png",
  autoCrop: "all",
});
await fs.writeFile(path.join(outputDir, "installs-lower.png"), new Uint8Array(await lowerSection.arrayBuffer()));

console.log(outputDir);
