import readline from 'readline';
import { promises as fsp } from 'fs';

import { Client, ClientChannel } from 'ssh2';

import { write } from './scp.js';
import { resource } from '../lib/pathutil.js';

const CANIDATES = [
  '/usr/libexec/debugserver', // iOS 16+
  '/Developer/usr/bin/debugserver',  // pre iOS 16
]

const DEBUGSERVER = '/tmp/debugserver';


function debugserver(client: Client, cmd: string): Promise<ClientChannel> {
  const keyword = 'Listening to port ';

  return new Promise((resolve, reject) => {
    client.shell((err, stream) => {
      if (err) reject(err);

      const rl = readline.createInterface({
        input: stream.stdout,
        terminal: false
      });

      rl.on('line', (line) => {
        console.info('remote >>', line);

        if (line.includes(keyword)) {
          resolve(stream);
          rl.close();
        }
      });

      stream.stdin.write('killall debugserver\n');
      stream.stdin.write(cmd + '\n');
    });
  })
}

// shell injection, but unvoidable
export async function spawn(client: Client, server: string, path: string, port: number): Promise<ClientChannel> {
  const cmd = `${server} -x backboard 127.1:${port} ${path}`;
  return debugserver(client, cmd);
}

export function attach(client: Client, server: string, target: number | string, port: number) {
  const cmd = `${server} 127.1:${port} -a ${target}`;
  return debugserver(client, cmd);
}

export async function deploy(client: Client) {
  function cmd(cmdline: string) {
    return new Promise((resolve) => {
      client.exec(cmdline, (err, stream) => {
        stream.on('exit', (code: number) => {
          resolve(!err && code === 0);

          stream.close();
        });
      })
    })
  }

  const remoteXML = '/tmp/ent.xml';
  {
    const entXML = resource('debugserver.ent.xml');
    const content = await fsp.readFile(entXML);
    await write(client, content, remoteXML);
  }

  let dest = DEBUGSERVER;

  const probe = '/test.txt'
  const hasRootFS = await cmd(`echo "test" > ${probe} && rm ${probe}`);
  if (hasRootFS) {
    dest = '/usr/bin/debugserver';
  }

  for (const candiate of CANIDATES) {
    if (await cmd(`test -f ${candiate}`)) {
      await cmd(`cp ${candiate} ${dest}`);
      await cmd(`ldid -S${remoteXML} ${dest}`);

      console.log(`signed ${candiate} debugserver to ${dest}`);
      return dest;
    }
  }

  throw new Error('debugserver binary not found. Please make sure DDI is mounted.');
}
