import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { evaluatePerformanceBudget } from "./performance-budget.mjs";

const assetDirectory = resolve(process.cwd(), "dist/assets");

function formatKB(bytes) {
  return (bytes / 1_000).toFixed(2) + " kB";
}

async function gzipSize(filePath) {
  const contents = await readFile(filePath);
  return {
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents).byteLength,
  };
}

async function main() {
  let files;
  try {
    files = await readdir(assetDirectory);
  } catch {
    throw new Error("Build assets not found. Run npm run build before checking the performance budget.");
  }

  const entryFiles = files.filter((file) => /^app-.*\.js$/.test(file));
  const cssFiles = files.filter((file) => file.endsWith(".css"));
  if (entryFiles.length !== 1) {
    throw new Error("Expected exactly one Vite app entry chunk; found " + entryFiles.length + ".");
  }
  if (cssFiles.length === 0) {
    throw new Error("No generated CSS asset found in dist/assets.");
  }

  const entry = await gzipSize(resolve(assetDirectory, entryFiles[0]));
  const styles = await Promise.all(cssFiles.map((file) => gzipSize(resolve(assetDirectory, file))));
  const entryJsGzipBytes = entry.gzipBytes;
  const cssGzipBytes = styles.reduce((total, style) => total + style.gzipBytes, 0);

  console.log("SYKABELAJAR initial asset measurement");
  console.log("Entry JS: " + formatKB(entry.rawBytes) + " raw; " + formatKB(entryJsGzipBytes) + " gzip");
  console.log("CSS: " + formatKB(styles.reduce((total, style) => total + style.rawBytes, 0)) +
    " raw; " + formatKB(cssGzipBytes) + " gzip");

  const lazyChunks = files.filter((file) => file.endsWith(".js") && !/^app-.*\.js$/.test(file));
  if (lazyChunks.length > 0) {
    const lazySizes = await Promise.all(lazyChunks.map(async (file) => ({
      file,
      ...(await gzipSize(resolve(assetDirectory, file))),
    })));
    const largest = lazySizes.sort((left, right) => right.gzipBytes - left.gzipBytes)[0];
    console.log("Largest lazy JS chunk: " + largest.file + " (" + formatKB(largest.gzipBytes) + " gzip)");
  }

  const result = evaluatePerformanceBudget({ entryJsGzipBytes, cssGzipBytes });
  for (const check of result.checks) {
    const label = check.passed ? "PASS" : "FAIL";
    console.log(
      label + " " + check.name + ": " +
      formatKB(check.actualBytes) + " / " + formatKB(check.budgetBytes),
    );
  }

  if (!result.passed) {
    throw new Error("Performance asset budget exceeded. Inspect the bundle report before merging.");
  }
}

main().catch((error) => {
  console.error("[performance-budget]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
