import { structuredPatch } from "diff";
import * as chalk from "chalk";

export function addFile(filename: string, content: Buffer): string {
  const ret = [];
  const contentStr = content.toString("utf8");
  ret.push(chalk.greenBright(`Added: ` + filename));
  ret.push(
    "==================================================================="
  );
  const parts = contentStr.split("\n");
  for (const line of parts) {
    ret.push(chalk.greenBright(`+${line}`));
  }

  return ret.join("\n") + "\n";
}

export function deleteFile(filename: string): string {
  const ret = [];
  ret.push(chalk.redBright(`Deleted: ` + filename));
  ret.push(
    "==================================================================="
  );
  return ret.join("\n") + "\n";
}

export function moveFile(src: string, dest: string): string {
  const ret = [];
  ret.push(chalk.cyanBright(`Moved: ` + src));
  ret.push(chalk.cyanBright(`To   : ` + dest));
  ret.push(
    "==================================================================="
  );

  return ret.join("\n") + "\n";
}

export function diffFiles(
  filename: string,
  oldStr: Buffer,
  newStr: Buffer
): string {
  const diff = structuredPatch(
    filename,
    filename,
    oldStr.toString("utf8"),
    newStr.toString("utf8")
  );
  const ret = [];
  ret.push(chalk.blueBright(`Modified: ` + filename));
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
