import { structuredPatch } from "diff";
import * as chalk from "chalk";

export function diffFiles(
  filename: string,
  oldStr: string,
  newStr: string
): string {
  const diff = structuredPatch(filename, filename, oldStr, newStr);
  const ret = [];
  ret.push("Index: " + filename);
  ret.push(
    "==================================================================="
  );
  ret.push(
    "--- " +
      diff.oldFileName +
      (typeof diff.oldHeader === "undefined" ? "" : "\t" + diff.oldHeader)
  );
  ret.push(
    "+++ " +
      diff.newFileName +
      (typeof diff.newHeader === "undefined" ? "" : "\t" + diff.newHeader)
  );

  for (let i = 0; i < diff.hunks.length; i++) {
    const hunk = diff.hunks[i];
    ret.push(
      "@@ -" +
        hunk.oldStart +
        "," +
        chalk.red(hunk.oldLines) +
        " +" +
        hunk.newStart +
        "," +
        chalk.green(hunk.newLines) +
        " @@"
    );
    // eslint-disable-next-line prefer-spread
    ret.push.apply(
      ret,
      hunk.lines.map((l) => {
        if (l.startsWith("-")) {
          return chalk.redBright(l).toString();
        } else if (l.startsWith("+")) {
          return chalk.greenBright(l).toString();
        } else {
          return l;
        }
      })
    );
  }

  return ret.join("\n") + "\n";
}
