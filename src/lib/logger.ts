import chalk = require('chalk');
import * as fs from 'fs';
import {Writable} from 'stream';

let stream: Writable;
const path = 'repo-debug.log';

export interface LogEntry {
  message: string;
  time: Date;
  level: LogLevel;
}

export enum LogLevel {
  'INFO',
  'WARN',
  'ERROR',
}

export async function log(message: string) {
  console.log(message);
  push(LogLevel.INFO, message);
}

function push(level: LogLevel, message: string) {
  if (!stream) {
    stream = fs.createWriteStream(path);
  }
  stream.write(`${new Date()}\t${level}\t${message}`, err => {
    if (err) {
      console.error('Error writing to log.');
      console.error(err);
    }
  });
}

export function info(message: string) {
  console.error(chalk.cyan(message));
  push(LogLevel.INFO, message);
}

export function warn(message: string) {
  console.error(chalk.yellow(message));
  push(LogLevel.WARN, message);
}

export function error(message: string) {
  console.error(chalk.red(message));
  push(LogLevel.ERROR, message);
}
