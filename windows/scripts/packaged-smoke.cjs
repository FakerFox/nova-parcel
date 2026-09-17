'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const executable = path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'Nova Parcel.exe');
const result = spawnSync(executable, ['--smoke-test'], { stdio:'inherit', timeout:60000 });
if(result.error)console.error(result.error.message);
process.exit(result.status === 0 ? 0 : 1);
