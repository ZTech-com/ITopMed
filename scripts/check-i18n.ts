import { checkCatalogs } from "./lib/i18n-check";
const problems = checkCatalogs();
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("i18n: all 4 catalogs complete.");
